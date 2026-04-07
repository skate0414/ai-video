import { describe, it, expect } from 'vitest';
import { selectorToChain, chainToSelector } from './selectorResolver.js';
import type { SelectorChain } from './types.js';

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
});
