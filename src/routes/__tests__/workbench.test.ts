import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

function createMockWorkbench() {
  return {
    getState: vi.fn(() => ({ chatMode: 'new', running: false })),
    tasks: {
      add: vi.fn((questions: string[]) => questions.map((q, i) => ({ id: `t${i}`, question: q }))),
      remove: vi.fn((id: string) => id !== 'nonexistent'),
      clear: vi.fn(),
    },
    resources: {
      addAccount: vi.fn((_p: string, label: string, _dir: string) => ({ id: 'acc_1', label })),
      removeAccount: vi.fn((id: string) => id !== 'nonexistent'),
      resetAllQuotas: vi.fn(),
      all: vi.fn(() => []),
      byType: vi.fn(() => []),
      addResource: vi.fn((body: any) => ({ id: 'res_1', ...body })),
      removeResource: vi.fn((id: string) => id !== 'nonexistent'),
    },
    openLoginBrowser: vi.fn(async () => {}),
    closeLoginBrowser: vi.fn(async () => {}),
    setChatMode: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    getProviderList: vi.fn(() => [
      { id: 'chatgpt', label: 'ChatGPT' },
    ]),
    getSelectors: vi.fn(() => ({})),
    getModels: vi.fn(() => ['gpt-4o', 'gpt-4o-mini']),
    addCustomProvider: vi.fn((_id: string, _label: string) => ({ id: 'custom', label: 'Custom' })),
    addProviderFromUrl: vi.fn(async () => ({ id: 'detected', label: 'Detected' })),
    removeCustomProvider: vi.fn((id: string) => id !== 'nonexistent'),
    detectModels: vi.fn(async () => ['model-a', 'model-b']),
  };
}

describe('Workbench routes', () => {
  let routes: Array<{ method: string; pattern: RegExp; handler: Function }>;
  let wb: ReturnType<typeof createMockWorkbench>;
  let uploadDir: string;

  beforeEach(async () => {
    wb = createMockWorkbench();
    uploadDir = mkdtempSync(join(tmpdir(), 'wb-upload-'));
    const { workbenchRoutes } = await import('../workbench.js');
    routes = workbenchRoutes(wb as any, uploadDir);
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

  it('GET /api/state returns workbench state', async () => {
    const res = await callRoute('GET', '/api/state');
    expect(res._status).toBe(200);
    expect(res._body).toHaveProperty('chatMode');
  });

  it('POST /api/tasks creates tasks', async () => {
    const res = await callRoute('POST', '/api/tasks', '{"questions":["What is AI?"]}');
    expect(res._status).toBe(201);
    expect(wb.tasks.add).toHaveBeenCalled();
  });

  it('DELETE /api/tasks/:id removes a task', async () => {
    const res = await callRoute('DELETE', '/api/tasks/t1');
    expect(res._status).toBe(200);
  });

  it('DELETE /api/tasks/:id returns 404 for nonexistent', async () => {
    const res = await callRoute('DELETE', '/api/tasks/nonexistent');
    expect(res._status).toBe(404);
  });

  it('POST /api/tasks/clear clears all tasks', async () => {
    const res = await callRoute('POST', '/api/tasks/clear');
    expect(res._status).toBe(200);
    expect(wb.tasks.clear).toHaveBeenCalled();
  });

  it('POST /api/upload rejects empty files', async () => {
    const res = await callRoute('POST', '/api/upload', '{"files":[]}');
    expect(res._status).toBe(400);
  });

  it('POST /api/upload rejects disallowed extensions', async () => {
    const res = await callRoute('POST', '/api/upload', JSON.stringify({
      files: [{ name: 'malware.exe', data: Buffer.from('test').toString('base64') }],
    }));
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('not allowed');
  });

  it('POST /api/upload accepts valid file', async () => {
    const res = await callRoute('POST', '/api/upload', JSON.stringify({
      files: [{ name: 'test.txt', data: Buffer.from('hello').toString('base64') }],
    }));
    expect(res._status).toBe(200);
    expect(res._body.paths).toHaveLength(1);
    // Clean up
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('POST /api/accounts creates an account', async () => {
    const res = await callRoute('POST', '/api/accounts', '{"provider":"chatgpt","label":"My GPT","profileDir":"/tmp"}');
    expect(res._status).toBe(201);
  });

  it('DELETE /api/accounts/:id deletes account', async () => {
    const res = await callRoute('DELETE', '/api/accounts/acc_1');
    expect(res._status).toBe(200);
  });

  it('DELETE /api/accounts/:id returns 404 for nonexistent', async () => {
    const res = await callRoute('DELETE', '/api/accounts/nonexistent');
    expect(res._status).toBe(404);
  });

  it('POST /api/accounts/reset-quotas resets quotas', async () => {
    const res = await callRoute('POST', '/api/accounts/reset-quotas');
    expect(res._status).toBe(200);
    expect(wb.resources.resetAllQuotas).toHaveBeenCalled();
  });

  it('GET /api/resources returns all resources', async () => {
    const res = await callRoute('GET', '/api/resources');
    expect(res._status).toBe(200);
    expect(wb.resources.all).toHaveBeenCalled();
  });

  it('GET /api/resources/by-type/:type filters by type', async () => {
    const res = await callRoute('GET', '/api/resources/by-type/browser');
    expect(res._status).toBe(200);
    expect(wb.resources.byType).toHaveBeenCalledWith('browser');
  });

  it('POST /api/resources creates a resource', async () => {
    const res = await callRoute('POST', '/api/resources', JSON.stringify({
      type: 'browser', provider: 'chatgpt', label: 'GPT', siteUrl: 'https://chatgpt.com', profileDir: '/tmp', capabilities: {},
    }));
    expect(res._status).toBe(201);
  });

  it('POST /api/resources rejects missing fields', async () => {
    const res = await callRoute('POST', '/api/resources', '{"type":"browser"}');
    expect(res._status).toBe(400);
  });

  it('DELETE /api/resources/:id removes resource', async () => {
    const res = await callRoute('DELETE', '/api/resources/res_1');
    expect(res._status).toBe(200);
  });

  it('DELETE /api/resources/:id returns 404 for nonexistent', async () => {
    const res = await callRoute('DELETE', '/api/resources/nonexistent');
    expect(res._status).toBe(404);
  });

  it('POST /api/resources/reset-quotas resets quotas', async () => {
    const res = await callRoute('POST', '/api/resources/reset-quotas');
    expect(res._status).toBe(200);
    expect(wb.resources.resetAllQuotas).toHaveBeenCalledTimes(1);
  });

  it('POST /api/chat-mode sets mode', async () => {
    const res = await callRoute('POST', '/api/chat-mode', '{"mode":"continue"}');
    expect(res._status).toBe(200);
    expect(wb.setChatMode).toHaveBeenCalledWith('continue');
  });

  it('POST /api/chat-mode rejects invalid mode', async () => {
    const res = await callRoute('POST', '/api/chat-mode', '{"mode":"invalid"}');
    expect(res._status).toBe(400);
  });

  it('POST /api/start starts the workbench', async () => {
    const res = await callRoute('POST', '/api/start');
    expect(res._status).toBe(200);
  });

  it('POST /api/stop stops the workbench', async () => {
    const res = await callRoute('POST', '/api/stop');
    expect(res._status).toBe(200);
    expect(wb.stop).toHaveBeenCalled();
  });

  it('GET /api/providers returns provider list', async () => {
    const res = await callRoute('GET', '/api/providers');
    expect(res._status).toBe(200);
    expect(res._body).toHaveLength(1);
    expect(res._body[0]).toHaveProperty('models');
  });

  it('POST /api/providers creates a custom provider', async () => {
    const res = await callRoute('POST', '/api/providers', JSON.stringify({
      id: 'custom', label: 'Custom', selectors: { chatUrl: 'https://example.com' },
    }));
    expect(res._status).toBe(201);
  });

  it('POST /api/providers rejects missing fields', async () => {
    const res = await callRoute('POST', '/api/providers', '{"id":"x"}');
    expect(res._status).toBe(400);
  });

  it('POST /api/providers/from-url adds provider from URL', async () => {
    const res = await callRoute('POST', '/api/providers/from-url', '{"chatUrl":"https://chatgpt.com"}');
    expect(res._status).toBe(201);
  });

  it('POST /api/providers/from-url rejects empty URL', async () => {
    const res = await callRoute('POST', '/api/providers/from-url', '{"chatUrl":""}');
    expect(res._status).toBe(400);
  });

  it('DELETE /api/providers/:id removes provider', async () => {
    const res = await callRoute('DELETE', '/api/providers/chatgpt');
    expect(res._status).toBe(200);
  });

  it('DELETE /api/providers/:id returns 404 for nonexistent', async () => {
    const res = await callRoute('DELETE', '/api/providers/nonexistent');
    expect(res._status).toBe(404);
  });

  it('GET /api/models/:provider returns models', async () => {
    const res = await callRoute('GET', '/api/models/chatgpt');
    expect(res._status).toBe(200);
    expect(res._body).toContain('gpt-4o');
  });

  it('POST /api/models/:provider detects models', async () => {
    const res = await callRoute('POST', '/api/models/chatgpt');
    expect(res._status).toBe(200);
    expect(wb.detectModels).toHaveBeenCalledWith('chatgpt');
  });

  it('route patterns match expected URLs', () => {
    expect(findRoute('GET', '/api/state')).not.toBeNull();
    expect(findRoute('POST', '/api/tasks')).not.toBeNull();
    expect(findRoute('DELETE', '/api/tasks/some-id')).not.toBeNull();
    expect(findRoute('POST', '/api/tasks/clear')).not.toBeNull();
    expect(findRoute('POST', '/api/upload')).not.toBeNull();
    expect(findRoute('POST', '/api/accounts')).not.toBeNull();
    expect(findRoute('DELETE', '/api/accounts/acc1')).not.toBeNull();
    expect(findRoute('POST', '/api/accounts/reset-quotas')).not.toBeNull();
    expect(findRoute('GET', '/api/resources')).not.toBeNull();
    expect(findRoute('POST', '/api/resources')).not.toBeNull();
    expect(findRoute('POST', '/api/chat-mode')).not.toBeNull();
    expect(findRoute('POST', '/api/start')).not.toBeNull();
    expect(findRoute('POST', '/api/stop')).not.toBeNull();
    expect(findRoute('GET', '/api/providers')).not.toBeNull();
    expect(findRoute('POST', '/api/providers')).not.toBeNull();
    expect(findRoute('POST', '/api/providers/from-url')).not.toBeNull();
    expect(findRoute('DELETE', '/api/providers/some-id')).not.toBeNull();
    expect(findRoute('GET', '/api/models/chatgpt')).not.toBeNull();
    expect(findRoute('POST', '/api/models/chatgpt')).not.toBeNull();
  });
});
