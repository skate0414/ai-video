import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { workbenchRoutes } from './workbench.js';

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

describe('workbenchRoutes', () => {
  const workbench = {
    getState: vi.fn(() => ({ chatMode: 'new', tasks: [], accounts: [] })),
    tasks: {
      add: vi.fn(() => [{ id: 't1' }]),
      remove: vi.fn(() => true),
      clear: vi.fn(),
    },
    resources: {
      addAccount: vi.fn(() => ({ id: 'acc1' })),
      removeAccount: vi.fn(() => true),
      resetAllQuotas: vi.fn(),
      all: vi.fn(() => []),
      byType: vi.fn(() => []),
      addResource: vi.fn(() => ({ id: 'res1' })),
      removeResource: vi.fn(() => true),
    },
    openLoginBrowser: vi.fn(async () => {}),
    closeLoginBrowser: vi.fn(async () => {}),
    setChatMode: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    getProviderList: vi.fn(() => [{ id: 'chatgpt', label: 'ChatGPT', builtin: true }]),
    getSelectors: vi.fn(() => ({ chatUrl: 'https://chatgpt.com', promptInput: 'textarea', responseBlock: '.x', readyIndicator: 'textarea' })),
    getModels: vi.fn(() => [{ id: 'default', label: 'Default' }]),
    addCustomProvider: vi.fn(() => ({ id: 'x', label: 'X', builtin: false })),
    addProviderFromUrl: vi.fn(async () => ({ providerId: 'x', accountId: 'a1' })),
    removeCustomProvider: vi.fn(() => true),
    detectModels: vi.fn(async () => [{ id: 'm1', label: 'M1' }]),
  } as any;

  const routes = workbenchRoutes(workbench, '/tmp/uploads');

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

  it('returns state via GET /api/state', async () => {
    const res = await callRoute('GET', '/api/state');
    expect(res._status).toBe(200);
    expect(workbench.getState).toHaveBeenCalled();
    expect(res._body.chatMode).toBe('new');
  });

  it('creates tasks via POST /api/tasks', async () => {
    const body = JSON.stringify({ questions: ['q1', 'q2'], preferredProvider: 'chatgpt' });
    const res = await callRoute('POST', '/api/tasks', body);
    expect(res._status).toBe(201);
    expect(workbench.tasks.add).toHaveBeenCalled();
    expect(res._body[0].id).toBe('t1');
  });

  it('validates chat mode via POST /api/chat-mode', async () => {
    const bad = await callRoute('POST', '/api/chat-mode', JSON.stringify({ mode: 'bad' }));
    expect(bad._status).toBe(400);

    const ok = await callRoute('POST', '/api/chat-mode', JSON.stringify({ mode: 'continue' }));
    expect(ok._status).toBe(200);
    expect(workbench.setChatMode).toHaveBeenCalledWith('continue');
  });

  it('validates required fields for POST /api/providers', async () => {
    const bad = await callRoute('POST', '/api/providers', JSON.stringify({ id: '', label: '', selectors: {} }));
    expect(bad._status).toBe(400);

    const ok = await callRoute('POST', '/api/providers', JSON.stringify({
      id: 'my',
      label: 'My Provider',
      selectors: { chatUrl: 'https://my.example' },
    }));
    expect(ok._status).toBe(201);
    expect(workbench.addCustomProvider).toHaveBeenCalled();
  });
});
