import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunLock } from './runLock.js';

describe('RunLock', () => {
  let lock: RunLock;
  const noop = () => {};

  beforeEach(() => {
    lock = new RunLock();
  });

  describe('acquire / release', () => {
    it('acquires a free project', () => {
      expect(lock.acquire('p1', noop)).toBe(true);
    });

    it('rejects a second acquire for the same project', () => {
      lock.acquire('p1', noop);
      expect(lock.acquire('p1', noop)).toBe(false);
    });

    it('allows acquire after release', () => {
      lock.acquire('p1', noop);
      lock.release('p1');
      expect(lock.acquire('p1', noop)).toBe(true);
    });

    it('allows concurrent locks for different projects', () => {
      expect(lock.acquire('p1', noop)).toBe(true);
      expect(lock.acquire('p2', noop)).toBe(true);
    });
  });

  describe('isRunning', () => {
    it('returns false for unknown project', () => {
      expect(lock.isRunning('unknown')).toBe(false);
    });

    it('returns true for acquired project', () => {
      lock.acquire('p1', noop);
      expect(lock.isRunning('p1')).toBe(true);
    });

    it('returns false after release', () => {
      lock.acquire('p1', noop);
      lock.release('p1');
      expect(lock.isRunning('p1')).toBe(false);
    });
  });

  describe('abort', () => {
    it('calls the abort callback', () => {
      const abortFn = vi.fn();
      lock.acquire('p1', abortFn);
      expect(lock.abort('p1')).toBe(true);
      expect(abortFn).toHaveBeenCalledOnce();
    });

    it('returns false for unknown project', () => {
      expect(lock.abort('unknown')).toBe(false);
    });
  });

  describe('abortAll', () => {
    it('calls abort on all running projects', () => {
      const a1 = vi.fn();
      const a2 = vi.fn();
      lock.acquire('p1', a1);
      lock.acquire('p2', a2);
      lock.abortAll();
      expect(a1).toHaveBeenCalledOnce();
      expect(a2).toHaveBeenCalledOnce();
    });
  });

  describe('getRunning', () => {
    it('returns empty list when nothing is running', () => {
      expect(lock.getRunning()).toEqual([]);
    });

    it('lists all running projects', () => {
      lock.acquire('p1', noop);
      lock.acquire('p2', noop);
      const running = lock.getRunning();
      expect(running).toHaveLength(2);
      expect(running.map(r => r.projectId).sort()).toEqual(['p1', 'p2']);
    });
  });

  describe('lease timeout', () => {
    it('auto-releases stale lock on acquire', () => {
      const shortLock = new RunLock(100);
      shortLock.acquire('p1', noop);

      // Fake time to simulate stale lock
      vi.useFakeTimers();
      vi.advanceTimersByTime(200);

      // Stale lock should be auto-released, new acquire should succeed
      expect(shortLock.acquire('p1', noop)).toBe(true);
      vi.useRealTimers();
    });

    it('isRunning returns false for stale lock', () => {
      const shortLock = new RunLock(100);
      shortLock.acquire('p1', noop);

      vi.useFakeTimers();
      vi.advanceTimersByTime(200);

      expect(shortLock.isRunning('p1')).toBe(false);
      vi.useRealTimers();
    });

    it('getRunning excludes stale locks', () => {
      const shortLock = new RunLock(100);
      shortLock.acquire('p1', noop);

      vi.useFakeTimers();
      vi.advanceTimersByTime(200);

      expect(shortLock.getRunning()).toEqual([]);
      vi.useRealTimers();
    });
  });
});
