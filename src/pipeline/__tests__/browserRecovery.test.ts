import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../stageRetryWrapper.js';
import type { StageDefinition, StageRunContext } from '../stageRegistry.js';

/* ------------------------------------------------------------------ */
/*  Browser Recovery — stageRetryWrapper transient error detection     */
/*  Verifies that all known Playwright crash/disconnect error          */
/*  messages are correctly identified as transient and retried.        */
/* ------------------------------------------------------------------ */

/** Minimal StageRunContext stub for retry tests. */
function makeCtx(overrides: Partial<StageRunContext> = {}): StageRunContext {
  return {
    project: {} as any,
    projectId: 'test-proj',
    assetsDir: '/tmp/test',
    getAdapter: () => ({} as any),
    getSessionAwareAdapter: () => ({} as any),
    addLog: vi.fn(),
    saveArtifact: vi.fn(),
    loadArtifact: vi.fn(),
    isAborted: () => false,
    config: { productionConcurrency: 1 },
    emitEvent: vi.fn(),
    providerRegistry: {} as any,
    regenerateScene: vi.fn() as any,
    ...overrides,
  };
}

/** Create a stage definition that throws the given error on the first N calls, then succeeds. */
function makeFailingStage(error: Error, failCount: number): StageDefinition {
  let calls = 0;
  return {
    stage: 'CAPABILITY_ASSESSMENT', // has default retry policy (maxRetries: 1)
    async execute(_ctx: StageRunContext) {
      calls++;
      if (calls <= failCount) throw error;
    },
  };
}

describe('stageRetryWrapper – browser crash recovery', () => {
  /** All known Playwright crash/disconnect error messages. */
  const transientMessages = [
    'Target closed',
    'has been closed',
    'Session closed',
    'Protocol error: Connection closed',
    'tab has been closed',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_CONNECTION_REFUSED',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    // New patterns added in this hardening pass
    'Execution context was destroyed',
    'Browser has been closed',
    'Page has been closed',
    'send_prompt_page_crashed: Target closed',
  ];

  for (const msg of transientMessages) {
    it(`retries transient error: "${msg}"`, async () => {
      const stage = makeFailingStage(new Error(msg), 1); // fail once, succeed on retry
      const wrapped = withRetry(stage);
      const ctx = makeCtx();

      // Should succeed after one retry (no throw)
      await expect(wrapped.execute(ctx)).resolves.toBeUndefined();
    });
  }

  it('does NOT retry non-transient errors without a retry policy', () => {
    const stage: StageDefinition = {
      stage: 'REFINEMENT' as any, // REFINEMENT is in SKIP_STAGES — won't be retried
      async execute() {
        throw new Error('Cannot read property of undefined');
      },
    };
    // SKIP_STAGES means withRetry returns the original def unchanged
    const wrapped = withRetry(stage);
    const ctx = makeCtx();
    return expect(wrapped.execute(ctx)).rejects.toThrow('Cannot read property of undefined');
  });

  it('fails after exhausting all retries on persistent transient errors', async () => {
    // Stage fails 3 times — but policy allows only 1 retry (2 attempts total)
    const stage = makeFailingStage(new Error('Target closed'), 3);
    const wrapped = withRetry(stage);
    const ctx = makeCtx();

    await expect(wrapped.execute(ctx)).rejects.toThrow('Target closed');
  });

  it('never retries SafetyBlockError even if message matches transient pattern', async () => {
    const err = new Error('Session closed — SafetyBlockError');
    err.name = 'SafetyBlockError';
    const stage = makeFailingStage(err, 1);
    const wrapped = withRetry(stage);
    const ctx = makeCtx();

    await expect(wrapped.execute(ctx)).rejects.toThrow('SafetyBlockError');
  });

  it('retries a non-policy stage when error is transient (effectiveMaxRetries >= 1)', async () => {
    // Use a stage without a default policy (e.g. ASSEMBLY has maxRetries 1, but
    // test a custom stage to verify transient overriding logic)
    const stage = makeFailingStage(new Error('ECONNRESET'), 1);
    // Override stage to ASSEMBLY which has {maxRetries:1, baseDelayMs:3000}
    stage.stage = 'ASSEMBLY';
    const wrapped = withRetry(stage);
    const ctx = makeCtx();

    await expect(wrapped.execute(ctx)).resolves.toBeUndefined();
  });
});
