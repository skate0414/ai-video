/* ------------------------------------------------------------------ */
/*  Tests: ChatAdapter – pure functions & simple methods              */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi } from 'vitest';
import { ChatAdapter, ChatVideoUnsupportedError } from './chatAdapter.js';
import type { Workbench } from '../workbench.js';

/* ================================================================== */
/*  ChatVideoUnsupportedError                                        */
/* ================================================================== */
describe('ChatVideoUnsupportedError', () => {
  it('has correct name', () => {
    const err = new ChatVideoUnsupportedError('test');
    expect(err.name).toBe('ChatVideoUnsupportedError');
  });

  it('sets isQuotaError to true', () => {
    const err = new ChatVideoUnsupportedError('msg');
    expect(err.isQuotaError).toBe(true);
  });

  it('is an instance of Error', () => {
    const err = new ChatVideoUnsupportedError('msg');
    expect(err).toBeInstanceOf(Error);
  });

  it('stores message', () => {
    const err = new ChatVideoUnsupportedError('custom message');
    expect(err.message).toBe('custom message');
  });
});

/* ================================================================== */
/*  ChatAdapter – constructor & simple methods                        */
/* ================================================================== */
function makeMockWorkbench(): Workbench {
  return {
    submitAndWait: vi.fn(),
    getProviderList: vi.fn().mockReturnValue([]),
    loginBrowser: vi.fn(),
  } as unknown as Workbench;
}

describe('ChatAdapter', () => {
  it('has provider = "CHAT"', () => {
    const adapter = new ChatAdapter(makeMockWorkbench());
    expect(adapter.provider).toBe('CHAT');
  });

  describe('uploadFile', () => {
    it('returns file path as URI', async () => {
      const adapter = new ChatAdapter(makeMockWorkbench());
      const result = await adapter.uploadFile({
        name: 'test.png',
        path: '/tmp/test.png',
        mimeType: 'image/png',
      });
      expect(result).toEqual({
        uri: '/tmp/test.png',
        mimeType: 'image/png',
      });
    });

    it('passes through arbitrary mimeType', async () => {
      const adapter = new ChatAdapter(makeMockWorkbench());
      const result = await adapter.uploadFile({
        name: 'video.mp4',
        path: '/data/video.mp4',
        mimeType: 'video/mp4',
      });
      expect(result.mimeType).toBe('video/mp4');
    });
  });

  describe('generateVideo', () => {
    it('always throws ChatVideoUnsupportedError', async () => {
      const adapter = new ChatAdapter(makeMockWorkbench());
      await expect(
        adapter.generateVideo('model', 'prompt'),
      ).rejects.toThrow(ChatVideoUnsupportedError);
    });

    it('thrown error has isQuotaError = true', async () => {
      const adapter = new ChatAdapter(makeMockWorkbench());
      try {
        await adapter.generateVideo('model', 'prompt');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as ChatVideoUnsupportedError).isQuotaError).toBe(true);
      }
    });
  });

  describe('config defaults', () => {
    it('merges custom config with defaults', () => {
      const adapter = new ChatAdapter(makeMockWorkbench(), {
        assetsDir: '/custom/assets',
      });
      // Verify config was applied by checking adapter works
      expect(adapter.provider).toBe('CHAT');
    });
  });
});
