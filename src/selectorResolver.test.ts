import { describe, it, expect, vi } from 'vitest';
import { selectorToChain, chainToSelector, resolveSelector, resolveSelectorOrThrow, probeSelectors } from './selectorResolver.js';
import type { SelectorChain } from './types.js';
import type { Page, Locator } from 'playwright';

describe('selectorResolver – helpers', () => {
  describe('selectorToChain', () => {
    it('converts a single CSS selector', () => {
      const chain = selectorToChain('textarea');
      expect(chain).toEqual([
        { selector: 'textarea', method: 'css', priority: 1 },
      ]);
    });

    it('splits comma-separated CSS selectors into multiple strategies', () => {
      const chain = selectorToChain('textarea, div[contenteditable="true"], [role="textbox"]');
      expect(chain).toHaveLength(3);
      expect(chain[0].selector).toBe('textarea');
      expect(chain[0].priority).toBe(3); // first = highest
      expect(chain[1].selector).toBe('div[contenteditable="true"]');
      expect(chain[1].priority).toBe(2);
      expect(chain[2].selector).toBe('[role="textbox"]');
      expect(chain[2].priority).toBe(1);
    });

    it('handles non-CSS methods without splitting', () => {
      const chain = selectorToChain('some text, with commas', 'text');
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe('text');
    });

    it('filters empty selectors after split', () => {
      const chain = selectorToChain('textarea, , ');
      expect(chain).toHaveLength(1);
      expect(chain[0].selector).toBe('textarea');
    });
  });

  describe('chainToSelector', () => {
    it('joins CSS strategies by priority descending', () => {
      const chain: SelectorChain = [
        { selector: '[role="textbox"]', method: 'css', priority: 1 },
        { selector: 'textarea', method: 'css', priority: 3 },
        { selector: 'div[contenteditable="true"]', method: 'css', priority: 2 },
      ];
      const result = chainToSelector(chain);
      expect(result).toBe('textarea, div[contenteditable="true"], [role="textbox"]');
    });

    it('returns empty string for empty chain', () => {
      expect(chainToSelector([])).toBe('');
    });

    it('prefers CSS strategies but falls back to highest-priority any method', () => {
      const chain: SelectorChain = [
        { selector: 'Send message', method: 'text', priority: 3 },
        { selector: 'button.send', method: 'css', priority: 1 },
      ];
      const result = chainToSelector(chain);
      expect(result).toBe('button.send');
    });

    it('uses non-CSS selector if no CSS strategies exist', () => {
      const chain: SelectorChain = [
        { selector: 'button', method: 'role', priority: 2 },
        { selector: 'Send', method: 'text', priority: 1 },
      ];
      const result = chainToSelector(chain);
      expect(result).toBe('button'); // highest priority
    });
  });

  describe('roundtrip', () => {
    it('selectorToChain → chainToSelector preserves order', () => {
      const original = 'textarea, div[contenteditable="true"], [role="textbox"]';
      const chain = selectorToChain(original);
      const result = chainToSelector(chain);
      expect(result).toBe(original);
    });
  });

  describe('selectorToChain – prefix syntax', () => {
    it('detects text= prefix', () => {
      const chain = selectorToChain('text=Click me');
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe('text');
      expect(chain[0].selector).toBe('Click me');
    });

    it('detects role= prefix and wraps in attribute syntax', () => {
      const chain = selectorToChain('role=button');
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe('role');
      expect(chain[0].selector).toBe('[role="button"]');
    });

    it('detects role= with existing bracket syntax', () => {
      const chain = selectorToChain('role=[role="textbox"]');
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe('role');
      expect(chain[0].selector).toBe('[role="textbox"]');
    });

    it('detects testid= prefix', () => {
      const chain = selectorToChain('testid=my-button');
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe('testid');
      expect(chain[0].selector).toBe('my-button');
    });

    it('detects xpath= prefix', () => {
      const chain = selectorToChain('xpath=//div[@class="foo"]');
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe('xpath');
      expect(chain[0].selector).toBe('//div[@class="foo"]');
    });
  });

  describe('selectorToChain – comma-separated with mixed prefixes', () => {
    it('handles prefix items within comma-separated list', () => {
      const chain = selectorToChain('textarea, text=Send, button.submit');
      expect(chain).toHaveLength(3);
      expect(chain[0].method).toBe('css');
      expect(chain[0].selector).toBe('textarea');
      expect(chain[1].method).toBe('text');
      expect(chain[1].selector).toBe('Send');
      expect(chain[2].method).toBe('css');
      expect(chain[2].selector).toBe('button.submit');
    });
  });

  describe('selectorToChain – non-css method', () => {
    it('does not split on comma for non-css methods', () => {
      const chain = selectorToChain('some text, with commas', 'xpath');
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe('xpath');
    });
  });

  describe('chainToSelector – edge cases', () => {
    it('falls back to non-css when only non-css strategies', () => {
      const chain: SelectorChain = [
        { selector: 'Click me', method: 'text', priority: 2 },
        { selector: '//button', method: 'xpath', priority: 1 },
      ];
      expect(chainToSelector(chain)).toBe('Click me');
    });
  });
});

/* ---- Async functions with mocked Playwright Page ---- */

function mockLocator(count: number): Locator {
  return { count: vi.fn().mockResolvedValue(count) } as unknown as Locator;
}

function noMatchLocator(): Locator {
  return { count: vi.fn().mockResolvedValue(0) } as unknown as Locator;
}

function errorLocator(): Locator {
  return { count: vi.fn().mockRejectedValue(new Error('timeout')) } as unknown as Locator;
}

function createMockPage(countMap: Record<string, number> = {}): Page {
  const locatorFn = vi.fn((selector: string) => {
    const c = countMap[selector] ?? 0;
    return c > 0 ? mockLocator(c) : noMatchLocator();
  });
  return {
    locator: locatorFn,
    getByText: vi.fn((t: string) => {
      const c = countMap[`text=${t}`] ?? 0;
      return c > 0 ? mockLocator(c) : noMatchLocator();
    }),
    getByTestId: vi.fn((t: string) => {
      const c = countMap[`testid=${t}`] ?? 0;
      return c > 0 ? mockLocator(c) : noMatchLocator();
    }),
  } as unknown as Page;
}

describe('resolveSelector', () => {
  it('returns first matching strategy', async () => {
    const page = createMockPage({ textarea: 1 });
    const chain: SelectorChain = [
      { selector: 'textarea', method: 'css', priority: 1 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result).not.toBeNull();
    expect(result!.strategy.selector).toBe('textarea');
    expect(result!.strategyIndex).toBe(0);
    expect(result!.updatedStrategy.failCount).toBe(0);
    expect(result!.updatedStrategy.lastWorked).toBeDefined();
  });

  it('returns null when no strategy matches', async () => {
    const page = createMockPage({});
    const chain: SelectorChain = [
      { selector: 'textarea', method: 'css', priority: 1 },
      { selector: '.other', method: 'css', priority: 2 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result).toBeNull();
  });

  it('tries higher priority first', async () => {
    const page = createMockPage({ '.high': 1, '.low': 1 });
    const chain: SelectorChain = [
      { selector: '.low', method: 'css', priority: 1 },
      { selector: '.high', method: 'css', priority: 10 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result!.strategy.selector).toBe('.high');
    expect(result!.strategyIndex).toBe(1);
  });

  it('skips strategies that throw and continues', async () => {
    const page = {
      locator: vi.fn().mockReturnValueOnce(errorLocator()).mockReturnValueOnce(mockLocator(1)),
      getByText: vi.fn(),
      getByTestId: vi.fn(),
    } as unknown as Page;
    const chain: SelectorChain = [
      { selector: '.broken', method: 'css', priority: 10 },
      { selector: '.works', method: 'css', priority: 5 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result).not.toBeNull();
    expect(result!.strategy.selector).toBe('.works');
  });

  it('resolves text method', async () => {
    const page = createMockPage({ 'text=Click me': 1 });
    const chain: SelectorChain = [
      { selector: 'Click me', method: 'text', priority: 1 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result).not.toBeNull();
  });

  it('resolves testid method', async () => {
    const page = createMockPage({ 'testid=my-btn': 1 });
    const chain: SelectorChain = [
      { selector: 'my-btn', method: 'testid', priority: 1 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result).not.toBeNull();
  });

  it('resolves xpath method via locator', async () => {
    const page = createMockPage({ 'xpath=//div': 1 });
    const chain: SelectorChain = [
      { selector: '//div', method: 'xpath', priority: 1 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result).not.toBeNull();
  });

  it('resolves role method via locator', async () => {
    const page = createMockPage({ '[role="button"]': 1 });
    const chain: SelectorChain = [
      { selector: '[role="button"]', method: 'role', priority: 1 },
    ];
    const result = await resolveSelector(page, chain);
    expect(result).not.toBeNull();
  });
});

describe('resolveSelectorOrThrow', () => {
  it('returns result when found', async () => {
    const page = createMockPage({ 'textarea': 1 });
    const chain: SelectorChain = [{ selector: 'textarea', method: 'css', priority: 1 }];
    const result = await resolveSelectorOrThrow(page, chain, 'promptInput');
    expect(result.strategy.selector).toBe('textarea');
  });

  it('throws with descriptive message when nothing matches', async () => {
    const page = createMockPage({});
    const chain: SelectorChain = [
      { selector: 'textarea', method: 'css', priority: 2 },
      { selector: '.input', method: 'css', priority: 1 },
    ];
    await expect(resolveSelectorOrThrow(page, chain, 'promptInput')).rejects.toThrow('promptInput');
    await expect(resolveSelectorOrThrow(page, chain, 'promptInput')).rejects.toThrow('All selectors may need updating');
  });
});

describe('probeSelectors', () => {
  it('returns 100 health score for all healthy selectors', async () => {
    const page = createMockPage({ 'textarea': 1, '.response': 2 });
    const selectors: Record<string, SelectorChain | undefined> = {
      promptInput: [{ selector: 'textarea', method: 'css', priority: 1 }],
      responseBlock: [{ selector: '.response', method: 'css', priority: 1 }],
    };
    const result = await probeSelectors(page, selectors);
    expect(result.healthScore).toBe(100);
    expect(result.brokenSelectors).toHaveLength(0);
    expect(result.degradedSelectors).toHaveLength(0);
    expect(result.details.promptInput).toBe(true);
    expect(result.details.responseBlock).toBe(true);
  });

  it('identifies broken selectors', async () => {
    const page = createMockPage({ 'textarea': 1 });
    const selectors: Record<string, SelectorChain | undefined> = {
      promptInput: [{ selector: 'textarea', method: 'css', priority: 1 }],
      responseBlock: [{ selector: '.response-gone', method: 'css', priority: 1 }],
    };
    const result = await probeSelectors(page, selectors);
    expect(result.healthScore).toBe(50);
    expect(result.brokenSelectors).toEqual(['responseBlock']);
    expect(result.details.responseBlock).toBe(false);
  });

  it('detects degraded selectors (fallback matched, top did not)', async () => {
    const page = createMockPage({ '.fallback': 1 });
    const selectors: Record<string, SelectorChain | undefined> = {
      promptInput: [
        { selector: '.primary', method: 'css', priority: 10 },
        { selector: '.fallback', method: 'css', priority: 1 },
      ],
    };
    const result = await probeSelectors(page, selectors);
    expect(result.healthScore).toBe(100);
    expect(result.degradedSelectors).toEqual(['promptInput']);
    const detail = result.selectorDetails.find(d => d.name === 'promptInput')!;
    expect(detail.degraded).toBe(true);
    expect(detail.matchedStrategy!.selector).toBe('.fallback');
  });

  it('skips undefined/empty chains', async () => {
    const page = createMockPage({});
    const selectors: Record<string, SelectorChain | undefined> = {
      missing: undefined,
      empty: [],
    };
    const result = await probeSelectors(page, selectors);
    expect(result.healthScore).toBe(100);
    expect(result.selectorDetails).toHaveLength(0);
  });

  it('returns per-strategy probe results', async () => {
    const page = createMockPage({ '.first': 3, '.second': 0 });
    const selectors: Record<string, SelectorChain | undefined> = {
      test: [
        { selector: '.first', method: 'css', priority: 2 },
        { selector: '.second', method: 'css', priority: 1 },
      ],
    };
    const result = await probeSelectors(page, selectors);
    const detail = result.selectorDetails[0];
    expect(detail.strategies).toHaveLength(2);
    expect(detail.strategies[0].matched).toBe(true);
    expect(detail.strategies[0].matchCount).toBe(3);
    expect(detail.strategies[1].matched).toBe(false);
  });

  it('handles strategy errors gracefully', async () => {
    const page = {
      locator: vi.fn().mockReturnValue(errorLocator()),
      getByText: vi.fn(),
      getByTestId: vi.fn(),
    } as unknown as Page;
    const selectors: Record<string, SelectorChain | undefined> = {
      broken: [{ selector: '.err', method: 'css', priority: 1 }],
    };
    const result = await probeSelectors(page, selectors);
    expect(result.brokenSelectors).toEqual(['broken']);
    expect(result.selectorDetails[0].strategies[0].matched).toBe(false);
  });

  it('returns not-degraded when top strategy matches', async () => {
    const page = createMockPage({ '.top': 1, '.backup': 1 });
    const selectors: Record<string, SelectorChain | undefined> = {
      input: [
        { selector: '.top', method: 'css', priority: 10 },
        { selector: '.backup', method: 'css', priority: 1 },
      ],
    };
    const result = await probeSelectors(page, selectors);
    expect(result.degradedSelectors).toHaveLength(0);
    const detail = result.selectorDetails[0];
    expect(detail.degraded).toBe(false);
  });
});
