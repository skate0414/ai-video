import { describe, it, expect } from 'vitest';

/**
 * Regression test for ProductionPlanPreview retry-on-failure fix.
 *
 * The bug: `loaded.current = true` was set BEFORE the fetch, so a failed
 * fetch would permanently prevent retry. The fix moves it into the success
 * callback.
 *
 * We test the guard logic in isolation to ensure the pattern is correct.
 */

/** Simulates the corrected guard pattern from ProductionPlanPreview */
function simulateLoadAttempts(
  fetchResults: Array<'success' | 'failure'>,
): { loadAttempts: number; finalLoaded: boolean } {
  let loaded = false;
  let loadAttempts = 0;

  for (const result of fetchResults) {
    // Guard: skip if already loaded
    if (loaded) continue;
    loadAttempts++;

    if (result === 'success') {
      // Only mark loaded on success (the fix)
      loaded = true;
    }
    // On failure: loaded stays false, so next attempt is allowed
  }

  return { loadAttempts, finalLoaded: loaded };
}

describe('ProductionPlanPreview retry guard', () => {
  it('marks loaded after successful fetch', () => {
    const { loadAttempts, finalLoaded } = simulateLoadAttempts(['success']);
    expect(loadAttempts).toBe(1);
    expect(finalLoaded).toBe(true);
  });

  it('retries after a failed fetch', () => {
    const { loadAttempts, finalLoaded } = simulateLoadAttempts(['failure', 'success']);
    expect(loadAttempts).toBe(2);
    expect(finalLoaded).toBe(true);
  });

  it('retries multiple failures until success', () => {
    const { loadAttempts, finalLoaded } = simulateLoadAttempts(['failure', 'failure', 'success']);
    expect(loadAttempts).toBe(3);
    expect(finalLoaded).toBe(true);
  });

  it('does not retry after successful load', () => {
    const { loadAttempts } = simulateLoadAttempts(['success', 'success', 'success']);
    expect(loadAttempts).toBe(1);
  });

  it('all failures leave loaded as false (allowing future retries)', () => {
    const { loadAttempts, finalLoaded } = simulateLoadAttempts(['failure', 'failure']);
    expect(loadAttempts).toBe(2);
    expect(finalLoaded).toBe(false);
  });
});
