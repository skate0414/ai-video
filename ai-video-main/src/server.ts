import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Workbench } from './workbench.js';
import type { WorkbenchEvent } from './types.js';
import { ChatAdapter } from './adapters/chatAdapter.js';
import { GeminiAdapter } from './adapters/geminiAdapter.js';
import type { PipelineEvent, QualityTier } from './pipeline/types.js';
import { json, BodyTooLargeError, type Route } from './routes/helpers.js';
import { workbenchRoutes } from './routes/workbench.js';
import { pipelineRoutesV2 } from './routes/pipeline.js';
import { setupRoutes } from './routes/setup.js';
import { resolveDataDir, resolveSubDir } from './dataDir.js';
import { ConfigStore } from './configStore.js';
import { PipelineService } from './pipeline/pipelineService.js';

/* ------------------------------------------------------------------ */
/*  Environment config & validation                                   */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.PORT ?? 3220);
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[server] Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const DATA_DIR = resolveDataDir();
const UPLOAD_DIR = resolveSubDir(DATA_DIR, 'uploads');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const API_KEY = process.env.API_KEY || '';

const workbench = new Workbench(join(DATA_DIR, 'accounts.json'));

/* ------------------------------------------------------------------ */
/*  Pipeline setup                                                    */
/* ------------------------------------------------------------------ */

const chatAdapter = new ChatAdapter(workbench, { assetsDir: join(DATA_DIR, 'assets') });

const configStore = new ConfigStore(DATA_DIR);
const savedConfig = configStore.get();

const geminiApiKey = savedConfig.geminiApiKey || process.env.GEMINI_API_KEY || '';
const apiAdapter: GeminiAdapter | undefined = geminiApiKey
  ? new GeminiAdapter(geminiApiKey)
  : undefined;

if (apiAdapter) {
  console.log(`[server] Gemini API adapter initialized (key: ${geminiApiKey.slice(0, 8)}...)`);
} else {
  console.warn('[server] ⚠️ No Gemini API key — KEYFRAME_GEN will fall back to chat adapter (Pollinations)');
}

const defaultQualityTier: QualityTier = savedConfig.qualityTier ?? (apiAdapter ? 'balanced' : 'free');

/* ------------------------------------------------------------------ */
/*  SSE client management                                             */
/* ------------------------------------------------------------------ */

interface SSEClient {
  id: number;
  res: ServerResponse;
}

const MAX_SSE_CLIENTS = 50;
let clientIdCounter = 0;
const sseClients: SSEClient[] = [];

function broadcastEvent(event: WorkbenchEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.res.write(data);
  }
}

workbench.onEvent(broadcastEvent);

/* ------------------------------------------------------------------ */
/*  PipelineService – clean facade for all pipeline operations        */
/* ------------------------------------------------------------------ */

const pipelineService = new PipelineService({
  dataDir: DATA_DIR,
  chatAdapter,
  apiAdapter,
  geminiApiKey,
  defaultQualityTier,
  configStore,
  broadcastEvent: (e) => broadcastEvent(e as WorkbenchEvent),
});

/* ------------------------------------------------------------------ */
/*  Route table                                                       */
/* ------------------------------------------------------------------ */

const routes: Route[] = [
  ...workbenchRoutes(workbench, UPLOAD_DIR),
  ...pipelineRoutesV2(pipelineService),
  ...setupRoutes(pipelineService),
];

/* ------------------------------------------------------------------ */
/*  Request handler                                                   */
/* ------------------------------------------------------------------ */

function parsePath(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.length === 0) {
    // No whitelist configured → allow all (dev mode)
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function checkApiKey(req: IncomingMessage): boolean {
  if (!API_KEY) return true; // no key configured → skip auth
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${API_KEY}`;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const path = parsePath(req.url ?? '/');
  console.log(`[server] ${method} ${path}`);

  setCors(req, res);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check (no auth required)
  if (method === 'GET' && path === '/health') {
    return json(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      version: '0.1.0',
    });
  }

  // API key authentication (if configured)
  if (!checkApiKey(req)) {
    return json(res, 401, { error: 'Unauthorized — invalid or missing API key' });
  }

  // SSE stream (kept inline — long-lived connection)
  if (method === 'GET' && path === '/api/events') {
    if (sseClients.length >= MAX_SSE_CLIENTS) {
      return json(res, 503, { error: 'Too many SSE connections' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const client: SSEClient = { id: ++clientIdCounter, res };
    sseClients.push(client);
    console.log(`[server] SSE client connected, id=${client.id}, total=${sseClients.length}`);
    res.write(`data: ${JSON.stringify({ type: 'state', payload: workbench.getState() })}\n\n`);
    req.on('close', () => {
      const idx = sseClients.findIndex((c) => c.id === client.id);
      if (idx !== -1) sseClients.splice(idx, 1);
      console.log(`[server] SSE client disconnected, id=${client.id}, remaining=${sseClients.length}`);
    });
    return;
  }

  // Match against route table
  for (const route of routes) {
    if (method !== route.method) continue;
    const match = route.pattern.exec(path);
    if (match) {
      console.log(`[server] matched route: ${route.method} ${route.pattern}`);
      await route.handler(req, res, match);
      return;
    }
  }

  console.log(`[server] 404 not found: ${method} ${path}`);
  json(res, 404, { error: 'Not found' });
}

/* ------------------------------------------------------------------ */
/*  Start + graceful shutdown                                         */
/* ------------------------------------------------------------------ */

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    if (res.headersSent) return;
    if (err instanceof BodyTooLargeError) {
      json(res, 413, { error: err.message });
    } else if (err instanceof SyntaxError && err.message.includes('JSON')) {
      json(res, 400, { error: 'Invalid JSON in request body' });
    } else {
      console.error('[server] unhandled:', err);
      json(res, 500, { error: 'Internal server error' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`🤖 AI Video Pipeline server running at http://localhost:${PORT}`);
  console.log(`   Data dir:   ${DATA_DIR}`);
  console.log(`   Health:     http://localhost:${PORT}/health`);
  console.log(`   SSE events: http://localhost:${PORT}/api/events`);
  if (API_KEY) console.log('   🔒 API key authentication enabled');
  if (ALLOWED_ORIGINS.length) console.log(`   🌐 CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
  if (process.env.TAURI_SIDECAR) console.log('   📦 Running as Tauri sidecar');
});

/* ---- Process signal handlers ---- */

function gracefulShutdown(signal: string): void {
  console.log(`\n[server] ${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10 s
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

