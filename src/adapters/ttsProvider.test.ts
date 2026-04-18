import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import {
  buildEdgeTtsArgs,
  generateSpeechLocal,
  isEdgeTTSAvailable,
  listVoices,
  resolveVoiceFromStyle,
  resolveRateFromPacing,
} from './ttsProvider.js';

describe('resolveVoiceFromStyle', () => {
  it('returns default Chinese female voice for undefined style', () => {
    expect(resolveVoiceFromStyle()).toBe('zh-CN-XiaoxiaoNeural');
  });

  it('returns default Chinese female voice for empty string', () => {
    expect(resolveVoiceFromStyle('')).toBe('zh-CN-XiaoxiaoNeural');
  });

  it('returns Chinese male voice for "male" keyword', () => {
    const voice = resolveVoiceFromStyle('male narrator');
    expect(voice).toBe('zh-CN-YunxiNeural');
  });

  it('returns deep Chinese male voice for "deep male"', () => {
    const voice = resolveVoiceFromStyle('deep male voice');
    expect(voice).toBe('zh-CN-YunjianNeural');
  });

  it('returns calm Chinese male voice for "calm" keyword', () => {
    const voice = resolveVoiceFromStyle('calm man');
    expect(voice).toBe('zh-CN-YunjianNeural');
  });

  it('returns Chinese male voice for "男" keyword', () => {
    const voice = resolveVoiceFromStyle('男性旁白');
    expect(voice).toBe('zh-CN-YunxiNeural');
  });

  it('returns deep Chinese male voice for "沉稳" keyword', () => {
    const voice = resolveVoiceFromStyle('沉稳男声');
    expect(voice).toBe('zh-CN-YunjianNeural');
  });

  it('returns Chinese female voice for "female" keyword', () => {
    const voice = resolveVoiceFromStyle('female narrator');
    expect(voice).toBe('zh-CN-XiaoxiaoNeural');
  });

  it('returns warm Chinese female voice for "warm woman"', () => {
    const voice = resolveVoiceFromStyle('warm woman');
    expect(voice).toBe('zh-CN-XiaoyiNeural');
  });

  it('returns Chinese female voice for "女" keyword', () => {
    const voice = resolveVoiceFromStyle('女性旁白');
    expect(voice).toBe('zh-CN-XiaoxiaoNeural');
  });

  // English voices
  it('returns English female voice when language is English', () => {
    const voice = resolveVoiceFromStyle('female narrator', 'English');
    expect(voice).toBe('en-US-JennyNeural');
  });

  it('returns English male voice for "male" with English language', () => {
    const voice = resolveVoiceFromStyle('male narrator', 'English');
    expect(voice).toBe('en-US-ChristopherNeural');
  });

  it('returns deep English male voice for "deep male" with English language', () => {
    const voice = resolveVoiceFromStyle('deep male voice', 'English');
    expect(voice).toBe('en-US-GuyNeural');
  });

  it('returns calm English male voice for "calm man" with English language', () => {
    const voice = resolveVoiceFromStyle('calm man', 'English');
    expect(voice).toBe('en-US-GuyNeural');
  });

  it('returns English female for unmatched style with English language', () => {
    const voice = resolveVoiceFromStyle('professional', 'English');
    expect(voice).toBe('en-US-JennyNeural');
  });
});

describe('resolveRateFromPacing', () => {
  it('returns undefined for undefined pacing', () => {
    expect(resolveRateFromPacing()).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(resolveRateFromPacing('')).toBeUndefined();
  });

  it('returns +10% for fast pacing', () => {
    expect(resolveRateFromPacing('fast')).toBe('+10%');
  });

  it('returns +5% for medium-fast pacing', () => {
    expect(resolveRateFromPacing('medium-fast')).toBe('+5%');
  });

  it('returns -10% for slow pacing', () => {
    expect(resolveRateFromPacing('slow')).toBe('-10%');
  });

  it('returns -5% for medium-slow pacing', () => {
    expect(resolveRateFromPacing('medium-slow')).toBe('-5%');
  });

  it('returns +10% for Chinese "快" keyword', () => {
    expect(resolveRateFromPacing('快')).toBe('+10%');
  });

  it('returns -10% for Chinese "慢" keyword', () => {
    expect(resolveRateFromPacing('慢')).toBe('-10%');
  });

  it('returns undefined for medium/normal pacing', () => {
    expect(resolveRateFromPacing('medium')).toBeUndefined();
    expect(resolveRateFromPacing('normal')).toBeUndefined();
  });
});

describe('edge-tts CLI security', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('builds argv arrays without shell escaping or command concatenation', () => {
    const outputPath = resolve('/tmp/demo audio.mp3');
    const args = buildEdgeTtsArgs("it's fine\nnext line", {
      assetsDir: '/tmp',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: '+10%',
      pitch: '+0Hz',
    }, outputPath);

    expect(args).toEqual([
      '--voice',
      'zh-CN-XiaoxiaoNeural',
      '--text',
      "it's fine next line",
      '--write-media',
      outputPath,
      '--rate',
      '+10%',
      '--pitch',
      '+0Hz',
    ]);
  });

  it('runs edge-tts via execFile with sanitized output path', async () => {
    execFileMock.mockImplementation((_file, args, _options, callback) => {
      const outputIndex = args.indexOf('--write-media');
      const outputPath = args[outputIndex + 1];
      mkdirSync(resolve(outputPath, '..'), { recursive: true });
      writeFileSync(outputPath, 'audio');
      callback(null, '', '');
    });

    const tempRoot = mkdtempSync(join(tmpdir(), 'tts-provider-'));
    const assetsDir = join(tempRoot, 'voices');
    const result = await generateSpeechLocal('hello world', {
      assetsDir: `${assetsDir}/../voices`,
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: '+5%',
    });

    expect(result.audioUrl).toBeDefined();
    expect(result.audioUrl).toMatch(/tts_[a-z0-9_]+\.mp3$/i);
    expect(result.audioUrl!.startsWith(resolve(assetsDir))).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      'edge-tts',
      expect.arrayContaining([
        '--voice',
        'zh-CN-XiaoxiaoNeural',
        '--text',
        'hello world',
        '--rate',
        '+5%',
      ]),
      expect.objectContaining({ timeout: 60_000, windowsHide: true }),
      expect.any(Function),
    );
  });

  it('checks availability and voice listing via execFile argv arrays', async () => {
    execFileMock
      .mockImplementationOnce((_file, _args, _options, callback) => {
        callback(null, 'edge-tts 1.0.0', '');
      })
      .mockImplementationOnce((_file, _args, _options, callback) => {
        callback(null, 'Name: zh-CN-XiaoxiaoNeural\nName: en-US-JennyNeural\n', '');
      });

    await expect(isEdgeTTSAvailable()).resolves.toBe(true);
    await expect(listVoices('zh-CN')).resolves.toEqual(['zh-CN-XiaoxiaoNeural']);

    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'edge-tts',
      ['--version'],
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'edge-tts',
      ['--list-voices'],
      expect.objectContaining({ timeout: 10_000, windowsHide: true }),
      expect.any(Function),
    );
  });
});
