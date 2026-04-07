/* ------------------------------------------------------------------ */
/*  SelectorResolver – resilient multi-strategy element location       */
/*  Tries each strategy in a SelectorChain by priority (desc) and     */
/*  returns the first match.  Tracks success/failure stats.           */
/* ------------------------------------------------------------------ */

import type { Page, Locator } from 'playwright';
import type { SelectorChain, SelectorStrategy } from './types.js';

/**
 * Build a Playwright locator from a single SelectorStrategy.
 */
function buildLocator(page: Page, strategy: SelectorStrategy): Locator {
  switch (strategy.method) {
    case 'css':
      return page.locator(strategy.selector);
    case 'text':
      return page.getByText(strategy.selector);
    case 'role': {
      // role selectors like "[role='textbox']" — use locator
      return page.locator(strategy.selector);
    }
    case 'testid':
      return page.getByTestId(strategy.selector);
    case 'xpath':
      return page.locator(`xpath=${strategy.selector}`);
    default:
      return page.locator(strategy.selector);
  }
}

/**
 * Result of resolving a selector chain.
 */
export interface ResolvedSelector {
  /** The Playwright locator that matched. */
  locator: Locator;
  /** The strategy that succeeded. */
  strategy: SelectorStrategy;
  /** Index in the chain. */
  strategyIndex: number;
  /** Updated strategy with refreshed tracking fields (lastWorked/failCount). */
  updatedStrategy: SelectorStrategy;
}

/**
 * Resolve a SelectorChain by trying each strategy in priority order (desc).
 *
 * @param page     The Playwright page to search
 * @param chain    Ordered list of selector strategies (NOT mutated)
 * @param timeout  Max ms to wait for each strategy (default 2000)
 * @returns        The first matching locator, or null if none matched
 */
export async function resolveSelector(
  page: Page,
  chain: SelectorChain,
  timeout = 2_000,
): Promise<ResolvedSelector | null> {
  // Sort by priority descending (highest first)
  const sorted = [...chain]
    .map((s, i) => ({ ...s, _idx: i }))
    .sort((a, b) => b.priority - a.priority);

  for (const strategy of sorted) {
    try {
      const locator = buildLocator(page, strategy);
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        return {
          locator,
          strategy: chain[strategy._idx],
          strategyIndex: strategy._idx,
          updatedStrategy: {
            ...chain[strategy._idx],
            lastWorked: new Date().toISOString(),
            failCount: 0,
          },
        };
      }
    } catch {
      // Strategy failed — continue to next
    }
  }

  return null;
}

/**
 * Resolve a SelectorChain and return the first matching locator.
 * Throws an error if no strategy matches.
 */
export async function resolveSelectorOrThrow(
  page: Page,
  chain: SelectorChain,
  elementName: string,
  timeout = 2_000,
): Promise<ResolvedSelector> {
  const result = await resolveSelector(page, chain, timeout);
  if (!result) {
    const tried = chain.map(s => `${s.method}:${s.selector}`).join(', ');
    throw new Error(
      `[SelectorResolver] No strategy matched for "${elementName}". ` +
      `Tried: ${tried}. All selectors may need updating.`,
    );
  }
  return result;
}

/**
 * Helper: convert a legacy single CSS selector string to a SelectorChain.
 * This allows gradual migration from string selectors to chains.
 */
export function selectorToChain(selector: string, method: SelectorStrategy['method'] = 'css'): SelectorChain {
  // Handle comma-separated selectors as multiple strategies
  if (selector.includes(',') && method === 'css') {
    return selector
      .split(',')
      .map((s, i, arr) => ({
        selector: s.trim(),
        method: 'css' as const,
        priority: arr.length - i, // first = highest priority
      }))
      .filter(s => s.selector.length > 0);
  }
  return [{ selector, method, priority: 1 }];
}

/**
 * Helper: convert a SelectorChain back to a single legacy CSS selector string.
 * Uses the highest-priority CSS strategy.
 */
export function chainToSelector(chain: SelectorChain): string {
  if (chain.length === 0) return '';
  // Return comma-joined CSS selectors sorted by priority desc
  const cssStrategies = chain
    .filter(s => s.method === 'css')
    .sort((a, b) => b.priority - a.priority);
  if (cssStrategies.length > 0) {
    return cssStrategies.map(s => s.selector).join(', ');
  }
  // Fallback: return the highest priority selector regardless of method
  const sorted = [...chain].sort((a, b) => b.priority - a.priority);
  return sorted[0].selector;
}

/**
 * Probe all selector chains in a config and return health status.
 * Returns which selectors are broken and an overall health score.
 */
export async function probeSelectors(
  page: Page,
  selectors: Record<string, SelectorChain | undefined>,
): Promise<{ brokenSelectors: string[]; healthScore: number; details: Record<string, boolean> }> {
  const details: Record<string, boolean> = {};
  const brokenSelectors: string[] = [];
  let total = 0;
  let working = 0;

  for (const [name, chain] of Object.entries(selectors)) {
    if (!chain || chain.length === 0) continue;
    total++;
    const result = await resolveSelector(page, chain, 3_000);
    if (result) {
      details[name] = true;
      working++;
    } else {
      details[name] = false;
      brokenSelectors.push(name);
    }
  }

  const healthScore = total > 0 ? Math.round((working / total) * 100) : 100;
  return { brokenSelectors, healthScore, details };
}
