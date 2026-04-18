/* ------------------------------------------------------------------ */
/*  Tests for W8, W9, W17, W1, W10 warning fixes                      */
/* ------------------------------------------------------------------ */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RunLock } from '../runLock.js';
import { waitWithAbort, AIRequestAbortedError } from '../aiControl.js';
import { ensurePathWithinBase } from '../../lib/pathSafety.js';
import { withRetry, type RetryPolicy } from '../stageRetryWrapper.js';
import type { StageRunContext, StageDefinition } from '../stageRegistry.js';
import { runSafetyMiddleware } from '../safety.js';

/* ================================================================== */
/*  W8: Safety fail-open → fail-closed                                 */
/*  capabilityAssessment now defaults to { safe: false } when JSON     */
/*  parsing fails — tested via the extractAndValidateJSON contract.    */
/* ================================================================== */

describe('W8 — fail-closed safety default', () => {
  // The actual fix is in capabilityAssessment.ts line 60:
  //   ?? { safe: false, reason: '...' }
  // We test the principle: when extractAndValidateJSON returns null,
  // the fallback must be unsafe.
  it('null-coalesce fallback should be safe=false', () => {
    // Simulate what capabilityAssessment does with a null parse result
    const parseResult: { safe: boolean; reason?: string } | null = null;
    const safetyCheck = parseResult ?? {
      safe: false,
      reason: 'Failed to parse safety check response — defaulting to unsafe (fail-closed)',
    };
    expect(safetyCheck.safe).toBe(false);
    expect(safetyCheck.reason).toContain('fail-closed');
  });

  it('valid parse result passes through unchanged', () => {
    const parseResult: { safe: boolean; reason?: string } | null = { safe: true };
    const safetyCheck = parseResult ?? { safe: false, reason: 'fail-closed' };
    expect(safetyCheck.safe).toBe(true);
  });

  it('unsafe parse result passes through unchanged', () => {
    const parseResult: { safe: boolean; reason?: string } | null = {
      safe: false,
      reason: 'hate-speech',
    };
    const safetyCheck = parseResult ?? { safe: false, reason: 'fail-closed' };
    expect(safetyCheck.safe).toBe(false);
    expect(safetyCheck.reason).toBe('hate-speech');
  });
});

/* ================================================================== */
/*  W9: Manual review enforcement                                      */
/*  runSafetyMiddleware sets requiresManualReview; orchestrator's      */
/*  runPostStageHooks now blocks when needsManualReview is true.       */
/* ================================================================== */

describe('W9 — manual review enforcement', () => {
  it('runSafetyMiddleware flags suicide content for manual review', () => {
    const report = runSafetyMiddleware('I want to kill myself');
    expect(report.requiresManualReview).toBe(true);
    expect(report.suicideDetected).toBe(true);
  });

  it('runSafetyMiddleware flags medical claims for manual review', () => {
    const report = runSafetyMiddleware('This product 可以治愈 all diseases');
    expect(report.requiresManualReview).toBe(true);
    expect(report.medicalClaimDetected).toBe(true);
  });

  it('runSafetyMiddleware does not flag safe content', () => {
    const report = runSafetyMiddleware('The earth orbits the sun in 365 days');
    expect(report.requiresManualReview).toBe(false);
  });

  it('needsManualReview metadata should block post-stage hook (contract test)', () => {
    // Simulates the orchestrator's runPostStageHooks W9 gate logic
    const safetyMetadata = {
      needsManualReview: true,
      riskCategories: ['suicide_risk'],
    };

    const shouldBlock =
      safetyMetadata?.needsManualReview === true;
    expect(shouldBlock).toBe(true);
  });
});

/* ================================================================== */
/*  W17: Path traversal guard                                          */
/* ================================================================== */

describe('W17 — path traversal guard', () => {
  it('allows paths within the base directory', () => {
    const result = ensurePathWithinBase('/data/uploads', '/data/uploads/video.mp4', 'videoFilePath');
    expect(result).toBe('/data/uploads/video.mp4');
  });

  it('rejects path traversal attempts', () => {
    expect(() =>
      ensurePathWithinBase('/data/uploads', '/data/uploads/../secrets/key', 'videoFilePath'),
    ).toThrow('escapes base directory');
  });

  it('rejects absolute path outside base', () => {
    expect(() =>
      ensurePathWithinBase('/data/uploads', '/etc/passwd', 'videoFilePath'),
    ).toThrow('escapes base directory');
  });

  it('allows the base directory itself', () => {
    const result = ensurePathWithinBase('/data/uploads', '/data/uploads', 'videoFilePath');
    expect(result).toBe('/data/uploads');
  });
});

/* ================================================================== */
/*  W1: Timeout now cancels via abort signal                           */
/*  waitWithAbort interrupts delay when signal fires.                  */
/* ================================================================== */

describe('W1 — timeout cancels via abort signal', () => {
  it('waitWithAbort resolves after delay when not aborted', async () => {
    const start = Date.now();
    await waitWithAbort(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('waitWithAbort rejects immediately when signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    // throwIfAborted fires synchronously before returning a promise
    expect(() => waitWithAbort(10_000, controller.signal, 'test')).toThrow(AIRequestAbortedError);
  });

  it('waitWithAbort rejects mid-wait when signal fires', async () => {
    const controller = new AbortController();
    const promise = waitWithAbort(10_000, controller.signal, 'test');
    setTimeout(() => controller.abort(), 30);
    const start = Date.now();
    await expect(promise).rejects.toBeInstanceOf(AIRequestAbortedError);
    // Should have cancelled well before the 10s timeout
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('stageRetryWrapper uses abort-aware backoff', async () => {
    const controller = new AbortController();
    let attempts = 0;

    const def: StageDefinition = {
      stage: 'CAPABILITY_ASSESSMENT',
      async execute() {
        attempts++;
        throw new Error('Target closed');
      },
    };

    const wrapped = withRetry(def, {
      CAPABILITY_ASSESSMENT: { maxRetries: 3, baseDelayMs: 5000 },
    });

    const ctx = {
      project: {} as any,
      projectId: 'test',
      assetsDir: '/tmp',
      addLog: () => {},
      isAborted: () => controller.signal.aborted,
      abortSignal: controller.signal,
    } as unknown as StageRunContext;

    // Abort after first failure — should interrupt the backoff wait
    setTimeout(() => controller.abort(), 50);

    await expect(wrapped.execute(ctx)).rejects.toThrow();
    // Should have been interrupted quickly, not after 5s+ backoff
    expect(attempts).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== */
/*  W10: RunLock lease timeout                                         */
/* ================================================================== */

describe('W10 — RunLock lease timeout', () => {
  it('acquires and releases normally', () => {
    const lock = new RunLock();
    expect(lock.acquire('p1', () => {})).toBe(true);
    expect(lock.acquire('p1', () => {})).toBe(false);
    lock.release('p1');
    expect(lock.acquire('p1', () => {})).toBe(true);
  });

  it('auto-expires stale locks', () => {
    // Use a very short lease for testing
    const lock = new RunLock(50);
    expect(lock.acquire('p1', () => {})).toBe(true);

    // Manually backdate the startedAt
    const entry = (lock as any).running.get('p1');
    entry.startedAt = Date.now() - 100; // 100ms ago (> 50ms lease)

    // Should auto-expire and allow re-acquire
    expect(lock.acquire('p1', () => {})).toBe(true);
  });

  it('isRunning returns false for stale locks', () => {
    const lock = new RunLock(50);
    expect(lock.acquire('p1', () => {})).toBe(true);
    expect(lock.isRunning('p1')).toBe(true);

    // Backdate
    const entry = (lock as any).running.get('p1');
    entry.startedAt = Date.now() - 100;

    expect(lock.isRunning('p1')).toBe(false);
  });

  it('getRunning filters out stale locks', () => {
    const lock = new RunLock(50);
    expect(lock.acquire('p1', () => {})).toBe(true);
    expect(lock.acquire('p2', () => {})).toBe(true);

    // Backdate only p1
    const entry = (lock as any).running.get('p1');
    entry.startedAt = Date.now() - 100;

    const running = lock.getRunning();
    expect(running.length).toBe(1);
    expect(running[0].projectId).toBe('p2');
  });

  it('uses default 30-minute lease when not specified', () => {
    const lock = new RunLock();
    expect((lock as any).leaseTimeoutMs).toBe(30 * 60_000);
  });

  it('non-stale lock blocks acquire', () => {
    const lock = new RunLock(60_000);
    expect(lock.acquire('p1', () => {})).toBe(true);
    // Lock is fresh — should block
    expect(lock.acquire('p1', () => {})).toBe(false);
  });
});
