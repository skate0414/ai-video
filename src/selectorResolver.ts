/* ------------------------------------------------------------------ */
/*  SelectorResolver – resilient multi-strategy element location       */
/*  Tries each strategy in a SelectorChain by priority (desc) and     */
/*  returns the first match.  Tracks success/failure stats.           */
/* ------------------------------------------------------------------ */

import type { Page, Locator } from 'playwright';
import type { SelectorChain, SelectorStrategy } from './types.js';
import { SELECTOR_RESOLVE_TIMEOUT_MS } from './constants.js';

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
  timeout = SELECTOR_RESOLVE_TIMEOUT_MS,
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
 *
 * Auto-detects method from prefixed syntax:
 *   "text=Click me"  → method: 'text', selector: 'Click me'
 *   "role=button"    → method: 'role', selector: '[role="button"]'
 *   "testid=my-btn"  → method: 'testid', selector: 'my-btn'
 *   "xpath=//div"    → method: 'xpath', selector: '//div'
 */
export function selectorToChain(selector: string, method: SelectorStrategy['method'] = 'css'): SelectorChain {
  // Auto-detect prefixed selectors (e.g. "text=...", "role=...")
  const prefixMatch = selector.match(/^(text|role|testid|xpath)=(.+)$/i);
  if (prefixMatch) {
    const detectedMethod = prefixMatch[1].toLowerCase() as SelectorStrategy['method'];
    let selectorValue = prefixMatch[2];
    // For role selectors, wrap in attribute syntax if not already
    if (detectedMethod === 'role' && !selectorValue.startsWith('[')) {
      selectorValue = `[role="${selectorValue}"]`;
    }
    return [{ selector: selectorValue, method: detectedMethod, priority: 1 }];
  }

  // Handle comma-separated selectors as multiple strategies
  if (selector.includes(',') && method === 'css') {
    const parts = selector.split(',').filter(s => s.trim().length > 0);
    // Check if any part uses prefix syntax
    return parts.map((s, i, arr) => {
      const trimmed = s.trim();
      const partPrefix = trimmed.match(/^(text|role|testid|xpath)=(.+)$/i);
      if (partPrefix) {
        const m = partPrefix[1].toLowerCase() as SelectorStrategy['method'];
        let v = partPrefix[2];
        if (m === 'role' && !v.startsWith('[')) v = `[role="${v}"]`;
        return { selector: v, method: m, priority: arr.length - i };
      }
      return { selector: trimmed, method: 'css' as const, priority: arr.length - i };
    });
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
 * Per-strategy probe result — shows which individual strategies matched.
 */
export interface StrategyProbeResult {
  strategy: SelectorStrategy;
  matched: boolean;
  matchCount: number;
}

/**
 * Detailed health result for a single selector chain.
 */
export interface DetailedSelectorHealth {
  name: string;
  healthy: boolean;
  strategies: StrategyProbeResult[];
  /** True if only lower-priority fallback strategies matched (not the top one). */
  degraded: boolean;
  /** The strategy that was used (highest-priority match), if any. */
  matchedStrategy?: SelectorStrategy;
}

/**
 * Probe all selector chains in a config and return health status.
 * Returns which selectors are broken, an overall health score,
 * and per-strategy detail including degradation detection.
 */
export async function probeSelectors(
  page: Page,
  selectors: Record<string, SelectorChain | undefined>,
): Promise<{
  brokenSelectors: string[];
  healthScore: number;
  details: Record<string, boolean>;
  selectorDetails: DetailedSelectorHealth[];
  degradedSelectors: string[];
}> {
  const details: Record<string, boolean> = {};
  const brokenSelectors: string[] = [];
  const degradedSelectors: string[] = [];
  const selectorDetails: DetailedSelectorHealth[] = [];
  let total = 0;
  let working = 0;

  for (const [name, chain] of Object.entries(selectors)) {
    if (!chain || chain.length === 0) continue;
    total++;

    // Probe each strategy individually for granular reporting
    const sorted = [...chain].sort((a, b) => b.priority - a.priority);
    const strategyResults: StrategyProbeResult[] = [];
    let firstMatch: SelectorStrategy | undefined;

    for (const strategy of sorted) {
      try {
        const locator = buildLocator(page, strategy);
        const count = await locator.count().catch(() => 0);
        strategyResults.push({ strategy, matched: count > 0, matchCount: count });
        if (count > 0 && !firstMatch) {
          firstMatch = strategy;
        }
      } catch {
        strategyResults.push({ strategy, matched: false, matchCount: 0 });
      }
    }

    const healthy = !!firstMatch;
    // Degraded if the top-priority strategy failed but a lower one worked
    const topPriority = sorted[0]?.priority ?? 0;
    const degraded = healthy && firstMatch!.priority < topPriority;

    if (healthy) {
      details[name] = true;
      working++;
    } else {
      details[name] = false;
      brokenSelectors.push(name);
    }

    if (degraded) {
      degradedSelectors.push(name);
    }

    selectorDetails.push({
      name,
      healthy,
      strategies: strategyResults,
      degraded,
      matchedStrategy: firstMatch,
    });
  }

  const healthScore = total > 0 ? Math.round((working / total) * 100) : 100;
  return { brokenSelectors, healthScore, details, selectorDetails, degradedSelectors };
}
