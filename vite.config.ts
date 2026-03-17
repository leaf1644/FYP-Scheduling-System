import path from 'path';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

interface FailedAssignment {
  supervisorId?: string;
  observerId?: string;
  reason?: string;
}

interface AdviceRequestBody {
  failedAssignments?: FailedAssignment[];
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

const buildPrompt = (failedAssignments: FailedAssignment[]) => {
  const failedSummary = failedAssignments
    .slice(0, 15)
    .map((item) => {
      const sup = item.supervisorId || 'N/A';
      const obs = item.observerId || 'N/A';
      const reason = item.reason || 'UNKNOWN';
      return `{ sup: "${sup}", obs: "${obs}", reason: "${reason}" }`;
    })
    .join('\n');

  return `
Context: CSP Scheduling for University Presentations.
Task: Analyze the following list of failed assignments (anonymized) to find bottleneck resources.

Input Data:
${failedSummary}

Output format: JSON only.
{
  "bottleneck_professors": ["ProfA", "ProfB"],
  "analysis": "Brief explanation of why...",
  "suggestions": [
    "Ask ProfA to open 1 more slot.",
    "Swap pairs involving ProfB."
  ]
}
`.trim();
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

const parseAdvice = (text: string) => {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      analysis: cleaned || 'AI 回傳內容不是有效的 JSON。',
      suggestions: [],
    };
  }
};

const createAiAdviceMiddleware = (apiKey?: string, model?: string) => {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    if (!apiKey) {
      sendJson(res, 500, { error: 'Server 缺少 GEMINI_API_KEY 設定' });
      return;
    }

    if (!model) {
      sendJson(res, 500, { error: 'Server 缺少 GEMINI_MODEL 設定' });
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const body = (rawBody ? JSON.parse(rawBody) : {}) as AdviceRequestBody;
      const failedAssignments = Array.isArray(body.failedAssignments) ? body.failedAssignments : [];

      const prompt = buildPrompt(failedAssignments);
      const geminiResponse = await fetch(
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

      const geminiPayload = await geminiResponse.json().catch(() => ({}));
      if (!geminiResponse.ok) {
        const message = geminiPayload?.error?.message || `Gemini API 失敗 (${geminiResponse.status})`;
        sendJson(res, 502, { error: message });
        return;
      }

      const responseText = extractGeminiText(geminiPayload);
      sendJson(res, 200, parseAdvice(responseText));
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || 'AI 分析請求失敗' });
    }
  };
};

const runPythonSolver = (pythonBin: string, scriptPath: string, payload: SolverRequestBody, solverName: string): Promise<unknown> => {
  return new Promise((resolve, reject) => {
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
  const aiAdviceMiddleware = createAiAdviceMiddleware(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  const pythonBin = env.PYTHON_BIN || 'python';
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
