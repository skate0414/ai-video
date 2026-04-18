/* ------------------------------------------------------------------ */
/*  Tests: pipeline refine routes — upload-bgm, refine-options, etc.  */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_REFINE_OPTIONS } from '../../shared/types.js';

/* ---- Minimal helpers to invoke routes without a live server ---- */

function fakeReq(body: string, method = 'POST', url = '/', headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  Object.assign(stream, { method, url, headers: { 'content-type': 'application/json', ...headers } });
  return stream as unknown as IncomingMessage;
}

function fakeMultipartReq(filename: string, fileData: Buffer, method = 'POST', url = '/'): IncomingMessage {
  const boundary = '----TestBoundary' + Date.now();
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="bgm"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)]);
  const stream = Readable.from([body]);
  Object.assign(stream, { method, url, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  return stream as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { _status: number; _body: any } {
  const res = {
    _status: 0,
    _body: null as any,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, any>) { res._status = status; return res; },
    setHeader() { return res; },
    end(body?: string) { if (body) { try { res._body = JSON.parse(body); } catch { res._body = body; } } return res; },
    write() { return true; },
  };
  return res as any;
}

/* ---- Mock PipelineService ---- */

function createMockSvc(tmpDir: string) {
  let refineOptions = { ...DEFAULT_REFINE_OPTIONS };
  return {
    loadProject: vi.fn().mockReturnValue({ id: 'proj_test', stageStatus: { ASSEMBLY: 'completed' } }),
    getProjectDir: vi.fn().mockReturnValue(tmpDir),
    getRefineOptions: vi.fn().mockReturnValue(refineOptions),
    getRefineProvenance: vi.fn().mockReturnValue(['subtitlePreset', 'subtitleStyle']),
    getRefineReferenceDefaults: vi.fn().mockReturnValue({ ...DEFAULT_REFINE_OPTIONS, fadeInDuration: 0.5 }),
    updateRefineOptions: vi.fn().mockImplementation((_id: string, opts: any) => {
      refineOptions = opts;
      return opts;
    }),
    startReAssembly: vi.fn(),
  };
}

/* ---- Lazy-load routes to pick up the mocked svc ---- */

async function loadRoutes(svc: any) {
  const { pipelineRoutesV2 } = await import('./pipeline.js');
  return pipelineRoutesV2(svc as any);
}

async function matchAndRun(routes: any[], req: IncomingMessage, res: any) {
  for (const route of routes) {
    if (req.method !== route.method) continue;
    const m = (req as any).url?.match(route.pattern);
    if (m) return route.handler(req, res, m);
  }
  throw new Error(`No route matched ${(req as any).method} ${(req as any).url}`);
}

/* ================================================================== */

describe('upload-bgm route', () => {
  let tmpDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'refine-test-'));
    svc = createMockSvc(tmpDir);
    routes = await loadRoutes(svc);
  });

  it('rejects unsupported file extensions', async () => {
    const body = JSON.stringify({ filename: 'bgm.exe', data: Buffer.from('hello').toString('base64') });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('File type not allowed');
  });

  it('accepts .mp3 files', async () => {
    const audioData = Buffer.alloc(128, 0xff);
    const body = JSON.stringify({ filename: 'my-track.mp3', data: audioData.toString('base64') });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.filename).toBe('bgm.mp3');

    // Verify file was written
    const bgmDir = join(tmpDir, 'bgm');
    expect(existsSync(join(bgmDir, 'bgm.mp3'))).toBe(true);
  });

  it('accepts .wav, .aac, .m4a, .ogg', async () => {
    for (const ext of ['.wav', '.aac', '.m4a', '.ogg']) {
      const body = JSON.stringify({ filename: `track${ext}`, data: Buffer.from('data').toString('base64') });
      const req = fakeReq(body, 'POST', `/api/pipeline/proj_test/upload-bgm`);
      const res = fakeRes();
      await matchAndRun(routes, req, res);
      expect(res._status).toBe(200);
      expect(res._body.filename).toBe(`bgm${ext}`);
    }
  });

  it('rejects files exceeding 50 MB', async () => {
    // Create a base64 string that decodes to > 50MB
    const hugeData = Buffer.alloc(50 * 1024 * 1024 + 1, 0x00).toString('base64');
    const body = JSON.stringify({ filename: 'huge.mp3', data: hugeData });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    // Might be 400 from size check or from parseJsonBody limit
    expect(res._status).toBe(400);
  });

  it('rejects missing filename', async () => {
    const body = JSON.stringify({ data: Buffer.from('data').toString('base64') });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('filename and data are required');
  });

  it('strips path traversal from filename', async () => {
    const body = JSON.stringify({ filename: '../../../etc/passwd.mp3', data: Buffer.from('x').toString('base64') });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    // Should succeed — basename() strips path components, file saved as bgm.mp3
    expect(res._status).toBe(200);
    expect(res._body.filename).toBe('bgm.mp3');
    // Verify file is inside project directory
    const bgmPath = join(tmpDir, 'bgm', 'bgm.mp3');
    expect(existsSync(bgmPath)).toBe(true);
    expect(resolve(bgmPath).startsWith(resolve(tmpDir))).toBe(true);
  });

  it('does not leak server file path in response', async () => {
    const body = JSON.stringify({ filename: 'track.mp3', data: Buffer.from('x').toString('base64') });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    // Response should NOT contain full filesystem path
    expect(res._body.bgmPath).toBeUndefined();
    expect(JSON.stringify(res._body)).not.toContain(tmpDir);
  });

  it('returns 404 for non-existent project', async () => {
    svc.loadProject.mockReturnValueOnce(null);
    const body = JSON.stringify({ filename: 'track.mp3', data: Buffer.from('x').toString('base64') });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(404);
  });
});

describe('upload-bgm multipart', () => {
  let tmpDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'refine-mp-test-'));
    svc = createMockSvc(tmpDir);
    routes = await loadRoutes(svc);
  });

  it('accepts multipart .mp3 upload', async () => {
    const audioData = Buffer.alloc(128, 0xff);
    const req = fakeMultipartReq('my-track.mp3', audioData, 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.filename).toBe('bgm.mp3');
    expect(existsSync(join(tmpDir, 'bgm', 'bgm.mp3'))).toBe(true);
  });

  it('rejects unsupported extension via multipart', async () => {
    const req = fakeMultipartReq('malware.exe', Buffer.from('x'), 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('File type not allowed');
  });

  it('overwrites previous BGM on re-upload with different extension', async () => {
    // Upload .wav first
    const req1 = fakeMultipartReq('first.wav', Buffer.from('wav-data'), 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res1 = fakeRes();
    await matchAndRun(routes, req1, res1);
    expect(res1._status).toBe(200);
    expect(existsSync(join(tmpDir, 'bgm', 'bgm.wav'))).toBe(true);

    // Re-upload .mp3 — should remove old .wav
    const req2 = fakeMultipartReq('second.mp3', Buffer.from('mp3-data'), 'POST', '/api/pipeline/proj_test/upload-bgm');
    const res2 = fakeRes();
    await matchAndRun(routes, req2, res2);
    expect(res2._status).toBe(200);
    expect(existsSync(join(tmpDir, 'bgm', 'bgm.mp3'))).toBe(true);
    expect(existsSync(join(tmpDir, 'bgm', 'bgm.wav'))).toBe(false);
  });
});

describe('refine-options routes', () => {
  let tmpDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'refine-test-'));
    svc = createMockSvc(tmpDir);
    routes = await loadRoutes(svc);
  });

  it('GET returns default options', async () => {
    const req = fakeReq('', 'GET', '/api/pipeline/proj_test/refine-options');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(svc.getRefineOptions).toHaveBeenCalledWith('proj_test');
  });

  it('PUT updates options', async () => {
    const newOpts = { ...DEFAULT_REFINE_OPTIONS, bgmVolume: 0.5 };
    const req = fakeReq(JSON.stringify(newOpts), 'PUT', '/api/pipeline/proj_test/refine-options');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(svc.updateRefineOptions).toHaveBeenCalledWith('proj_test', expect.objectContaining({ bgmVolume: 0.5 }));
  });

  it('returns 404 for non-existent project', async () => {
    svc.loadProject.mockReturnValueOnce(null);
    const req = fakeReq('', 'GET', '/api/pipeline/proj_test/refine-options');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(404);
  });
});

describe('re-assemble route', () => {
  let tmpDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'refine-test-'));
    svc = createMockSvc(tmpDir);
    routes = await loadRoutes(svc);
  });

  it('starts re-assembly when ASSEMBLY is completed', async () => {
    const req = fakeReq('', 'POST', '/api/pipeline/proj_test/re-assemble');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(svc.startReAssembly).toHaveBeenCalledWith('proj_test');
  });

  it('rejects re-assembly when ASSEMBLY is not completed', async () => {
    svc.loadProject.mockReturnValueOnce({ id: 'proj_test', stageStatus: { ASSEMBLY: 'processing' } });
    const req = fakeReq('', 'POST', '/api/pipeline/proj_test/re-assemble');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('ASSEMBLY');
  });
});

describe('refine-reference-defaults route', () => {
  let tmpDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'refine-test-'));
    svc = createMockSvc(tmpDir);
    routes = await loadRoutes(svc);
  });

  it('GET returns reference defaults', async () => {
    const req = fakeReq('', 'GET', '/api/pipeline/proj_test/refine-reference-defaults');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(svc.getRefineReferenceDefaults).toHaveBeenCalledWith('proj_test');
    expect(res._body.fadeInDuration).toBe(0.5);
  });

  it('returns 404 for non-existent project', async () => {
    svc.loadProject.mockReturnValueOnce(null);
    const req = fakeReq('', 'GET', '/api/pipeline/proj_test/refine-reference-defaults');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(404);
  });
});
