/* ------------------------------------------------------------------ */
/*  Unit tests for videoProviders/download – downloadFromHttpUrl       */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadFromHttpUrl } from './download.js';

// We mock node:https to avoid real network calls.
vi.mock('node:https', async () => {
  const { EventEmitter } = await import('node:events');

  class FakeRequest extends EventEmitter {
    private _timeoutCb: (() => void) | null = null;

    setTimeout(ms: number, cb: () => void) {
      this._timeoutCb = cb;
      return this;
    }

    destroy(err?: Error) {
      if (err) this.emit('error', err);
    }

    /** Test helper: trigger the timeout callback manually. */
    _triggerTimeout() {
      this._timeoutCb?.();
    }
  }

  class FakeResponse extends EventEmitter {}

  type GetCallback = (res: FakeResponse) => void;

  /** Shared state so tests can control what node:https.get emits. */
  const state = {
    responseChunks: [] as Buffer[],
    responseError: null as Error | null,
    requestError: null as Error | null,
    simulateTimeout: false,
    lastRequest: null as FakeRequest | null,
  };

  const get = vi.fn((url: string, cb: GetCallback) => {
    const req = new FakeRequest();
    state.lastRequest = req;

    if (state.requestError) {
      setImmediate(() => req.emit('error', state.requestError));
    } else if (state.simulateTimeout) {
      // Don't call cb; let test call req._triggerTimeout()
    } else {
      const res = new FakeResponse();
      setImmediate(() => {
        cb(res);
        for (const chunk of state.responseChunks) res.emit('data', chunk);
        if (state.responseError) {
          res.emit('error', state.responseError);
        } else {
          res.emit('end');
        }
      });
    }

    return req;
  });

  return {
    default: { get },
    __state: state,
  };
});

/** Get the mutable state object from the mock. */
async function getState() {
  const mod = await import('node:https') as any;
  return mod.__state as {
    responseChunks: Buffer[];
    responseError: Error | null;
    requestError: Error | null;
    simulateTimeout: boolean;
    lastRequest: { _triggerTimeout(): void } | null;
  };
}

afterEach(async () => {
  const s = await getState();
  s.responseChunks = [];
  s.responseError = null;
  s.requestError = null;
  s.simulateTimeout = false;
  s.lastRequest = null;
  vi.clearAllMocks();
});

describe('downloadFromHttpUrl', () => {
  it('returns buffer when download succeeds and data exceeds threshold', async () => {
    const s = await getState();
    // 11 KB — above the 10 KB minimum
    s.responseChunks = [Buffer.alloc(11_000, 0xab)];

    const result = await downloadFromHttpUrl('https://cdn.example.com/video.mp4');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(11_000);
  });

  it('returns null when downloaded data is too small (< 10 KB)', async () => {
    const s = await getState();
    s.responseChunks = [Buffer.alloc(5_000, 0x01)]; // only 5 KB

    const result = await downloadFromHttpUrl('https://cdn.example.com/small.mp4');
    expect(result).toBeNull();
  });

  it('returns null when the request itself errors', async () => {
    const s = await getState();
    s.requestError = new Error('ECONNRESET: connection reset');

    const result = await downloadFromHttpUrl('https://cdn.example.com/video.mp4');
    expect(result).toBeNull();
  });

  it('returns null when the response stream errors', async () => {
    const s = await getState();
    s.responseError = new Error('stream aborted');
    s.responseChunks = [];

    const result = await downloadFromHttpUrl('https://cdn.example.com/video.mp4');
    expect(result).toBeNull();
  });

  it('concatenates multiple data chunks correctly', async () => {
    const s = await getState();
    const chunk = Buffer.alloc(4_000, 0xff);
    // Three 4 KB chunks → 12 KB total, above the 10 KB threshold
    s.responseChunks = [chunk, chunk, chunk];

    const result = await downloadFromHttpUrl('https://cdn.example.com/multi.mp4');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(12_000);
  });
});
