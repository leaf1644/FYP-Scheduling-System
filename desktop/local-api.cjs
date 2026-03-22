const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const AI_PROVIDER_GOOGLE = 'google-gemini';
const AI_PROVIDER_HKBU = 'hkbu-gemini';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const SOLVER_ROUTE_MAP = {
  '/api/solve-cp-sat': {
    executableName: 'solver-cp-sat.exe',
    scriptPath: path.join('server', 'solver_cp_sat_optimized.py'),
    solverName: 'CP-SAT',
  },
  '/api/solve-pulp-ilp': {
    executableName: 'solver-pulp-ilp.exe',
    scriptPath: path.join('server', 'solver_pulp_ilp.py'),
    solverName: 'PuLP ILP',
  },
  '/api/solve-legacy-python': {
    executableName: 'solver-legacy.exe',
    scriptPath: path.join('server', 'legacy_solver.py'),
    solverName: 'Legacy Python',
  },
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function writeLog(logger, message) {
  if (logger && typeof logger.write === 'function') {
    logger.write(message);
  }
}

function parseDotEnv(content) {
  const parsed = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function loadDesktopEnv(paths) {
  const merged = { ...process.env };
  for (const envPath of paths.envFileCandidates || []) {
    if (!envPath || !fs.existsSync(envPath)) {
      continue;
    }

    const parsed = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function normalizeAiProvider(value) {
  return value === AI_PROVIDER_HKBU ? AI_PROVIDER_HKBU : AI_PROVIDER_GOOGLE;
}

function buildPrompt(failedAssignments = [], professorDiagnostics = []) {
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
}

function buildChatMessages(failedAssignments = [], professorDiagnostics = []) {
  return [
    {
      role: 'system',
      content: 'You analyze university scheduling bottlenecks and must always return JSON only.',
    },
    {
      role: 'user',
      content: buildPrompt(failedAssignments, professorDiagnostics),
    },
  ];
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function extractChatCompletionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseAdvice(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      analysis: cleaned || 'AI 回傳內容不是有效的 JSON。',
      suggestions: [],
    };
  }
}

async function createGoogleGeminiRequest(apiKey, model, prompt) {
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
    text: extractGeminiText(payload),
    errorMessage: payload?.error?.message || `Gemini API 失敗 (${response.status})`,
  };
}

async function createHkbuGeminiRequest(apiKey, deployment, baseUrl, failedAssignments = [], professorDiagnostics = []) {
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
    text: extractChatCompletionText(payload),
    errorMessage: payload?.error?.message || `HKBU GenAI API 失敗 (${response.status})`,
  };
}

function createAiConfig(env) {
  const provider = normalizeAiProvider(env.AI_PROVIDER || (env.HKBU_GENAI_API_KEY ? AI_PROVIDER_HKBU : AI_PROVIDER_GOOGLE));
  if (provider === AI_PROVIDER_HKBU) {
    return {
      provider,
      apiKey: env.HKBU_GENAI_API_KEY,
      model: env.HKBU_GENAI_DEPLOYMENT,
      baseUrl: env.HKBU_GENAI_BASE_URL || 'https://genai.hkbu.edu.hk/api/v0/rest',
    };
  }

  return {
    provider,
    apiKey: env.GOOGLE_GEMINI_API_KEY || env.GEMINI_API_KEY,
    model: env.GOOGLE_GEMINI_MODEL || env.GEMINI_MODEL,
  };
}

async function handleAiAdvice(req, res, paths, logger) {
  writeLog(
    logger,
    `ai-advice request mode=${paths.mode} envCandidates=${(paths.envFileCandidates || [])
      .map((candidate) => `${candidate}:${fs.existsSync(candidate)}`)
      .join(',')}`
  );

  const env = loadDesktopEnv(paths);
  const config = createAiConfig(env);

  writeLog(
    logger,
    `ai-advice config provider=${config.provider} hasApiKey=${Boolean(config.apiKey)} model=${config.model || ''} baseUrl=${config.baseUrl || ''}`
  );

  if (!config.apiKey) {
    writeLog(logger, 'ai-advice rejected: missing api key');
    sendJson(res, 500, { error: 'Desktop AI 缺少 API key 設定。' });
    return;
  }

  if (!config.model) {
    writeLog(logger, 'ai-advice rejected: missing model or deployment');
    sendJson(res, 500, { error: 'Desktop AI 缺少 model / deployment 設定。' });
    return;
  }

  if (config.provider === AI_PROVIDER_HKBU && !config.baseUrl) {
    writeLog(logger, 'ai-advice rejected: missing HKBU base URL');
    sendJson(res, 500, { error: 'Desktop AI 缺少 HKBU GenAI base URL 設定。' });
    return;
  }

  try {
    const rawBody = await readRequestBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const failedAssignments = Array.isArray(body.failedAssignments) ? body.failedAssignments : [];
    const professorDiagnostics = Array.isArray(body.professorDiagnostics) ? body.professorDiagnostics : [];

    writeLog(
      logger,
      `ai-advice payload failedAssignments=${failedAssignments.length} professorDiagnostics=${professorDiagnostics.length}`
    );

    const response = config.provider === AI_PROVIDER_HKBU
      ? await createHkbuGeminiRequest(config.apiKey, config.model, config.baseUrl, failedAssignments, professorDiagnostics)
      : await createGoogleGeminiRequest(config.apiKey, config.model, buildPrompt(failedAssignments, professorDiagnostics));

    writeLog(
      logger,
      `ai-advice response ok=${response.ok} status=${response.status} textLength=${response.text ? response.text.length : 0} error=${response.errorMessage || ''}`
    );

    if (!response.ok) {
      sendJson(res, 502, { error: response.errorMessage });
      return;
    }

    sendJson(res, 200, parseAdvice(response.text));
  } catch (error) {
    writeLog(logger, `ai-advice exception ${error instanceof Error ? error.stack || error.message : String(error)}`);
    throw error;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => resolve(rawBody));
    req.on('error', reject);
  });
}

const pythonRuntimeCheckCache = new Map();

function hasRequiredSolverPackages(pythonBin) {
  if (pythonRuntimeCheckCache.has(pythonBin)) {
    return pythonRuntimeCheckCache.get(pythonBin);
  }

  const probe = spawnSync(pythonBin, ['-c', 'import ortools, pulp'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  const isValid = !probe.error && probe.status === 0;
  pythonRuntimeCheckCache.set(pythonBin, isValid);
  return isValid;
}

function resolvePythonBin(paths) {
  const env = loadDesktopEnv(paths);
  const candidates = [
    env.PYTHON_BIN,
    path.join(paths.projectRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(paths.projectRoot, 'desktop', '.solver-venv', 'Scripts', 'python.exe'),
    'python',
  ].filter(Boolean);

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
}

function createPackagedRuntimeCommand(routeConfig, paths) {
  if (!paths.runtimeDir || !paths.packagedServerDir) {
    return null;
  }

  const packagedPython = path.join(paths.runtimeDir, 'python.exe');
  const packagedScript = path.join(paths.packagedServerDir, path.basename(routeConfig.scriptPath));
  if (!fs.existsSync(packagedPython) || !fs.existsSync(packagedScript)) {
    return null;
  }

  return {
    command: packagedPython,
    args: [packagedScript],
    cwd: paths.packagedServerDir,
  };
}

function createSolverCommand(routeConfig, paths) {
  const packagedRuntimeCommand = createPackagedRuntimeCommand(routeConfig, paths);
  if (packagedRuntimeCommand) {
    return packagedRuntimeCommand;
  }

  const packagedExecutable = path.join(paths.solverDir, routeConfig.executableName);
  if (fs.existsSync(packagedExecutable)) {
    return {
      command: packagedExecutable,
      args: [],
      cwd: path.dirname(packagedExecutable),
    };
  }

  const packagedDirectoryExecutable = path.join(
    paths.solverDir,
    routeConfig.executableName.replace(/\.exe$/i, ''),
    routeConfig.executableName
  );
  if (fs.existsSync(packagedDirectoryExecutable)) {
    return {
      command: packagedDirectoryExecutable,
      args: [],
      cwd: path.dirname(packagedDirectoryExecutable),
    };
  }

  if (paths.mode === 'packaged') {
    throw new Error(
      `${routeConfig.solverName} packaged executable not found at ${packagedExecutable} or ${packagedDirectoryExecutable}. Rebuild the desktop package and replace the old exe.`
    );
  }

  const pythonBin = resolvePythonBin(paths);
  return {
    command: pythonBin,
    args: [path.join(paths.projectRoot, routeConfig.scriptPath)],
    cwd: paths.projectRoot,
  };
}

function runSolver(routeConfig, payload, paths) {
  return new Promise((resolve, reject) => {
    const solverCommand = createSolverCommand(routeConfig, paths);
    const child = spawn(solverCommand.command, solverCommand.args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: solverCommand.cwd,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      const trimmedStdout = stdout.trim();
      if (code !== 0) {
        reject(new Error(trimmedStdout || stderr.trim() || `${routeConfig.solverName} solver exited with code ${code}`));
        return;
      }

      try {
        resolve(trimmedStdout ? JSON.parse(trimmedStdout) : {});
      } catch {
        reject(new Error(trimmedStdout || `${routeConfig.solverName} solver returned invalid JSON`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function serveStaticFile(reqPath, distDir, res) {
  const normalizedPath = reqPath === '/' ? '/index.html' : reqPath;
  const safeSegments = normalizedPath.split('/').filter(Boolean);
  const candidatePath = path.join(distDir, ...safeSegments);
  const fallbackPath = path.join(distDir, 'index.html');

  let filePath = fallbackPath;
  try {
    const stats = await fsp.stat(candidatePath);
    if (stats.isFile()) {
      filePath = candidatePath;
    }
  } catch {
    filePath = fallbackPath;
  }

  const fileExt = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[fileExt] || 'application/octet-stream';
  const content = await fsp.readFile(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

function createRequestHandler(paths, logger) {
  return async (req, res) => {
    if (!req.url) {
      sendJson(res, 400, { error: 'Invalid request URL' });
      return;
    }

    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const routeConfig = SOLVER_ROUTE_MAP[requestUrl.pathname];

    try {
      if (routeConfig) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }

        const rawBody = await readRequestBody(req);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const result = await runSolver(routeConfig, body, paths);
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/ai-advice') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }

        await handleAiAdvice(req, res, paths, logger);
        return;
      }

      await serveStaticFile(requestUrl.pathname, paths.distDir, res);
    } catch (error) {
      writeLog(logger, `request error path=${requestUrl.pathname} message=${error instanceof Error ? error.stack || error.message : String(error)}`);
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

async function startLocalServer(paths, logger) {
  const indexPath = path.join(paths.distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      [
        `Cannot find built frontend at ${indexPath}.`,
        `Resolved mode: ${paths.mode}.`,
        'The portable exe could not locate app-dist/index.html in its extracted resources.',
        'Rebuild the desktop package and replace the old exe.',
      ].join(' ')
    );
  }

  const server = http.createServer(createRequestHandler(paths, logger));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine desktop server port.');
  }

  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stopLocalServer(instance) {
  if (!instance || !instance.server) {
    return;
  }

  await new Promise((resolve) => {
    instance.server.close(() => resolve());
  });
}

module.exports = {
  startLocalServer,
  stopLocalServer,
};