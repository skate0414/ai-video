import { describe, expect, it, vi } from 'vitest';
import type { AIAdapter } from '../types.js';
import {
  AIRequestAbortedError,
  AIRequestTimeoutError,
  DEFAULT_AI_TIMEOUT_MS,
  createControlledAdapter,
  createSessionScopedAdapter,
  runWithAICallControl,
} from '../aiControl.js';

describe('aiControl', () => {
  it('times out unresolved AI calls', async () => {
    const promise = runWithAICallControl(
      () => new Promise<string>(() => {}),
      { label: 'test text call', timeoutMs: 20 },
    );

    await expect(promise).rejects.toBeInstanceOf(AIRequestTimeoutError);
  });

  it('aborts unresolved AI calls via signal', async () => {
    const controller = new AbortController();
    const promise = runWithAICallControl(
      () => new Promise<string>(() => {}),
      { label: 'test abort call', signal: controller.signal },
    );

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(AIRequestAbortedError);
  });

  it('injects timeout and signal into controlled adapters', async () => {
    const adapter: AIAdapter = {
      provider: 'mock',
      generateText: vi.fn().mockResolvedValue({ text: 'ok' }),
      generateImage: vi.fn().mockResolvedValue({ imageUrl: 'image.png' }),
      generateVideo: vi.fn().mockResolvedValue({ videoUrl: 'video.mp4' }),
    };
    const controller = new AbortController();
    const wrapped = createControlledAdapter(adapter, {
      projectId: 'proj_1',
      stage: 'SCRIPT_GENERATION',
      taskType: 'script_generation',
      signal: controller.signal,
    });

    await wrapped.generateText('', 'hello');

    expect(adapter.generateText).toHaveBeenCalledWith(
      '',
      'hello',
      expect.objectContaining({
        timeoutMs: DEFAULT_AI_TIMEOUT_MS.text,
        signal: controller.signal,
      }),
    );
  });

  it('injects per-project session metadata without mutating caller options', async () => {
    const adapter: AIAdapter = {
      provider: 'mock',
      generateText: vi.fn().mockResolvedValue({ text: 'ok' }),
      generateImage: vi.fn().mockResolvedValue({ imageUrl: 'image.png' }),
      generateVideo: vi.fn().mockResolvedValue({ videoUrl: 'video.mp4' }),
    };

    const wrapped = createSessionScopedAdapter(adapter, {
      sessionId: 'session_proj_1_creation',
      continueChat: true,
    });

    await wrapped.generateText('', 'hello', { timeoutMs: 999 });

    expect(adapter.generateText).toHaveBeenCalledWith(
      '',
      'hello',
      expect.objectContaining({
        timeoutMs: 999,
        sessionId: 'session_proj_1_creation',
        continueChat: true,
      }),
    );
  });
});