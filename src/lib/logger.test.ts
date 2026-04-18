import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('emits structured JSON to stdout for info', () => {
    const log = createLogger('TestModule');
    log.info('test_action', { key: 'value' });
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const line = (stdoutSpy.mock.calls[0][0] as string).trim();
    const entry = JSON.parse(line);
    expect(entry.level).toBe('info');
    expect(entry.module).toBe('TestModule');
    expect(entry.action).toBe('test_action');
    expect(entry.key).toBe('value');
    expect(entry.ts).toBeDefined();
  });

  it('emits errors to stderr with stack', () => {
    const log = createLogger('ErrModule');
    const err = new Error('boom');
    log.error('failed', err, { ctx: 'test' });
    expect(stderrSpy).toHaveBeenCalledOnce();
    const line = (stderrSpy.mock.calls[0][0] as string).trim();
    const entry = JSON.parse(line);
    expect(entry.level).toBe('error');
    expect(entry.error).toBe('boom');
    expect(entry.stack).toContain('Error: boom');
    expect(entry.ctx).toBe('test');
  });

  it('truncates long string values in meta', () => {
    const log = createLogger('Truncate');
    const longStr = 'x'.repeat(1000);
    log.info('long_meta', { prompt: longStr });
    const line = (stdoutSpy.mock.calls[0][0] as string).trim();
    const entry = JSON.parse(line);
    expect(entry.prompt.length).toBeLessThan(600);
    expect(entry.prompt).toContain('[truncated');
  });

  it('warn level writes to stdout', () => {
    const log = createLogger('WarnTest');
    log.warn('something', { detail: 'abc' });
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const entry = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(entry.level).toBe('warn');
  });
});
