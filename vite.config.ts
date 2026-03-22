import fs from 'node:fs';
import path from 'path';
import { spawn, spawnSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

interface AdviceRequestBody {
  failedAssignments?: Array<{
    studentName?: string;
    supervisorId?: string;
    observerId?: string;
    reason?: string;
    common_slots?: string[];
    blocked_common_slots?: string[];
    suggested_extra_slots_for_supervisor?: string[];
    suggested_extra_slots_for_observer?: string[];
  }>;
  professorDiagnostics?: Array<{
    professorId?: string;
    unscheduledCount?: number;
    reasons?: Record<string, number>;
    suggestedExtraSlots?: string[];
  }>;
}

type AiProvider = 'google-gemini' | 'hkbu-gemini';

interface AiProviderConfig {
  provider: AiProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

interface SolverRequestBody {
  students?: unknown[];
  allRoomSlots?: unknown[];
  profAvailability?: Record<string, string[]>;
  profPreferences?: Record<string, unknown>;
  timeoutMs?: number;
}

const readRequestBody = (req: IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
};

const sendJson = (res: ServerResponse, statusCode: number, payload: unknown) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const pythonRuntimeCheckCache = new Map<string, boolean>();

const hasRequiredSolverPackages = (pythonBin: string) => {
  if (pythonRuntimeCheckCache.has(pythonBin)) {
    return pythonRuntimeCheckCache.get(pythonBin) || false;
  }

  const probe = spawnSync(
    pythonBin,
    ['-c', 'import ortools, pulp'],
    {
      stdio: 'ignore',
      windowsHide: true,
    }
  );

  const isValid = !probe.error && probe.status === 0;
  pythonRuntimeCheckCache.set(pythonBin, isValid);
  return isValid;
};

const resolvePythonBin = (env: Record<string, string | undefined>) => {
  const candidates = [
    env.PYTHON_BIN,
    path.resolve(__dirname, '.venv', 'Scripts', 'python.exe'),
    path.resolve(__dirname, 'desktop', '.solver-venv', 'Scripts', 'python.exe'),
    'python',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const isFilePath = candidate.includes('\\') || candidate.includes('/') || candidate.toLowerCase().endsWith('.exe');
    if (isFilePath && !fs.existsSync(candidate)) {
      continue;
    }

    if (hasRequiredSolverPackages(candidate)) {
      return candidate;
    }
  }

  return 'python';
};

const buildPrompt = (failedAssignments: AdviceRequestBody['failedAssignments'] = [], professorDiagnostics: AdviceRequestBody['professorDiagnostics'] = []) => {
  // Compress the scheduling state into a deterministic text prompt so both providers receive the same reasoning context.
  const failedSummary = failedAssignments
    .slice(0, 15)
    .map((item) => {
      const sup = item.supervisorId || 'N/A';
      const obs = item.observerId || 'N/A';
      const reason = item.reason || 'UNKNOWN';
      const student = item.studentName || 'N/A';
      const commonSlots = Array.isArray(item.common_slots) ? item.common_slots.join(', ') : '';
      const blockedCommonSlots = Array.isArray(item.blocked_common_slots) ? item.blocked_common_slots.join(', ') : '';
      const supExtra = Array.isArray(item.suggested_extra_slots_for_supervisor)
        ? item.suggested_extra_slots_for_supervisor.join(', ')
        : '';
      const obsExtra = Array.isArray(item.suggested_extra_slots_for_observer)
        ? item.suggested_extra_slots_for_observer.join(', ')
        : '';
      return `{ student: "${student}", sup: "${sup}", obs: "${obs}", reason: "${reason}", common_slots: "${commonSlots}", blocked_common_slots: "${blockedCommonSlots}", suggested_extra_slots_for_supervisor: "${supExtra}", suggested_extra_slots_for_observer: "${obsExtra}" }`;
    })
    .join('\n');

  const professorSummary = professorDiagnostics
    .slice(0, 10)
    .map((item) => {
      const professor = item.professorId || 'N/A';
      const unscheduledCount = item.unscheduledCount ?? 0;
      const reasons = item.reasons ? JSON.stringify(item.reasons) : '{}';
      const suggestedExtraSlots = Array.isArray(item.suggestedExtraSlots) ? item.suggestedExtraSlots.join(', ') : '';
      return `{ professor: "${professor}", unscheduled_count: ${unscheduledCount}, reasons: ${reasons}, suggested_extra_slots: "${suggestedExtraSlots}" }`;
    })
    .join('\n');

  return `
Context: CSP Scheduling for University Presentations.
Task: Analyze the following list of failed assignments and professor diagnostics to find bottleneck resources.
Focus on concrete, actionable scheduling fixes. Prefer exact slot suggestions when supported by the input data.

Failed Assignments:
${failedSummary}

Professor Diagnostics:
${professorSummary}

Output format: JSON only.
{
  "bottleneck_professors": ["ProfA", "ProfB"],
  "analysis": "Brief explanation of why...",
  "slot_recommendations": [
    {
      "professor": "ProfA",
      "suggested_slots": ["2026-04-10 11:30-12:15", "2026-04-11 10:30-11:15"],
      "reason": "These slots appear repeatedly as the most useful additional availability to unlock unscheduled cases."
    }
  ],
  "suggestions": [
    "Ask ProfA to open 2026-04-10 11:30-12:15.",
    "Re-evaluate pairings involving ProfB."
  ]
}
`.trim();
};

const buildChatMessages = (
  failedAssignments: AdviceRequestBody['failedAssignments'] = [],
  professorDiagnostics: AdviceRequestBody['professorDiagnostics'] = []
) => {
  const prompt = buildPrompt(failedAssignments, professorDiagnostics);
  return [
    {
      role: 'system',
      content: 'You analyze university scheduling bottlenecks and must always return JSON only.',
    },
    {
      role: 'user',
      content: prompt,
    },
  ];
};

const extractGeminiText = (payload: any): string => {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
};

const extractChatCompletionText = (payload: any): string => {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
};

const parseAdvice = (text: string) => {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Keep degraded responses visible to the UI instead of failing silently on non-JSON output.
    return {
      analysis: cleaned || 'AI 回傳內容不是有效的 JSON。',
      suggestions: [],
    };
  }
};

const normalizeAiProvider = (value?: string): AiProvider => {
  return value === 'hkbu-gemini' ? 'hkbu-gemini' : 'google-gemini';
};

const createGoogleGeminiRequest = async (apiKey: string, model: string, prompt: string) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
    text: extractGeminiText(payload),
    errorMessage: payload?.error?.message || `Gemini API 失敗 (${response.status})`,
  };
};

const createHkbuGeminiRequest = async (
  apiKey: string,
  deployment: string,
  baseUrl: string,
  failedAssignments: AdviceRequestBody['failedAssignments'] = [],
  professorDiagnostics: AdviceRequestBody['professorDiagnostics'] = []
) => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const response = await fetch(
    `${normalizedBaseUrl}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        messages: buildChatMessages(failedAssignments, professorDiagnostics),
        temperature: 0.2,
        response_format: {
          type: 'json_object',
        },
      }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
    text: extractChatCompletionText(payload),
    errorMessage: payload?.error?.message || `HKBU GenAI API 失敗 (${response.status})`,
  };
};

const createAiAdviceMiddleware = (config: AiProviderConfig) => {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    if (!config.apiKey) {
      sendJson(res, 500, { error: 'Server 缺少 AI API key 設定' });
      return;
    }

    if (!config.model) {
      sendJson(res, 500, { error: 'Server 缺少 AI model / deployment 設定' });
      return;
    }

    if (config.provider === 'hkbu-gemini' && !config.baseUrl) {
      sendJson(res, 500, { error: 'Server 缺少 HKBU GenAI base URL 設定' });
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const body = (rawBody ? JSON.parse(rawBody) : {}) as AdviceRequestBody;
      const failedAssignments = Array.isArray(body.failedAssignments) ? body.failedAssignments : [];
      const professorDiagnostics = Array.isArray(body.professorDiagnostics) ? body.professorDiagnostics : [];

      // Route to the configured provider, but preserve one response contract for the frontend.
      const response = config.provider === 'hkbu-gemini'
        ? await createHkbuGeminiRequest(config.apiKey, config.model, config.baseUrl || '', failedAssignments, professorDiagnostics)
        : await createGoogleGeminiRequest(config.apiKey, config.model, buildPrompt(failedAssignments, professorDiagnostics));

      if (!response.ok) {
        sendJson(res, 502, { error: response.errorMessage });
        return;
      }

      sendJson(res, 200, parseAdvice(response.text));
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || 'AI 分析請求失敗' });
    }
  };
};

const runPythonSolver = (pythonBin: string, scriptPath: string, payload: SolverRequestBody, solverName: string): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    // Python solvers run as child processes so the Vite server can keep a simple HTTP API surface.
    const child = spawn(pythonBin, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      const trimmedStdout = stdout.trim();
      if (code !== 0) {
        reject(new Error(trimmedStdout || stderr.trim() || `${solverName} solver exited with code ${code}`));
        return;
      }

      try {
        // Solver scripts are expected to emit a single JSON object on stdout.
        resolve(trimmedStdout ? JSON.parse(trimmedStdout) : {});
      } catch {
        reject(new Error(trimmedStdout || `${solverName} solver returned invalid JSON`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
};

const createPythonSolverMiddleware = (pythonBin: string, scriptPath: string, solverName: string) => {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const body = (rawBody ? JSON.parse(rawBody) : {}) as SolverRequestBody;
      const result = await runPythonSolver(pythonBin, scriptPath, body, solverName);
      sendJson(res, 200, result);
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || `${solverName} 求解失敗` });
    }
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // Provider selection is centralized here so the frontend can stay provider-agnostic.
  const aiProvider = normalizeAiProvider(env.AI_PROVIDER || (env.HKBU_GENAI_API_KEY ? 'hkbu-gemini' : 'google-gemini'));
  const aiAdviceMiddleware = createAiAdviceMiddleware({
    provider: aiProvider,
    apiKey: aiProvider === 'hkbu-gemini'
      ? env.HKBU_GENAI_API_KEY
      : (env.GOOGLE_GEMINI_API_KEY || env.GEMINI_API_KEY),
    model: aiProvider === 'hkbu-gemini'
      ? env.HKBU_GENAI_DEPLOYMENT
      : (env.GOOGLE_GEMINI_MODEL || env.GEMINI_MODEL),
    baseUrl: aiProvider === 'hkbu-gemini'
      ? (env.HKBU_GENAI_BASE_URL || 'https://genai.hkbu.edu.hk/api/v0/rest')
      : undefined,
  });
  const pythonBin = resolvePythonBin(env);
  const cpSatScriptPath = path.resolve(__dirname, 'server', 'solver_cp_sat_optimized.py');
  const pulpScriptPath = path.resolve(__dirname, 'server', 'solver_pulp_ilp.py');
  const legacyPythonScriptPath = path.resolve(__dirname, 'server', 'legacy_solver.py');
  const cpSatMiddleware = createPythonSolverMiddleware(pythonBin, cpSatScriptPath, 'CP-SAT');
  const pulpMiddleware = createPythonSolverMiddleware(pythonBin, pulpScriptPath, 'PuLP ILP');
  const legacyPythonMiddleware = createPythonSolverMiddleware(pythonBin, legacyPythonScriptPath, 'Legacy Python');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      {
        name: 'api-middleware',
        configureServer(server) {
          server.middlewares.use('/api/ai-advice', aiAdviceMiddleware);
          server.middlewares.use('/api/solve-cp-sat', cpSatMiddleware);
          server.middlewares.use('/api/solve-pulp-ilp', pulpMiddleware);
          server.middlewares.use('/api/solve-legacy-python', legacyPythonMiddleware);
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/ai-advice', aiAdviceMiddleware);
          server.middlewares.use('/api/solve-cp-sat', cpSatMiddleware);
          server.middlewares.use('/api/solve-pulp-ilp', pulpMiddleware);
          server.middlewares.use('/api/solve-legacy-python', legacyPythonMiddleware);
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
