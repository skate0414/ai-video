import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

function createMockRequest(body: string, method = 'GET', url = '/'): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  (stream as any).method = method;
  (stream as any).url = url;
  (stream as any).headers = {};
  return stream as unknown as IncomingMessage;
}

function createMockResponse(): ServerResponse & { _status: number; _body: any; _headers: Record<string, any> } {
  const res = {
    _status: 0,
    _body: null as any,
    _headers: {} as Record<string, any>,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, any>) {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    setHeader(name: string, value: any) {
      res._headers[name] = value;
      return res;
    },
    end(body?: string) {
      if (body) {
        try { res._body = JSON.parse(body); } catch { res._body = body; }
      }
    },
    write: vi.fn(),
    pipe: vi.fn(),
  } as any;
  return res;
}

function createMockService() {
  return {
    getProviderCount: vi.fn(() => 0),
    getApiResourceCount: vi.fn(() => 0),
    hasApiKey: vi.fn(() => false),
    getDataDir: vi.fn(() => '/tmp/test-data'),
    completeSetup: vi.fn(() => ({ ok: true })),
  };
}

describe('Setup routes', () => {
  let routes: Array<{ method: string; pattern: RegExp; handler: Function }>;
  let svc: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    svc = createMockService();
    const { setupRoutes } = await import('../setup.js');
    routes = setupRoutes(svc as any);
  });

  function findRoute(method: string, path: string) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(path);
      if (match) return { route, match };
    }
    return null;
  }

  async function callRoute(method: string, path: string, body = '{}') {
    const found = findRoute(method, path);
    if (!found) throw new Error(`No route matched: ${method} ${path}`);
    const req = createMockRequest(body, method, path);
    const res = createMockResponse();
    await found.route.handler(req, res, found.match);
    return res;
  }

  it('GET /api/setup/status returns setup status', async () => {
    const res = await callRoute('GET', '/api/setup/status');
    expect(res._status).toBe(200);
    expect(res._body).toHaveProperty('needsSetup');
    expect(res._body).toHaveProperty('dataDir');
    expect(res._body).toHaveProperty('ffmpegAvailable');
    expect(res._body).toHaveProperty('playwrightAvailable');
    expect(res._body).toHaveProperty('chromiumAvailable');
    expect(res._body).toHaveProperty('nodeVersion');
    expect(res._body).toHaveProperty('platform');
    expect(res._body).toHaveProperty('accountCount');
    expect(res._body).toHaveProperty('apiResourceCount');
  });

  it('GET /api/setup/status needsSetup is true when no providers', async () => {
    svc.getProviderCount.mockReturnValue(0);
    svc.hasApiKey.mockReturnValue(false);
    const res = await callRoute('GET', '/api/setup/status');
    expect(res._body.needsSetup).toBe(true);
  });

  it('GET /api/setup/status needsSetup is false when providers exist', async () => {
    svc.getProviderCount.mockReturnValue(2);
    const res = await callRoute('GET', '/api/setup/status');
    expect(res._body.needsSetup).toBe(false);
  });

  it('POST /api/setup/complete calls completeSetup', async () => {
    const res = await callRoute('POST', '/api/setup/complete', '{"aivideomakerApiKey":"test-key"}');
    expect(svc.completeSetup).toHaveBeenCalledWith({ aivideomakerApiKey: 'test-key' });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
  });

  it('route patterns exist for expected endpoints', () => {
    expect(findRoute('GET', '/api/setup/status')).not.toBeNull();
    expect(findRoute('POST', '/api/setup/install-browser')).not.toBeNull();
    expect(findRoute('POST', '/api/setup/install-edge-tts')).not.toBeNull();
    expect(findRoute('POST', '/api/setup/complete')).not.toBeNull();
  });
});
