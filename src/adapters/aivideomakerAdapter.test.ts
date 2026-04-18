import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  AIVideoMakerAdapter unit tests – mock fetch calls                  */
/* ------------------------------------------------------------------ */

// Stub aiControl to pass through directly
vi.mock('../pipeline/aiControl.js', () => ({
  runWithAICallControl: (fn: () => Promise<any>) => fn(),
  throwIfAborted: () => {},
  waitWithAbort: (ms: number) => new Promise(r => setTimeout(r, Math.min(ms, 10))),
}));

import { AIVideoMakerAdapter } from './aivideomakerAdapter.js';

describe('AIVideoMakerAdapter', () => {
  let adapter: AIVideoMakerAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    adapter = new AIVideoMakerAdapter('test-api-key-123');
  });

  /* ---- basic properties ---- */

  it('has provider set to aivideomaker', () => {
    expect(adapter.provider).toBe('aivideomaker');
  });

  it('throws for generateText', async () => {
    await expect(adapter.generateText('model', 'prompt')).rejects.toThrow('does not support text generation');
  });

  it('throws for generateImage', async () => {
    await expect(adapter.generateImage('model', 'prompt')).rejects.toThrow('does not support image generation');
  });

  /* ---- generateVideo ---- */

  describe('generateVideo', () => {
    it('creates a t2v task when no image is provided', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      // Create task response
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-001', statusUrl: '/api/v1/tasks/task-001/status', responseUrl: '/api/v1/tasks/task-001' }),
        { status: 200 },
      ));

      // Poll status — completed immediately
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'COMPLETED' }),
        { status: 200 },
      ));

      // Task details
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-001', status: 'COMPLETED', output: 'https://example.com/video.mp4' }),
        { status: 200 },
      ));

      // Download video
      const videoData = Buffer.from('fake-video-content');
      fetchMock.mockResolvedValueOnce(new Response(videoData, { status: 200 }));

      const result = await adapter.generateVideo('', 'A beautiful sunset');

      expect(result.videoUrl).toMatch(/^data:video\/mp4;base64,/);
      expect(result.durationMs).toBe(5000);
      expect(result.model).toBe('t2v');

      // Verify create call used t2v endpoint
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const createCall = fetchMock.mock.calls[0];
      expect(createCall[0]).toBe('https://aivideomaker.ai/api/v1/generate/t2v');

      // Verify API key header
      const headers = createCall[1]?.headers as Record<string, string>;
      expect(headers.key).toBe('test-api-key-123');
    });

    it('uses i2v model when image is provided', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-002', statusUrl: '', responseUrl: '' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'COMPLETED' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-002', status: 'COMPLETED', output: 'https://example.com/video2.mp4' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(Buffer.from('video'), { status: 200 }));

      await adapter.generateVideo('', 'Animate this image', {
        image: 'data:image/png;base64,iVBOmockdata',
        duration: 5,
      });

      const createUrl = fetchMock.mock.calls[0][0] as string;
      expect(createUrl).toBe('https://aivideomaker.ai/api/v1/generate/i2v');

      // Verify image data in request body (full data URI passed through)
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      expect(body.image).toBe('data:image/png;base64,iVBOmockdata');
    });

    it('uses v3 model for durations > 8s', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-003', statusUrl: '', responseUrl: '' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'COMPLETED' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-003', status: 'COMPLETED', output: 'https://example.com/video3.mp4' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(Buffer.from('video'), { status: 200 }));

      const result = await adapter.generateVideo('', 'Long video', { duration: 15 });

      const createUrl = fetchMock.mock.calls[0][0] as string;
      expect(createUrl).toBe('https://aivideomaker.ai/api/v1/generate/t2v_v3');
      expect(result.model).toBe('t2v_v3');
      expect(result.durationMs).toBe(15000);
    });

    it('uses explicit model when provided', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-004', statusUrl: '', responseUrl: '' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'COMPLETED' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-004', status: 'COMPLETED', output: 'https://example.com/v.mp4' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(Buffer.from('v'), { status: 200 }));

      await adapter.generateVideo('lv', 'prompt');

      const createUrl = fetchMock.mock.calls[0][0] as string;
      expect(createUrl).toBe('https://aivideomaker.ai/api/v1/generate/lv');
    });

    it('throws quota error on insufficient credits', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        'Insufficient credits',
        { status: 402 },
      ));

      await expect(adapter.generateVideo('', 'prompt')).rejects.toMatchObject({
        message: expect.stringContaining('Insufficient credits'),
        isQuotaError: true,
      });
    });

    it('throws on FAILED task status', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-fail', statusUrl: '', responseUrl: '' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'FAILED' }),
        { status: 200 },
      ));

      await expect(adapter.generateVideo('', 'prompt')).rejects.toThrow('task-fail failed');
    });

    it('throws on CANCEL task status', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-cancel', statusUrl: '', responseUrl: '' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'CANCEL' }),
        { status: 200 },
      ));

      await expect(adapter.generateVideo('', 'prompt')).rejects.toThrow('was cancelled');
    });

    it('polls through PROGRESS status before completing', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-poll', statusUrl: '', responseUrl: '' }),
        { status: 200 },
      ));
      // First poll: PROGRESS
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'PROGRESS' }),
        { status: 200 },
      ));
      // Second poll: COMPLETED
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'COMPLETED' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-poll', status: 'COMPLETED', output: 'https://example.com/v.mp4' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(Buffer.from('data'), { status: 200 }));

      const result = await adapter.generateVideo('', 'prompt');
      expect(result.videoUrl).toMatch(/^data:video\/mp4;base64,/);
      // 5 fetch calls: create + 2 polls + details + download
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('throws when completed task has no output URL', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-empty', statusUrl: '', responseUrl: '' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'COMPLETED' }),
        { status: 200 },
      ));
      fetchMock.mockResolvedValueOnce(new Response(
        JSON.stringify({ taskId: 'task-empty', status: 'COMPLETED' }),
        { status: 200 },
      ));

      await expect(adapter.generateVideo('', 'prompt')).rejects.toThrow('no output URL');
    });
  });
});
