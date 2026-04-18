import { describe, it, expect, vi } from 'vitest';
import { ProjectQueue } from '../projectQueue.js';

function okStartFn(_id: string) {
  return { ok: true as const };
}

describe('ProjectQueue', () => {
  it('starts immediately when under capacity', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(2, startFn);

    expect(q.enqueue('a')).toBe('started');
    expect(startFn).toHaveBeenCalledWith('a');
    expect(q.isActive('a')).toBe(true);
  });

  it('queues when at capacity', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(1, startFn);

    expect(q.enqueue('a')).toBe('started');
    expect(q.enqueue('b')).toBe('queued');
    expect(q.isActive('a')).toBe(true);
    expect(q.isQueued('b')).toBe(true);
    expect(startFn).toHaveBeenCalledTimes(1);
  });

  it('drains queue when a project finishes', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(1, startFn);

    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');

    q.markDone('a');
    expect(q.isActive('b')).toBe(true);
    expect(q.isQueued('c')).toBe(true);
    expect(startFn).toHaveBeenCalledTimes(2); // a + b

    q.markDone('b');
    expect(q.isActive('c')).toBe(true);
    expect(startFn).toHaveBeenCalledTimes(3);
  });

  it('respects maxConcurrent', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(3, startFn);

    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    q.enqueue('d');

    expect(startFn).toHaveBeenCalledTimes(3);
    expect(q.isActive('a')).toBe(true);
    expect(q.isActive('b')).toBe(true);
    expect(q.isActive('c')).toBe(true);
    expect(q.isQueued('d')).toBe(true);
  });

  it('deduplicates active projects', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(2, startFn);

    q.enqueue('a');
    expect(q.enqueue('a')).toBe('started');
    expect(startFn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates queued projects', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(1, startFn);

    q.enqueue('a');
    q.enqueue('b');
    expect(q.enqueue('b')).toBe('queued');
    expect(q.size).toBe(2);
  });

  it('dequeue removes a queued project', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(1, startFn);

    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');

    expect(q.dequeue('b')).toBe(true);
    expect(q.isQueued('b')).toBe(false);

    q.markDone('a');
    expect(q.isActive('c')).toBe(true);
    expect(q.isActive('b')).toBe(false);
  });

  it('dequeue returns false for non-queued project', () => {
    const q = new ProjectQueue(2, okStartFn);
    expect(q.dequeue('nonexistent')).toBe(false);
  });

  it('snapshot returns correct state', () => {
    const q = new ProjectQueue(1, okStartFn);

    q.enqueue('a');
    q.enqueue('b');

    const snap = q.snapshot();
    expect(snap.maxConcurrent).toBe(1);
    expect(snap.active).toHaveLength(1);
    expect(snap.active[0].projectId).toBe('a');
    expect(snap.queued).toHaveLength(1);
    expect(snap.queued[0].projectId).toBe('b');
  });

  it('handles startFn failure gracefully', () => {
    const startFn = vi.fn(() => ({ error: 'not found', status: 404 }));
    const q = new ProjectQueue(2, startFn);

    const result = q.enqueue('bad');
    expect(result).toBe('queued'); // start failed, reported as queued
    expect(q.isActive('bad')).toBe(false);
  });

  it('size returns total active + queued', () => {
    const q = new ProjectQueue(1, okStartFn);

    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');

    expect(q.size).toBe(3);
  });

  it('updating maxConcurrent drains queued items', () => {
    const startFn = vi.fn(okStartFn);
    const q = new ProjectQueue(1, startFn);

    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    expect(startFn).toHaveBeenCalledTimes(1);

    q.maxConcurrent = 3;
    expect(startFn).toHaveBeenCalledTimes(3);
    expect(q.isActive('b')).toBe(true);
    expect(q.isActive('c')).toBe(true);
  });

  it('maxConcurrent enforces minimum of 1', () => {
    const q = new ProjectQueue(0, okStartFn);
    expect(q.maxConcurrent).toBe(1);

    q.maxConcurrent = -5;
    expect(q.maxConcurrent).toBe(1);
  });

  it('markDone is a no-op for unknown projects', () => {
    const q = new ProjectQueue(2, okStartFn);
    q.enqueue('a');
    // Should not throw
    q.markDone('unknown');
    expect(q.isActive('a')).toBe(true);
  });
});
