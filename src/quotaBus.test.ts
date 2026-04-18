import { describe, it, expect, beforeEach } from 'vitest';

/**
 * QuotaBus is a module-level singleton, so we need to dynamically import
 * a fresh module for each test to avoid state leaking between tests.
 * However, since the module uses `export const quotaBus = new QuotaBusImpl()`,
 * we test the singleton directly and manually reset state.
 */

import { quotaBus } from './quotaBus.js';
import type { QuotaEvent } from './quotaBus.js';

describe('QuotaBus', () => {
  beforeEach(() => {
    // Reset all quota states before each test
    quotaBus.resetAll();
  });

  it('starts with no exhausted capabilities', () => {
    expect(quotaBus.getAll()).toHaveLength(0);
    expect(quotaBus.isExhausted('chatgpt', 'text')).toBe(false);
  });

  it('emits and tracks exhaustion events', () => {
    quotaBus.emit({
      provider: 'chatgpt',
      capability: 'image',
      exhausted: true,
      reason: 'rate limit',
    });
    expect(quotaBus.isExhausted('chatgpt', 'image')).toBe(true);
    expect(quotaBus.isExhausted('chatgpt', 'text')).toBe(false);
  });

  it('listeners receive events', () => {
    const received: QuotaEvent[] = [];
    quotaBus.on((e) => received.push(e));

    quotaBus.emit({ provider: 'gemini', capability: 'text', exhausted: true });

    expect(received).toHaveLength(1);
    expect(received[0].provider).toBe('gemini');
    expect(received[0].capability).toBe('text');
    expect(received[0].exhausted).toBe(true);
    expect(received[0].timestamp).toBeTruthy();
  });

  it('unsubscribes listeners', () => {
    const received: QuotaEvent[] = [];
    const unsub = quotaBus.on((e) => received.push(e));

    quotaBus.emit({ provider: 'chatgpt', capability: 'text', exhausted: true });
    expect(received).toHaveLength(1);

    unsub();
    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true });
    expect(received).toHaveLength(1); // no new events
  });

  it('clears exhaustion on restore event', () => {
    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true });
    expect(quotaBus.isExhausted('chatgpt', 'image')).toBe(true);

    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: false });
    expect(quotaBus.isExhausted('chatgpt', 'image')).toBe(false);
  });

  it('tracks multiple providers independently', () => {
    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true });
    quotaBus.emit({ provider: 'gemini', capability: 'text', exhausted: true });

    expect(quotaBus.isExhausted('chatgpt', 'image')).toBe(true);
    expect(quotaBus.isExhausted('gemini', 'text')).toBe(true);
    expect(quotaBus.isExhausted('chatgpt', 'text')).toBe(false);
    expect(quotaBus.isExhausted('gemini', 'image')).toBe(false);
  });

  it('getExhaustedFor returns all exhausted capabilities for a provider', () => {
    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true });
    quotaBus.emit({ provider: 'chatgpt', capability: 'text', exhausted: true });
    quotaBus.emit({ provider: 'gemini', capability: 'video', exhausted: true });

    const chatgptExhausted = quotaBus.getExhaustedFor('chatgpt');
    expect(chatgptExhausted).toContain('image');
    expect(chatgptExhausted).toContain('text');
    expect(chatgptExhausted).not.toContain('video');
    expect(chatgptExhausted).toHaveLength(2);
  });

  it('getAll returns all exhaustion states', () => {
    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true });
    quotaBus.emit({ provider: 'gemini', capability: 'text', exhausted: true });

    const all = quotaBus.getAll();
    expect(all).toHaveLength(2);
  });

  it('reset clears a specific provider/capability', () => {
    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true });
    quotaBus.emit({ provider: 'chatgpt', capability: 'text', exhausted: true });

    quotaBus.reset('chatgpt', 'image');

    expect(quotaBus.isExhausted('chatgpt', 'image')).toBe(false);
    expect(quotaBus.isExhausted('chatgpt', 'text')).toBe(true);
  });

  it('resetAll clears all exhaustion states', () => {
    quotaBus.emit({ provider: 'chatgpt', capability: 'image', exhausted: true });
    quotaBus.emit({ provider: 'gemini', capability: 'text', exhausted: true });

    quotaBus.resetAll();

    expect(quotaBus.getAll()).toHaveLength(0);
    expect(quotaBus.isExhausted('chatgpt', 'image')).toBe(false);
    expect(quotaBus.isExhausted('gemini', 'text')).toBe(false);
  });

  it('handles listener errors without crashing', () => {
    quotaBus.on(() => { throw new Error('listener error'); });

    // Should not throw
    expect(() => {
      quotaBus.emit({ provider: 'test', capability: 'text', exhausted: true });
    }).not.toThrow();
  });
});
