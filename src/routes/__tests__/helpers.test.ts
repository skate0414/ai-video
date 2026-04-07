import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readBody, parseJsonBody, BodyTooLargeError } from '../helpers.js';

/** Create a fake IncomingMessage-like readable from a string */
function fakeRequest(body: string): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  return stream as unknown as IncomingMessage;
}

function fakeChunkedRequest(chunks: string[]): IncomingMessage {
  const stream = Readable.from(chunks.map(c => Buffer.from(c)));
  return stream as unknown as IncomingMessage;
}

describe('readBody', () => {
  it('reads a normal body', async () => {
    const result = await readBody(fakeRequest('hello world'));
    expect(result).toBe('hello world');
  });

  it('reads empty body', async () => {
    const result = await readBody(fakeRequest(''));
    expect(result).toBe('');
  });

  it('concatenates multiple chunks', async () => {
    const result = await readBody(fakeChunkedRequest(['hello', ' ', 'world']));
    expect(result).toBe('hello world');
  });

  it('throws BodyTooLargeError when body exceeds limit', async () => {
    const bigBody = 'x'.repeat(200);
    await expect(readBody(fakeRequest(bigBody), 100)).rejects.toThrow(BodyTooLargeError);
  });

  it('accepts body within limit', async () => {
    const result = await readBody(fakeRequest('ok'), 1024);
    expect(result).toBe('ok');
  });
});

describe('parseJsonBody', () => {
  it('parses valid JSON', async () => {
    const result = await parseJsonBody<{ name: string }>(fakeRequest('{"name":"test"}'));
    expect(result.name).toBe('test');
  });

  it('throws SyntaxError for invalid JSON', async () => {
    await expect(parseJsonBody(fakeRequest('not json'))).rejects.toThrow(SyntaxError);
  });

  it('throws SyntaxError for empty body', async () => {
    await expect(parseJsonBody(fakeRequest(''))).rejects.toThrow(SyntaxError);
  });

  it('respects maxSize parameter', async () => {
    const bigJson = JSON.stringify({ data: 'x'.repeat(200) });
    await expect(parseJsonBody(fakeRequest(bigJson), 100)).rejects.toThrow(BodyTooLargeError);
  });
});
