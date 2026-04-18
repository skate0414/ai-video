import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  GeminiAdapter unit tests – mock the Google GenAI SDK               */
/* ------------------------------------------------------------------ */

// Stub @google/genai before GeminiAdapter is imported
const generateContentMock = vi.fn();
const generateImagesMock = vi.fn();
const generateVideosMock = vi.fn();
const getVideosOperationMock = vi.fn();
const filesUploadMock = vi.fn();
const filesGetMock = vi.fn();

vi.mock('@google/genai', () => ({
  Modality: { AUDIO: 'AUDIO' },
  GoogleGenAI: class {
    models = {
      generateContent: generateContentMock,
      generateImages: generateImagesMock,
      generateVideos: generateVideosMock,
    };
    operations = { getVideosOperation: getVideosOperationMock };
    files = { upload: filesUploadMock, get: filesGetMock };
  },
}));

// Stub aiControl to pass through directly
vi.mock('../pipeline/aiControl.js', () => ({
  runWithAICallControl: (fn: () => Promise<any>) => fn(),
  throwIfAborted: () => {},
  waitWithAbort: (ms: number) => new Promise(r => setTimeout(r, Math.min(ms, 10))),
}));

import { GeminiAdapter } from './geminiAdapter.js';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter('test-api-key');
  });

  /* ---- generateText ---- */

  describe('generateText', () => {
    it('returns text from a successful response', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{
          content: { parts: [{ text: 'Hello, world!' }] },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      });

      const result = await adapter.generateText('gemini-pro', 'Say hello');
      expect(result.text).toBe('Hello, world!');
      expect(result.model).toBe('gemini-pro');
      expect(result.tokenUsage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('parses JSON when responseSchema is set', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{
          content: { parts: [{ text: '{"scenes": 3}' }] },
        }],
      });

      const result = await adapter.generateText('gemini-pro', 'Count scenes', {
        responseSchema: { type: 'object' },
      });
      expect(result.data).toEqual({ scenes: 3 });
    });

    it('strips markdown fences when parsing JSON', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{
          content: { parts: [{ text: '```json\n{"ok": true}\n```' }] },
        }],
      });

      const result = await adapter.generateText('gemini-pro', 'test', {
        responseMimeType: 'application/json',
      });
      expect(result.data).toEqual({ ok: true });
    });

    it('returns empty text when candidates are missing', async () => {
      generateContentMock.mockResolvedValueOnce({});

      const result = await adapter.generateText('gemini-pro', 'hello');
      expect(result.text).toBe('');
    });

    it('joins multiple parts into single text', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{
          content: { parts: [{ text: 'Part A. ' }, { text: 'Part B.' }] },
        }],
      });

      const result = await adapter.generateText('gemini-pro', 'test');
      expect(result.text).toBe('Part A. Part B.');
    });

    it('forwards temperature and system instruction to SDK config', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      });

      await adapter.generateText('gemini-pro', 'test', {
        temperature: 0.5,
        systemInstruction: 'Be helpful',
      });

      const callArg = generateContentMock.mock.calls[0][0];
      expect(callArg.config.temperature).toBe(0.5);
      expect(callArg.config.systemInstruction).toBe('Be helpful');
    });

    it('retries on 429 errors and succeeds', async () => {
      const err429 = Object.assign(new Error('Resource exhausted'), { status: 429 });
      generateContentMock
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        });

      const result = await adapter.generateText('gemini-pro', 'test');
      expect(result.text).toBe('ok');
      expect(generateContentMock).toHaveBeenCalledTimes(2);
    });

    it('retries on 500/503 server errors', async () => {
      const err500 = Object.assign(new Error('Internal error'), { status: 500 });
      generateContentMock
        .mockRejectedValueOnce(err500)
        .mockResolvedValueOnce({
          candidates: [{ content: { parts: [{ text: 'recovered' }] } }],
        });

      const result = await adapter.generateText('gemini-pro', 'test');
      expect(result.text).toBe('recovered');
    });

    it('does not retry non-transient errors (e.g. 400)', async () => {
      const err400 = Object.assign(new Error('Bad request'), { status: 400 });
      generateContentMock.mockRejectedValueOnce(err400);

      await expect(adapter.generateText('gemini-pro', 'test')).rejects.toThrow('Bad request');
      expect(generateContentMock).toHaveBeenCalledTimes(1);
    });

    it('tags quota errors with isQuotaError', async () => {
      const quotaErr = new Error('quota exceeded') as any;
      quotaErr.status = 429;
      generateContentMock.mockRejectedValue(quotaErr);

      await expect(adapter.generateText('gemini-pro', 'test')).rejects.toThrow();
      expect(quotaErr.isQuotaError).toBe(true);
    });
  });

  /* ---- generateImage ---- */

  describe('generateImage', () => {
    it('returns base64 image from Gemini native gen', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{
          content: { parts: [{ inlineData: { data: 'abc123' } }] },
        }],
      });

      const result = await adapter.generateImage('gemini-3-pro', 'a cat');
      expect(result.base64).toBe('data:image/png;base64,abc123');
    });

    it('throws when no image is returned', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ text: 'sorry no image' }] } }],
      });

      await expect(adapter.generateImage('gemini-3-pro', 'a cat')).rejects.toThrow('No image returned');
    });

    it('uses Imagen endpoint for imagen models', async () => {
      generateImagesMock.mockResolvedValueOnce({
        generatedImages: [{ image: { imageBytes: 'img_bytes' } }],
      });

      const result = await adapter.generateImage('imagen-3.0-generate-002', 'test');
      expect(result.base64).toBe('data:image/jpeg;base64,img_bytes');
      expect(generateImagesMock).toHaveBeenCalled();
    });

    it('throws when Imagen returns no image', async () => {
      generateImagesMock.mockResolvedValueOnce({ generatedImages: [] });

      await expect(
        adapter.generateImage('imagen-3.0-generate-002', 'test'),
      ).rejects.toThrow('No image returned from Imagen');
    });
  });

  /* ---- generateVideo ---- */

  describe('generateVideo', () => {
    it('polls operation until done and returns video data URL', async () => {
      const videoBase64 = Buffer.from('fake-video-bytes').toString('base64');
      const fakeVideoBuffer = Buffer.from('fake-video-bytes');

      generateVideosMock.mockResolvedValueOnce({ done: false });
      getVideosOperationMock.mockResolvedValueOnce({
        done: true,
        response: {
          generatedVideos: [{
            video: { uri: 'https://example.com/video.mp4' },
            durationMs: 5000,
          }],
        },
      });

      // Mock global fetch for video download
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeVideoBuffer.buffer),
      }) as any;

      try {
        const result = await adapter.generateVideo('veo-2.0', 'a sunset');
        expect(result.videoUrl).toContain('data:video/mp4;base64,');
        expect(result.durationMs).toBe(5000);
        expect(result.model).toBe('veo-2.0');
        expect(getVideosOperationMock).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('throws when operation completes but no URI returned', async () => {
      generateVideosMock.mockResolvedValueOnce({
        done: true,
        response: { generatedVideos: [{ video: {} }] },
      });

      await expect(
        adapter.generateVideo('veo-2.0', 'test'),
      ).rejects.toThrow('no URI returned');
    });

    it('throws when video download fails', async () => {
      generateVideosMock.mockResolvedValueOnce({
        done: true,
        response: {
          generatedVideos: [{ video: { uri: 'https://example.com/v.mp4' } }],
        },
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }) as any;

      try {
        await expect(
          adapter.generateVideo('veo-2.0', 'test'),
        ).rejects.toThrow('Failed to download');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('passes image data when provided', async () => {
      generateVideosMock.mockResolvedValueOnce({
        done: true,
        response: {
          generatedVideos: [{ video: { uri: 'https://example.com/v.mp4' } }],
        },
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('video').buffer),
      }) as any;

      try {
        await adapter.generateVideo('veo-2.0', 'test', {
          image: 'data:image/png;base64,abc123',
        });

        const callArg = generateVideosMock.mock.calls[0][0];
        expect(callArg.image).toEqual({
          imageBytes: 'abc123',
          mimeType: 'image/png',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  /* ---- generateSpeech ---- */

  describe('generateSpeech', () => {
    it('returns WAV audio data URL', async () => {
      // Create fake PCM base64 (just enough to test the conversion path)
      const pcmBytes = Buffer.alloc(100, 0);
      const pcmBase64 = pcmBytes.toString('base64');

      generateContentMock.mockResolvedValueOnce({
        candidates: [{
          content: { parts: [{ inlineData: { data: pcmBase64 } }] },
        }],
      });

      const result = await adapter.generateSpeech('Hello world');
      expect(result.audioUrl).toContain('data:audio/wav;base64,');
      expect(result.model).toBe('gemini-2.5-flash-preview-tts');
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('estimates longer duration for Chinese text', async () => {
      const pcmBase64 = Buffer.alloc(100, 0).toString('base64');
      generateContentMock.mockResolvedValueOnce({
        candidates: [{
          content: { parts: [{ inlineData: { data: pcmBase64 } }] },
        }],
      });

      const result = await adapter.generateSpeech('你好世界这是一段中文');
      // Chinese estimation: chars * 0.3, min 2
      expect(result.durationMs).toBeGreaterThanOrEqual(2000);
    });

    it('throws when no audio returned', async () => {
      generateContentMock.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ text: 'no audio' }] } }],
      });

      await expect(adapter.generateSpeech('test')).rejects.toThrow('No audio returned');
    });
  });

  /* ---- uploadFile ---- */

  describe('uploadFile', () => {
    it('uploads and polls until ACTIVE', async () => {
      filesUploadMock.mockResolvedValueOnce({
        name: 'files/abc',
        state: 'PROCESSING',
        uri: 'gs://bucket/file',
        mimeType: 'video/mp4',
      });
      filesGetMock.mockResolvedValueOnce({
        name: 'files/abc',
        state: 'ACTIVE',
        uri: 'gs://bucket/file',
        mimeType: 'video/mp4',
      });

      const result = await adapter.uploadFile({
        name: 'test.mp4',
        path: '/dev/null',
        mimeType: 'video/mp4',
      });
      expect(result.uri).toBe('gs://bucket/file');
      expect(result.mimeType).toBe('video/mp4');
    });

    it('throws when file processing fails', async () => {
      filesUploadMock.mockResolvedValueOnce({
        name: 'files/abc',
        state: 'FAILED',
        error: { message: 'invalid format' },
      });

      await expect(
        adapter.uploadFile({ name: 'bad.xyz', path: '/dev/null', mimeType: 'video/mp4' }),
      ).rejects.toThrow('File processing failed');
    });
  });
});
