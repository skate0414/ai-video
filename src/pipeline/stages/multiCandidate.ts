/* ------------------------------------------------------------------ */
/*  Multi-candidate generation – generate N candidates, pick best    */
/* ------------------------------------------------------------------ */

import { createLogger } from '../../lib/logger.js';

const log = createLogger('MultiCandidate');

export interface Candidate<T> {
  result: T;
  score: number;
}

/**
 * Generate `count` candidates in parallel, score each, and return the best.
 *
 * @param generate - Async factory that produces one candidate.
 * @param score    - Pure scoring function (higher = better, 0-100).
 * @param count    - Number of candidates to generate (default 1 = legacy behaviour).
 * @returns The candidate with the highest score (or the only one if count === 1).
 */
export async function pickBestCandidate<T>(
  generate: (index: number) => Promise<T>,
  score: (candidate: T) => Promise<number> | number,
  count: number = 1,
): Promise<Candidate<T>> {
  const safeCount = Math.max(1, Math.min(count, 5)); // cap at 5 to prevent runaway cost

  if (safeCount === 1) {
    const result = await generate(0);
    const s = await score(result);
    return { result, score: s };
  }

  // Launch all candidates in parallel
  const promises = Array.from({ length: safeCount }, (_, i) =>
    generate(i).then(async (result) => {
      const s = await score(result);
      return { result, score: s } as Candidate<T>;
    }).catch((err) => {
      log.warn('candidate_failed', { index: i, error: err instanceof Error ? err.message : String(err) });
      return null;
    }),
  );

  const settled = await Promise.all(promises);
  const valid = settled.filter((c): c is Candidate<T> => c !== null);

  if (valid.length === 0) {
    // All candidates failed — fall through to single generate for proper error propagation
    const result = await generate(0);
    const s = await score(result);
    return { result, score: s };
  }

  // Pick highest score
  valid.sort((a, b) => b.score - a.score);
  const best = valid[0];
  log.info('picked_best', {
    candidates: valid.length,
    bestScore: best.score,
    scores: valid.map(c => c.score),
  });
  return best;
}
