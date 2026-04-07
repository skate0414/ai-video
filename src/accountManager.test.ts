import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountManager } from './accountManager.js';

describe('AccountManager', () => {
  let mgr: AccountManager;
  let testId = 0;

  beforeEach(() => {
    // Use a unique non-existent path so each test starts with no saved data
    // and seedDefaults is skipped by passing skipSeed=true via a temp path
    const tempPath = join(tmpdir(), `acct-test-${Date.now()}-${++testId}.json`);
    mgr = new AccountManager(tempPath, true);
  });

  it('starts empty', () => {
    expect(mgr.all()).toHaveLength(0);
    expect(mgr.availableCount()).toBe(0);
  });

  it('adds an account', () => {
    const acc = mgr.addAccount('chatgpt', 'My GPT', '/tmp/profile-gpt');
    expect(acc.provider).toBe('chatgpt');
    expect(acc.label).toBe('My GPT');
    expect(acc.quotaExhausted).toBe(false);
    expect(mgr.all()).toHaveLength(1);
  });

  it('removes an account', () => {
    const acc = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
    expect(mgr.removeAccount(acc.id)).toBe(true);
    expect(mgr.all()).toHaveLength(0);
  });

  it('returns false when removing non-existent account', () => {
    expect(mgr.removeAccount('nope')).toBe(false);
  });

  it('picks preferred provider first', () => {
    mgr.addAccount('gemini', 'Gemini 1', '/tmp/g1');
    mgr.addAccount('chatgpt', 'GPT 1', '/tmp/gpt1');
    const pick = mgr.pickAccount('chatgpt');
    expect(pick?.provider).toBe('chatgpt');
  });

  it('falls back when preferred provider unavailable', () => {
    mgr.addAccount('gemini', 'Gemini 1', '/tmp/g1');
    const pick = mgr.pickAccount('chatgpt');
    expect(pick?.provider).toBe('gemini');
  });

  it('returns undefined when all quotas exhausted', () => {
    const a1 = mgr.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    const a2 = mgr.addAccount('gemini', 'Gemini 1', '/tmp/p2');
    mgr.markQuotaExhausted(a1.id);
    mgr.markQuotaExhausted(a2.id);
    expect(mgr.pickAccount()).toBeUndefined();
    expect(mgr.availableCount()).toBe(0);
  });

  it('skips exhausted accounts when picking', () => {
    const a1 = mgr.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    mgr.addAccount('gemini', 'Gemini 1', '/tmp/p2');
    mgr.markQuotaExhausted(a1.id);
    const pick = mgr.pickAccount();
    expect(pick?.provider).toBe('gemini');
  });

  it('resets quota for a single account', () => {
    const a = mgr.addAccount('chatgpt', 'GPT', '/tmp/p');
    mgr.markQuotaExhausted(a.id);
    expect(mgr.availableCount()).toBe(0);
    mgr.resetQuota(a.id);
    expect(mgr.availableCount()).toBe(1);
    expect(mgr.get(a.id)?.quotaResetAt).toBeTruthy();
  });

  it('resets all quotas', () => {
    const a1 = mgr.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    const a2 = mgr.addAccount('gemini', 'Gemini 1', '/tmp/p2');
    mgr.markQuotaExhausted(a1.id);
    mgr.markQuotaExhausted(a2.id);
    mgr.resetAllQuotas();
    expect(mgr.availableCount()).toBe(2);
  });
});
