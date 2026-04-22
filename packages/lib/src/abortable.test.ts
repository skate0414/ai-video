import { describe, it, expect, vi } from 'vitest';
import {
  AIRequestAbortedError,
  throwIfAborted,
  waitWithAbort,
} from './abortable.js';

describe('AIRequestAbortedError', () => {
  it('is an instance of Error', () => {
    const err = new AIRequestAbortedError('test-label');
    expect(err).toBeInstanceOf(Error);
  });

  it('sets the name property to AIRequestAbortedError', () => {
    const err = new AIRequestAbortedError('my-label');
    expect(err.name).toBe('AIRequestAbortedError');
  });

  it('includes the label in the message', () => {
    const err = new AIRequestAbortedError('fetch-call');
    expect(err.message).toContain('fetch-call');
    expect(err.message).toContain('aborted');
  });

  it('exposes the label property', () => {
    const err = new AIRequestAbortedError('stage-name');
    expect(err.label).toBe('stage-name');
  });
});

describe('throwIfAborted', () => {
  it('does nothing when signal is undefined', () => {
    expect(() => throwIfAborted(undefined, 'label')).not.toThrow();
  });

  it('does nothing when signal is not aborted', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal, 'label')).not.toThrow();
  });

  it('throws AIRequestAbortedError when signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal, 'my-step')).toThrow(AIRequestAbortedError);
  });

  it('includes the label in the thrown error', () => {
    const controller = new AbortController();
    controller.abort();
    let caught: unknown;
    try {
      throwIfAborted(controller.signal, 'step-name');
    } catch (e) {
      caught = e;
    }
    expect((caught as AIRequestAbortedError).label).toBe('step-name');
  });
});

describe('waitWithAbort', () => {
  it('resolves immediately for zero or negative ms', async () => {
    await expect(waitWithAbort(0)).resolves.toBeUndefined();
    await expect(waitWithAbort(-1)).resolves.toBeUndefined();
  });

  it('resolves after the given delay', async () => {
    const start = Date.now();
    await waitWithAbort(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('resolves without signal provided', async () => {
    await expect(waitWithAbort(10)).resolves.toBeUndefined();
  });

  it('rejects with AIRequestAbortedError when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitWithAbort(1000, controller.signal, 'pre-aborted')).rejects.toBeInstanceOf(
      AIRequestAbortedError,
    );
  });

  it('rejects mid-wait when signal is aborted during the delay', async () => {
    const controller = new AbortController();
    const promise = waitWithAbort(2000, controller.signal, 'mid-wait');
    // Abort after a short tick
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toBeInstanceOf(AIRequestAbortedError);
  });

  it('uses the default label "AI wait" in the error when none is supplied', async () => {
    const controller = new AbortController();
    controller.abort();
    let caught: unknown;
    try {
      await waitWithAbort(1000, controller.signal);
    } catch (e) {
      caught = e;
    }
    expect((caught as AIRequestAbortedError).label).toBe('AI wait');
  });

  it('includes the provided label in the rejection', async () => {
    const controller = new AbortController();
    controller.abort();
    let caught: unknown;
    try {
      await waitWithAbort(1000, controller.signal, 'custom-label');
    } catch (e) {
      caught = e;
    }
    expect((caught as AIRequestAbortedError).label).toBe('custom-label');
  });
});
