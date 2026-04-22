import { describe, it, expect, vi } from 'vitest';
import { isQuotaError, isTransient, tagIfQuota, withRetry } from './retry.js';

describe('isQuotaError', () => {
  it('matches 429 status', () => {
    expect(isQuotaError({ status: 429 })).toBe(true);
  });

  it('matches quota phrases in English', () => {
    expect(isQuotaError(new Error('Resource_exhausted for free plan limit'))).toBe(true);
    expect(isQuotaError(new Error('you have reached your quota'))).toBe(true);
  });

  it('matches quota phrases in Chinese', () => {
    expect(isQuotaError(new Error('请求过于频繁'))).toBe(true);
    expect(isQuotaError(new Error('已达到今日使用上限'))).toBe(true);
  });

  it('respects explicit isQuotaError tag', () => {
    expect(isQuotaError({ isQuotaError: true, message: 'whatever' })).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isQuotaError(new Error('bad request'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe('isTransient', () => {
  it('matches retriable HTTP codes', () => {
    expect(isTransient({ status: 429 })).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
    expect(isTransient({ status: 404 })).toBe(false);
  });

  it('matches node error codes', () => {
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransient({ code: 'ENOTFOUND' })).toBe(true);
    expect(isTransient({ code: 'ENOENT' })).toBe(false);
  });

  it('matches ENOTFOUND in message string', () => {
    expect(isTransient(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe(true);
  });
});

describe('tagIfQuota', () => {
  it('tags quota-like errors in place', () => {
    const err: { status?: number; isQuotaError?: boolean } = { status: 429 };
    tagIfQuota(err);
    expect(err.isQuotaError).toBe(true);
  });

  it('leaves unrelated errors untouched', () => {
    const err: { status?: number; isQuotaError?: boolean } = { status: 400 };
    tagIfQuota(err);
    expect(err.isQuotaError).toBeUndefined();
  });
});

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors then succeeds', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('503 service unavailable'), { status: 503 });
      return 'ok';
    };
    const start = Date.now();
    const result = await withRetry(fn, {
      maxRetries: 5,
      label: 'test',
      delayMs: () => 1, // fast test
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('does not retry non-retriable errors', async () => {
    let calls = 0;
    const fn = async () => { calls++; throw new Error('bad request'); };
    await expect(withRetry(fn, {
      maxRetries: 3,
      isRetriable: () => false,
      delayMs: () => 0,
    })).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('stops at maxRetries and rethrows last error', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw Object.assign(new Error('rate limit'), { status: 429 });
    };
    await expect(withRetry(fn, { maxRetries: 2, delayMs: () => 0 }))
      .rejects.toThrow('rate limit');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('honours abort signal mid-wait', async () => {
    const ctrl = new AbortController();
    const fn = async () => { throw Object.assign(new Error('503'), { status: 503 }); };
    const promise = withRetry(fn, { signal: ctrl.signal, delayMs: () => 5000 });
    setTimeout(() => ctrl.abort(), 10);
    await expect(promise).rejects.toThrow();
  });
});
