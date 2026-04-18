import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Workbench } from './workbench.js';
import type { WorkbenchEvent } from './types.js';
import { WB_EVENT } from './types.js';
import { ChatAdapter } from './adapters/chatAdapter.js';
import { AIVideoMakerAdapter } from './adapters/aivideomakerAdapter.js';
import type { PipelineEvent } from './pipeline/types.js';
import { json, BodyTooLargeError, type Route } from './routes/helpers.js';
import { workbenchRoutes } from './routes/workbench.js';
import { pipelineRoutesV2 } from './routes/pipeline.js';
import { setupRoutes } from './routes/setup.js';
import { bgmLibraryRoutes } from './routes/bgmLibrary.js';
import { resolveDataDir, resolveSubDir } from './dataDir.js';
import { ConfigStore } from './configStore.js';
import { PipelineService } from './pipeline/pipelineService.js';
import { getGlobalPluginRegistry } from './pipeline/providers/index.js';
// Side-effect import: registers all provider plugins.
import './pipeline/providers/plugins/index.js';
import { RateLimiter } from './rateLimiter.js';
import {
  BACKEND_PORT,
  MAX_SSE_CLIENTS as MAX_SSE_CLIENTS_CONST,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  SHUTDOWN_FORCE_EXIT_MS,
} from './constants.js';

/* ------------------------------------------------------------------ */
/*  Environment config & validation                                   */
/* ------------------------------------------------------------------ */

const PORT = BACKEND_PORT;
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[server] Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const DATA_DIR = resolveDataDir();
const UPLOAD_DIR = resolveSubDir(DATA_DIR, 'uploads');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const API_KEY = process.env.API_KEY || '';

const workbench = new Workbench(join(DATA_DIR, 'resources.json'));

/* ------------------------------------------------------------------ */
/*  Pipeline setup                                                    */
/* ------------------------------------------------------------------ */

const chatAdapter = new ChatAdapter(workbench, { assetsDir: join(DATA_DIR, 'assets') });

const configStore = new ConfigStore(DATA_DIR);
const savedConfig = configStore.get();

// Collect all aivideomaker API keys (single key + array keys, deduplicated)
const aivideomakerApiKey = savedConfig.aivideomakerApiKey || process.env.AIVIDEOMAKER_API_KEY || '';
const allAivideomakerKeys = [
  ...(aivideomakerApiKey ? [aivideomakerApiKey] : []),
  ...(savedConfig.aivideomakerApiKeys ?? []),
].filter((k, i, arr) => k && arr.indexOf(k) === i);

if (allAivideomakerKeys.length > 0) {
  console.log(`[server] AIVideoMaker: ${allAivideomakerKeys.length} account(s) initialized`);
  for (const k of allAivideomakerKeys) {
    console.log(`  - key: ${k.slice(0, 10)}...`);
  }
}

/* ---- Register API keys as AiResource (type='api') ---- */
workbench.resources.syncApiKeys({
  aivideomakerApiKeys: allAivideomakerKeys,
});

/* ------------------------------------------------------------------ */
/*  SSE client management                                             */
/* ------------------------------------------------------------------ */

interface SSEClient {
  id: number;
  res: ServerResponse;
}

const MAX_SSE_CLIENTS = MAX_SSE_CLIENTS_CONST;
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
  aivideomakerApiKeys: allAivideomakerKeys,
  configStore,
  broadcastEvent: (e) => broadcastEvent(e as WorkbenchEvent),
  getAccounts: () => workbench.resources.all().map(a => ({ provider: a.provider, profileDir: a.profileDir, quotaExhausted: a.quotaExhausted })),
  getVideoConfig: () => workbench.resources.getVideoProviderConfig(),
  pluginRegistry: getGlobalPluginRegistry(),
  onApiKeysChanged: (keys) => workbench.resources.syncApiKeys(keys),
});

/* ------------------------------------------------------------------ */
/*  Route table                                                       */
/* ------------------------------------------------------------------ */

const routes: Route[] = [
  // UI crash reporter — logs crash details to terminal
  {
    method: 'POST',
    pattern: /^\/api\/ui-crash$/,
    handler: async (req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.error('[UI-CRASH]', data.message);
          console.error('[UI-CRASH] Stack:', data.stack);
          console.error('[UI-CRASH] ComponentStack:', data.componentStack);
        } catch { console.error('[UI-CRASH] raw:', body); }
        json(res, 200, { ok: true });
      });
    },
  },
  ...workbenchRoutes(workbench, UPLOAD_DIR),
  ...pipelineRoutesV2(pipelineService),
  ...bgmLibraryRoutes(pipelineService, broadcastEvent),
  ...setupRoutes(pipelineService),
];

/* ------------------------------------------------------------------ */
/*  Rate limiting                                                     */
/* ------------------------------------------------------------------ */

const rateLimiter = new RateLimiter({
  max: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
});

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

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

  // Rate limiting (exempt health check and OPTIONS)
  const clientIp = getClientIp(req);
  const rl = rateLimiter.consume(clientIp);
  res.setHeader('X-RateLimit-Limit', rateLimiter['config'].max);
  res.setHeader('X-RateLimit-Remaining', rl.remaining);
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil(rl.retryAfterMs / 1000));
    return json(res, 429, { error: 'Too many requests — please retry later' });
  }

  // Health check (no auth required)
  if (method === 'GET' && path === '/health') {
    const accounts = workbench.resources.all();
    const apiResources = accounts.filter(a => a.type === 'api');
    const browserResources = accounts.filter(a => a.type !== 'api');
    return json(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      version: '0.1.0',
      providers: accounts.length,
      browserResources: browserResources.length,
      apiResources: apiResources.length,
      ready: true,
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
    res.write(`data: ${JSON.stringify({ type: WB_EVENT.STATE, payload: workbench.getState() })}\n\n`);
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
  if (process.env.ELECTRON_SHELL) console.log('   🖥️  Running inside Electron shell');
});

/* ---- Process signal handlers ---- */

function gracefulShutdown(signal: string): void {
  console.log(`\n[server] ${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });
  // Force exit after timeout
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_FORCE_EXIT_MS).unref();
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

