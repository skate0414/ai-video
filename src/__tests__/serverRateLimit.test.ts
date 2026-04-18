/* ------------------------------------------------------------------ */
/*  Server-level integration tests – rate limiting & HTTP handling    */
/* ------------------------------------------------------------------ */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { RateLimiter } from '../rateLimiter.js';

/**
 * Minimal HTTP server that replicates the rate-limit middleware from server.ts.
 * We spin up a real server to exercise the full HTTP path.
 */

function makeTestServer(limiterConfig: { max: number; windowMs: number }) {
  const limiter = new RateLimiter(limiterConfig);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const rl = limiter.consume(ip);
    res.setHeader('X-RateLimit-Limit', String(limiterConfig.max));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));

    if (!rl.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  return { server, limiter };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('Server rate-limiting integration', () => {
  let server: Server;
  let limiter: RateLimiter;
  let port: number;

  beforeAll(async () => {
    const t = makeTestServer({ max: 5, windowMs: 60_000 });
    server = t.server;
    limiter = t.limiter;
    port = await listen(server);
  });

  afterAll(async () => {
    limiter.destroy();
    await close(server);
  });

  it('returns 200 for requests within the limit', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-limit')).toBe('5');
    expect(Number(res.headers.get('x-ratelimit-remaining'))).toBeGreaterThanOrEqual(0);
  });

  it('returns 429 after exceeding the limit', async () => {
    // Consume remaining quota (we already used 1 in the previous test)
    for (let i = 0; i < 4; i++) {
      await fetch(`http://127.0.0.1:${port}/`);
    }
    // This 6th request should be blocked
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Too many requests');
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('includes X-RateLimit headers on 429 responses', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    // Already over limit from previous test
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
  });
});
