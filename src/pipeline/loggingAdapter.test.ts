import { describe, it, expect, vi, beforeEach } from 'vitest';

const mkdirSyncMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  mkdirSync: mkdirSyncMock,
  existsSync: existsSyncMock,
  writeFileSync: writeFileSyncMock,
}));

import { createLoggingAdapter } from './loggingAdapter.js';
import type { AIAdapter, GenerationResult } from './types.js';

function makeInner(overrides: Partial<AIAdapter> = {}): AIAdapter {
  return {
    provider: 'test-provider',
    generateText: vi.fn().mockResolvedValue({
      text: 'hello',
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as GenerationResult) as any,
    generateImage: vi.fn().mockResolvedValue({
      imageUrl: 'data:image/png;base64,abc',
    } as GenerationResult) as any,
    generateVideo: vi.fn().mockResolvedValue({
      videoUrl: 'data:video/mp4;base64,xyz',
    } as GenerationResult) as any,
    ...overrides,
  };
}

describe('createLoggingAdapter', () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
    existsSyncMock.mockReset().mockReturnValue(false);
    writeFileSyncMock.mockReset();
  });

  it('creates log directory if missing', () => {
    existsSyncMock.mockReturnValue(false);
    createLoggingAdapter(makeInner(), '/tmp/project', 'research', 'text');
    expect(mkdirSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('ai-logs'),
      { recursive: true },
    );
  });

  it('skips mkdirSync if log directory exists', () => {
    existsSyncMock.mockReturnValue(true);
    createLoggingAdapter(makeInner(), '/tmp/project', 'research', 'text');
    expect(mkdirSyncMock).not.toHaveBeenCalled();
  });

  it('delegates generateText and writes log', async () => {
    const inner = makeInner();
    const adapter = createLoggingAdapter(inner, '/tmp/project', 'research', 'text');
    const result = await adapter.generateText('gpt-4', 'Tell me a joke');
    expect(result.text).toBe('hello');
    expect(inner.generateText).toHaveBeenCalledWith('gpt-4', 'Tell me a joke', undefined);
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const logContent = JSON.parse(writeFileSyncMock.mock.calls[0][1]);
    expect(logContent.stage).toBe('research');
    expect(logContent.taskType).toBe('text');
    expect(logContent.method).toBe('generateText');
    expect(logContent.provider).toBe('test-provider');
    expect(logContent.error).toBeUndefined();
  });

  it('logs error on generateText failure', async () => {
    const inner = makeInner({
      generateText: vi.fn().mockRejectedValue(new Error('quota exceeded')) as any,
    });
    const adapter = createLoggingAdapter(inner, '/tmp/project', 'storyboard', 'text');
    await expect(adapter.generateText('gpt-4', 'test')).rejects.toThrow('quota exceeded');
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const logContent = JSON.parse(writeFileSyncMock.mock.calls[0][1]);
    expect(logContent.error).toBe('quota exceeded');
  });

  it('delegates generateImage and writes log', async () => {
    const inner = makeInner();
    const adapter = createLoggingAdapter(inner, '/tmp/p', 'keyframe', 'image');
    const result = await adapter.generateImage('dall-e', 'sunset', '16:9', 'blurry');
    expect(result.imageUrl).toBe('data:image/png;base64,abc');
    expect(inner.generateImage).toHaveBeenCalledWith('dall-e', 'sunset', '16:9', 'blurry', undefined);
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('delegates generateVideo and writes log', async () => {
    const inner = makeInner();
    const adapter = createLoggingAdapter(inner, '/tmp/p', 'video', 'video');
    const result = await adapter.generateVideo('sora', 'dancing cat');
    expect(result.videoUrl).toBe('data:video/mp4;base64,xyz');
    expect(inner.generateVideo).toHaveBeenCalledWith('sora', 'dancing cat', undefined);
  });

  it('preserves provider property', () => {
    const inner = makeInner();
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't');
    expect(adapter.provider).toBe('test-provider');
  });

  it('truncates long string prompts in logs', async () => {
    const inner = makeInner();
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't');
    const longPrompt = 'x'.repeat(3000);
    await adapter.generateText('gpt-4', longPrompt);
    const logContent = JSON.parse(writeFileSyncMock.mock.calls[0][1]);
    expect(logContent.input.prompt.length).toBeLessThan(3000);
    expect(logContent.input.prompt).toContain('...[truncated]');
  });

  it('passes through uploadFile when inner supports it', async () => {
    const uploadFn = vi.fn().mockResolvedValue({ uri: 'file://uploaded' }) as any;
    const inner = makeInner({ uploadFile: uploadFn });
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't');
    expect(adapter.uploadFile).toBeDefined();
    const res = await adapter.uploadFile!({ name: 'f.png', path: '/tmp/f.png', mimeType: 'image/png' });
    expect(res.uri).toBe('file://uploaded');
    expect(uploadFn).toHaveBeenCalled();
  });

  it('uploadFile is undefined when inner lacks it', () => {
    const inner = makeInner();
    delete (inner as any).uploadFile;
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't');
    expect(adapter.uploadFile).toBeUndefined();
  });

  it('passes through generateSpeech when inner supports it', async () => {
    const speechFn = vi.fn().mockResolvedValue({ audioUrl: 'audio://data' }) as any;
    const inner = makeInner({ generateSpeech: speechFn });
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't');
    expect(adapter.generateSpeech).toBeDefined();
    const res = await adapter.generateSpeech!('hello world', 'en-US');
    expect(res.audioUrl).toBe('audio://data');
  });

  it('generateSpeech is undefined when inner lacks it', () => {
    const inner = makeInner();
    delete (inner as any).generateSpeech;
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't');
    expect(adapter.generateSpeech).toBeUndefined();
  });

  it('calls onLlmCall callback on successful generateText', async () => {
    const inner = makeInner();
    const onLlmCall = vi.fn();
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't', undefined, undefined, onLlmCall);
    await adapter.generateText('gpt-4', 'test');
    expect(onLlmCall).toHaveBeenCalledWith('generateText', 15);
  });

  it('records cost when costTracking is provided', async () => {
    const inner = makeInner();
    const recordFn = vi.fn();
    const costTracking = {
      costTracker: { record: recordFn } as any,
      projectId: 'proj-1',
    };
    const adapter = createLoggingAdapter(inner, '/tmp/p', 'research', 'text', costTracking);
    await adapter.generateText('gpt-4', 'test');
    expect(recordFn).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      stage: 'research',
      method: 'generateText',
      provider: 'test-provider',
    }));
  });

  it('handles writeFileSync errors gracefully', async () => {
    const inner = makeInner();
    writeFileSyncMock.mockImplementation(() => { throw new Error('ENOSPC'); });
    const adapter = createLoggingAdapter(inner, '/tmp/p', 's', 't');
    // Should not throw — error is swallowed
    const result = await adapter.generateText('gpt-4', 'test');
    expect(result.text).toBe('hello');
  });
});
