import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectVideoOptions } from './videoOptionSelector.js';
import type { VideoGenRequest } from './videoProvider.js';

type MockPage = {
  locator: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
};

function makePage(opts?: { locatorHasTarget?: boolean; evaluateResults?: boolean[] }): MockPage {
  const locatorHasTarget = opts?.locatorHasTarget ?? false;
  const evaluateResults = [...(opts?.evaluateResults ?? [])];

  const click = vi.fn(async () => {});
  const first = () => ({
    count: vi.fn(async () => (locatorHasTarget ? 1 : 0)),
    click,
  });
  const getByText = vi.fn(() => ({ first }));
  const locator = vi.fn(() => ({
    count: vi.fn(async () => (locatorHasTarget ? 1 : 0)),
    getByText,
  }));

  const evaluate = vi.fn(async () => (evaluateResults.length > 0 ? evaluateResults.shift()! : false));
  const waitForTimeout = vi.fn(async () => {});

  return { locator, evaluate, waitForTimeout };
}

describe('selectVideoOptions', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('selects options via locator text strategy when available', async () => {
    const page = makePage({ locatorHasTarget: true });
    const request: VideoGenRequest = {
      prompt: 'A sunrise over mountains',
      model: '2.0',
      duration: 5,
      resolution: '1080p',
    };

    await selectVideoOptions(page as any, request, false);

    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
  });

  it('falls back to broad scan and retries duration/resolution with CN labels', async () => {
    const page = makePage({
      locatorHasTarget: false,
      // model(false), duration(false), duration-cn(true), resolution(false), resolution-cn(true)
      evaluateResults: [false, false, true, false, true],
    });

    const request: VideoGenRequest = {
      prompt: 'A futuristic city',
      model: 'Model-X',
      duration: 10,
      resolution: '1080p',
    };

    await selectVideoOptions(page as any, request, true);

    expect(page.evaluate).toHaveBeenCalled();
    expect(page.evaluate.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(console.warn).toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalled();
  });
});
