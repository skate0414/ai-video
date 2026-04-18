/* ------------------------------------------------------------------ */
/*  Tests: bgmLibrary routes — list, stream, upload, from-library     */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/* ---- Minimal helpers to invoke routes without a live server ---- */

function fakeReq(body: string, method = 'GET', url = '/', headers: Record<string, string> = {}): IncomingMessage {
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

/** Tracks writeHead/end/pipe for both JSON and stream responses. */
function fakeRes(): ServerResponse & { _status: number; _body: any; _headers: Record<string, any>; _piped: boolean } {
  const res = {
    _status: 0,
    _body: null as any,
    _headers: {} as Record<string, any>,
    _piped: false,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, any>) {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    setHeader(k: string, v: any) { res._headers[k] = v; return res; },
    end(body?: string) { if (body) { try { res._body = JSON.parse(body); } catch { res._body = body; } } return res; },
    write() { return true; },
  };
  return res as any;
}

/** Patch fakeRes to capture pipe() calls (for stream endpoints). */
function fakeStreamRes() {
  const res = fakeRes();
  // pipe() is called on createReadStream, which pipes into res.
  // We intercept by making res writable enough for stream to write to.
  (res as any).on = () => res;
  (res as any).once = () => res;
  (res as any).emit = () => true;
  (res as any).removeListener = () => res;
  return res;
}

/* ---- Mock PipelineService ---- */

function createMockSvc(dataDir: string) {
  const projectDir = join(dataDir, 'projects', 'proj_test');
  mkdirSync(projectDir, { recursive: true });
  return {
    getDataDir: vi.fn().mockReturnValue(dataDir),
    getProjectDir: vi.fn().mockReturnValue(projectDir),
    loadProject: vi.fn().mockReturnValue({ id: 'proj_test', stageStatus: { ASSEMBLY: 'completed' } }),
  };
}

/* ---- Lazy-load routes ---- */

async function loadRoutes(svc: any) {
  const { bgmLibraryRoutes } = await import('./bgmLibrary.js');
  return bgmLibraryRoutes(svc as any);
}

async function loadRoutesWithBroadcast(svc: any, broadcastEvent?: (...args: any[]) => void) {
  const { bgmLibraryRoutes } = await import('./bgmLibrary.js');
  return bgmLibraryRoutes(svc as any, broadcastEvent);
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
/*  GET /api/bgm-library                                              */
/* ================================================================== */

describe('GET /api/bgm-library', () => {
  let dataDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'bgmlib-list-'));
    svc = createMockSvc(dataDir);
    routes = await loadRoutes(svc);
  });

  it('returns empty array for empty directory', async () => {
    const req = fakeReq('', 'GET', '/api/bgm-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual([]);
  });

  it('returns items with parsed mood + title from {mood}--{title}.mp3', async () => {
    const libDir = join(dataDir, 'bgm-library');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'happy--sunrise.mp3'), Buffer.alloc(64));
    writeFileSync(join(libDir, 'sad--rainy_day.wav'), Buffer.alloc(128));

    const req = fakeReq('', 'GET', '/api/bgm-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body).toHaveLength(2);

    const mp3 = res._body.find((i: any) => i.filename === 'happy--sunrise.mp3');
    expect(mp3).toBeDefined();
    expect(mp3.mood).toBe('happy');
    expect(mp3.title).toBe('sunrise');
    expect(mp3.size).toBe(64);

    const wav = res._body.find((i: any) => i.filename === 'sad--rainy_day.wav');
    expect(wav).toBeDefined();
    expect(wav.mood).toBe('sad');
    expect(wav.title).toBe('rainy_day');
  });

  it('falls back to mood="unknown" when filename has no "--"', async () => {
    const libDir = join(dataDir, 'bgm-library');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'relaxing.mp3'), Buffer.alloc(32));

    const req = fakeReq('', 'GET', '/api/bgm-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body).toHaveLength(1);
    expect(res._body[0].mood).toBe('unknown');
    expect(res._body[0].title).toBe('relaxing');
  });

  it('ignores non-audio files in the library directory', async () => {
    const libDir = join(dataDir, 'bgm-library');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'readme.txt'), 'notes');
    writeFileSync(join(libDir, 'track.mp3'), Buffer.alloc(16));
    writeFileSync(join(libDir, 'image.png'), Buffer.alloc(16));

    const req = fakeReq('', 'GET', '/api/bgm-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body).toHaveLength(1);
    expect(res._body[0].filename).toBe('track.mp3');
  });
});

/* ================================================================== */
/*  GET /api/bgm-library/:filename/stream                            */
/* ================================================================== */

describe('GET /api/bgm-library/:filename/stream', () => {
  let dataDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'bgmlib-stream-'));
    svc = createMockSvc(dataDir);
    routes = await loadRoutes(svc);
    const libDir = join(dataDir, 'bgm-library');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'happy--sunrise.mp3'), Buffer.alloc(1024, 0xAB));
  });

  it('returns 200 with full file when no Range header', async () => {
    const req = fakeReq('', 'GET', '/api/bgm-library/happy--sunrise.mp3/stream');
    const res = fakeStreamRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Length']).toBe(1024);
    expect(res._headers['Content-Type']).toBe('audio/mpeg');
    expect(res._headers['Accept-Ranges']).toBe('bytes');
  });

  it('returns 206 with Range header', async () => {
    const req = fakeReq('', 'GET', '/api/bgm-library/happy--sunrise.mp3/stream', { range: 'bytes=0-99' });
    const res = fakeStreamRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(206);
    expect(res._headers['Content-Range']).toBe('bytes 0-99/1024');
    expect(res._headers['Content-Length']).toBe(100);
  });

  it('returns 404 for non-existent file', async () => {
    const req = fakeReq('', 'GET', '/api/bgm-library/nope.mp3/stream');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('File not found');
  });

  it('rejects path traversal in filename', async () => {
    const req = fakeReq('', 'GET', '/api/bgm-library/..%2F..%2Fetc%2Fpasswd/stream');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    // basename strips traversal → file won't exist → 404
    expect(res._status).toBe(404);
  });
});

/* ================================================================== */
/*  POST /api/bgm-library/upload                                      */
/* ================================================================== */

describe('POST /api/bgm-library/upload', () => {
  let dataDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'bgmlib-upload-'));
    svc = createMockSvc(dataDir);
    routes = await loadRoutes(svc);
  });

  it('accepts multipart .mp3 upload', async () => {
    const audioData = Buffer.alloc(256, 0xFF);
    const req = fakeMultipartReq('chill--ocean_waves.mp3', audioData, 'POST', '/api/bgm-library/upload');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(201);
    expect(res._body.ok).toBe(true);
    expect(res._body.filename).toBe('chill--ocean_waves.mp3');
    expect(res._body.mood).toBe('chill');
    expect(res._body.title).toBe('ocean_waves');
    expect(res._body.size).toBe(256);

    // File written to library dir
    const libDir = join(dataDir, 'bgm-library');
    expect(existsSync(join(libDir, 'chill--ocean_waves.mp3'))).toBe(true);
  });

  it('handles upload without mood separator', async () => {
    const audioData = Buffer.alloc(64, 0x00);
    const req = fakeMultipartReq('ambient_track.mp3', audioData, 'POST', '/api/bgm-library/upload');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(201);
    expect(res._body.mood).toBe('unknown');
    expect(res._body.title).toBe('ambient_track');
  });

  it('rejects unsupported extensions', async () => {
    const req = fakeMultipartReq('virus.exe', Buffer.alloc(16), 'POST', '/api/bgm-library/upload');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('Unsupported format');
  });

  it('rejects .txt files', async () => {
    const req = fakeMultipartReq('notes.txt', Buffer.from('hello'), 'POST', '/api/bgm-library/upload');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
  });
});

/* ================================================================== */
/*  POST /api/pipeline/:id/bgm/from-library                          */
/* ================================================================== */

describe('POST /api/pipeline/:id/bgm/from-library', () => {
  let dataDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'bgmlib-import-'));
    svc = createMockSvc(dataDir);
    routes = await loadRoutes(svc);
    // Seed library with a file
    const libDir = join(dataDir, 'bgm-library');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'epic--battle_theme.mp3'), Buffer.alloc(512, 0xBB));
  });

  it('copies library file to project bgm dir', async () => {
    const body = JSON.stringify({ filename: 'epic--battle_theme.mp3' });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/bgm/from-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.filename).toBe('bgm.mp3');
    expect(res._body.size).toBe(512);

    // File exists in project bgm dir
    const bgmPath = join(svc.getProjectDir(), 'bgm', 'bgm.mp3');
    expect(existsSync(bgmPath)).toBe(true);
    expect(readFileSync(bgmPath)[0]).toBe(0xBB);
  });

  it('removes existing bgm.* before copying', async () => {
    // Pre-create a bgm.wav
    const bgmDir = join(svc.getProjectDir(), 'bgm');
    mkdirSync(bgmDir, { recursive: true });
    writeFileSync(join(bgmDir, 'bgm.wav'), Buffer.alloc(64));

    const body = JSON.stringify({ filename: 'epic--battle_theme.mp3' });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/bgm/from-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.filename).toBe('bgm.mp3');

    // Old file removed, new file present
    expect(existsSync(join(bgmDir, 'bgm.wav'))).toBe(false);
    expect(existsSync(join(bgmDir, 'bgm.mp3'))).toBe(true);
  });

  it('returns 404 when library file does not exist', async () => {
    const body = JSON.stringify({ filename: 'nonexistent.mp3' });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/bgm/from-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('Library file not found');
  });

  it('returns 404 for non-existent project', async () => {
    svc.loadProject.mockReturnValueOnce(null);
    const body = JSON.stringify({ filename: 'epic--battle_theme.mp3' });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/bgm/from-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('Project not found');
  });

  it('rejects unsupported extension', async () => {
    const body = JSON.stringify({ filename: 'script.sh' });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/bgm/from-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Unsupported audio format');
  });

  it('applies basename() to prevent path traversal', async () => {
    const body = JSON.stringify({ filename: '../../../etc/passwd.mp3' });
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/bgm/from-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    // basename strips to "passwd.mp3" → file doesn't exist in library → 404
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('Library file not found');
  });

  it('requires filename in body', async () => {
    const body = JSON.stringify({});
    const req = fakeReq(body, 'POST', '/api/pipeline/proj_test/bgm/from-library');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('filename is required');
  });
});

/* ================================================================== */
/*  POST /api/bgm-library/open-pixabay                               */
/* ================================================================== */

describe('POST /api/bgm-library/open-pixabay', () => {
  let dataDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'bgmlib-pixabay-'));
    svc = createMockSvc(dataDir);
    // Ensure no automation token by default
    delete process.env.ELECTRON_AUTOMATION_TOKEN;
    routes = await loadRoutesWithBroadcast(svc);
  });

  it('returns ok:false with fallbackUrl when no ELECTRON_AUTOMATION_TOKEN', async () => {
    const req = fakeReq(JSON.stringify({ mood: 'happy' }), 'POST', '/api/bgm-library/open-pixabay');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(false);
    expect(res._body.fallbackUrl).toContain('pixabay.com/music/search/');
    expect(res._body.fallbackUrl).toContain('happy');
  });

  it('builds correct Pixabay URL for calm mood', async () => {
    const req = fakeReq(JSON.stringify({ mood: 'calm' }), 'POST', '/api/bgm-library/open-pixabay');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._body.fallbackUrl).toBe('https://pixabay.com/music/search/calm/');
  });

  it('builds base URL for unknown mood', async () => {
    const req = fakeReq(JSON.stringify({ mood: 'mystical' }), 'POST', '/api/bgm-library/open-pixabay');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._body.fallbackUrl).toMatch(/^https:\/\/pixabay\.com\/music\/search\//);
  });

  it('handles missing mood (no body)', async () => {
    const req = fakeReq('{}', 'POST', '/api/bgm-library/open-pixabay');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(false);
    expect(res._body.fallbackUrl).toBeDefined();
  });
});

/* ================================================================== */
/*  POST /api/bgm-library/download-complete                          */
/* ================================================================== */

describe('POST /api/bgm-library/download-complete', () => {
  let dataDir: string;
  let svc: ReturnType<typeof createMockSvc>;
  let routes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let broadcastSpy: any;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'bgmlib-dlcomplete-'));
    svc = createMockSvc(dataDir);
    broadcastSpy = vi.fn();
    routes = await loadRoutesWithBroadcast(svc, broadcastSpy);
  });

  it('returns 400 if filePath or filename is missing', async () => {
    const req = fakeReq(JSON.stringify({ filePath: '/tmp/x.mp3' }), 'POST', '/api/bgm-library/download-complete');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('filePath and filename are required');
  });

  it('returns 404 if file does not exist', async () => {
    const body = JSON.stringify({ filePath: '/nonexistent/path/song.mp3', filename: 'happy--test_song.mp3' });
    const req = fakeReq(body, 'POST', '/api/bgm-library/download-complete');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('Downloaded file not found');
  });

  it('returns 400 for non-audio extension', async () => {
    const tmpFile = join(dataDir, 'script.sh');
    writeFileSync(tmpFile, Buffer.alloc(100));
    const body = JSON.stringify({ filePath: tmpFile, filename: 'script.sh' });
    const req = fakeReq(body, 'POST', '/api/bgm-library/download-complete');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Unsupported audio format');
  });

  it('copies valid audio file to library and broadcasts SSE event', async () => {
    const tmpFile = join(dataDir, 'happy--sunshine.mp3');
    writeFileSync(tmpFile, Buffer.alloc(1024));
    const body = JSON.stringify({ filePath: tmpFile, filename: 'happy--sunshine.mp3' });
    const req = fakeReq(body, 'POST', '/api/bgm-library/download-complete');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.filename).toBe('happy--sunshine.mp3');
    expect(res._body.mood).toBe('happy');
    expect(res._body.title).toBe('sunshine');
    // File should exist in library
    const libDir = join(dataDir, 'bgm-library');
    expect(existsSync(join(libDir, 'happy--sunshine.mp3'))).toBe(true);
    // SSE broadcast called
    expect(broadcastSpy).toHaveBeenCalledOnce();
    const event = broadcastSpy.mock.calls[0][0];
    expect(event.type).toBe('bgm_download_ready');
    expect(event.payload.filename).toBe('happy--sunshine.mp3');
    expect(event.payload.mood).toBe('happy');
  });

  it('rejects path traversal in filename', async () => {
    const tmpFile = join(dataDir, 'test.mp3');
    writeFileSync(tmpFile, Buffer.alloc(512));
    const body = JSON.stringify({ filePath: tmpFile, filename: '../../../etc/passwd.mp3' });
    const req = fakeReq(body, 'POST', '/api/bgm-library/download-complete');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    // The path traversal in title causes resolve() to escape the library dir,
    // which the path containment check catches → 403 Forbidden
    expect(res._status).toBe(403);
    expect(res._body.error).toBe('Forbidden');
  });

  it('rejects filePath with null bytes', async () => {
    const body = JSON.stringify({ filePath: '/tmp/test\0.mp3', filename: 'test.mp3' });
    const req = fakeReq(body, 'POST', '/api/bgm-library/download-complete');
    const res = fakeRes();
    await matchAndRun(routes, req, res);
    expect(res._status).toBe(403);
  });
});
