import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setupRoutes } from './setup.js';

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
        try {
          res._body = JSON.parse(body);
        } catch {
          res._body = body;
        }
      }
      return res;
    },
    write(chunk: any) {
      return chunk;
    },
  };
  return res as unknown as ServerResponse & { _status: number; _body: any; _headers: Record<string, any> };
}

describe('setupRoutes', () => {
  const svc = {
    getProviderCount: vi.fn(() => 1),
    getApiResourceCount: vi.fn(() => 2),
    hasApiKey: vi.fn(() => true),
    getDataDir: vi.fn(() => '/tmp/data'),
    completeSetup: vi.fn((body: any) => ({ ok: true, body })),
  } as any;

  const routes = setupRoutes(svc);

  const findRoute = (method: string, url: string) => {
    return routes.find(r => r.method === method && r.pattern.test(url));
  };

  async function callRoute(method: string, url: string, body = '') {
    const route = findRoute(method, url);
    expect(route).toBeDefined();
    const req = createMockRequest(body, method, url);
    const res = createMockResponse();
    const match = route!.pattern.exec(url);
    await route!.handler(req, res, match as any);
    return res;
  }

  it('returns setup status', async () => {
    const res = await callRoute('GET', '/api/setup/status');
    expect(res._status).toBe(200);
    expect(res._body.needsSetup).toBe(false);
    expect(res._body.dataDir).toBe('/tmp/data');
  });

  it('completes setup via POST /api/setup/complete', async () => {
    const body = { geminiApiKey: 'gk', aivideomakerApiKey: 'ak' };
    const res = await callRoute('POST', '/api/setup/complete', JSON.stringify(body));
    expect(res._status).toBe(200);
    expect(svc.completeSetup).toHaveBeenCalledWith(body);
    expect(res._body.ok).toBe(true);
  });
});
