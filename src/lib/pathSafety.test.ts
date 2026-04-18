import { describe, it, expect } from 'vitest';
import {
  sanitizeFileSystemPath,
  sanitizePathSegment,
  sanitizeFileName,
  ensurePathWithinBase,
} from './pathSafety.js';

describe('sanitizeFileSystemPath', () => {
  it('normalizes a valid path', () => {
    const result = sanitizeFileSystemPath('/tmp/foo/../bar');
    expect(result).toBe('/tmp/bar');
  });

  it('rejects non-string input', () => {
    expect(() => sanitizeFileSystemPath(123 as any)).toThrow('must be a string');
  });

  it('rejects empty string', () => {
    expect(() => sanitizeFileSystemPath('')).toThrow('is required');
    expect(() => sanitizeFileSystemPath('   ')).toThrow('is required');
  });

  it('rejects strings with control characters', () => {
    expect(() => sanitizeFileSystemPath('/tmp/foo\x00bar')).toThrow('control characters');
    expect(() => sanitizeFileSystemPath('/tmp/foo\x1fbar')).toThrow('control characters');
  });

  it('uses custom label in error messages', () => {
    expect(() => sanitizeFileSystemPath('', 'videoPath')).toThrow('videoPath');
  });
});

describe('sanitizePathSegment', () => {
  it('returns valid segment unchanged', () => {
    expect(sanitizePathSegment('my-file.json')).toBe('my-file.json');
  });

  it('rejects non-string input', () => {
    expect(() => sanitizePathSegment(null as any)).toThrow('must be a string');
  });

  it('rejects empty/dot segments', () => {
    expect(() => sanitizePathSegment('')).toThrow('invalid');
    expect(() => sanitizePathSegment('.')).toThrow('invalid');
    expect(() => sanitizePathSegment('..')).toThrow('invalid');
  });

  it('rejects segments with path separators', () => {
    expect(() => sanitizePathSegment('foo/bar')).toThrow('path separators');
    expect(() => sanitizePathSegment('foo\\bar')).toThrow('path separators');
  });

  it('rejects segments with control characters', () => {
    expect(() => sanitizePathSegment('foo\x00bar')).toThrow('control characters');
  });
});

describe('sanitizeFileName', () => {
  it('preserves safe names', () => {
    expect(sanitizeFileName('report.json')).toBe('report.json');
  });

  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFileName('my file (1).json')).toBe('my_file_1_.json');
  });

  it('collapses consecutive underscores', () => {
    expect(sanitizeFileName('a!!!b')).toBe('a_b');
  });

  it('trims leading/trailing separators', () => {
    const result = sanitizeFileName('__foo__');
    expect(result).toBe('foo');
  });

  it('returns fallback for empty/unsafe-only names', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('!!!')).toBe('file');
    expect(sanitizeFileName('!!!', 'default')).toBe('default');
  });

  it('handles non-string input', () => {
    expect(sanitizeFileName(undefined as any)).toBe('file');
    expect(sanitizeFileName(null as any)).toBe('file');
  });
});

describe('ensurePathWithinBase', () => {
  it('allows paths inside base directory', () => {
    const result = ensurePathWithinBase('/tmp/data', '/tmp/data/projects/proj_1');
    expect(result).toBe('/tmp/data/projects/proj_1');
  });

  it('allows exact base directory', () => {
    const result = ensurePathWithinBase('/tmp/data', '/tmp/data');
    expect(result).toBe('/tmp/data');
  });

  it('rejects path traversal outside base', () => {
    expect(() =>
      ensurePathWithinBase('/tmp/data', '/tmp/data/../etc/passwd'),
    ).toThrow('escapes base directory');
  });

  it('rejects completely different path', () => {
    expect(() =>
      ensurePathWithinBase('/tmp/data', '/home/user'),
    ).toThrow('escapes base directory');
  });
});
