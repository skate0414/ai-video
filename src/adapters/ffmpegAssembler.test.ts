import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

import { assembleVideo, generateSRT, formatSRT, getMediaDuration, isFFmpegAvailable, getAudioMeanVolume, getVideoInfo, hexToAssColor, buildSubtitleForceStyle } from './ffmpegAssembler.js';

describe('formatSRT', () => {
  it('formats zero seconds', () => {
    expect(formatSRT(0)).toBe('00:00:00,000');
  });

  it('formats seconds only', () => {
    expect(formatSRT(5)).toBe('00:00:05,000');
  });

  it('formats minutes and seconds', () => {
    expect(formatSRT(65)).toBe('00:01:05,000');
  });

  it('formats hours, minutes, seconds', () => {
    expect(formatSRT(3661)).toBe('01:01:01,000');
  });

  it('formats fractional seconds (milliseconds)', () => {
    expect(formatSRT(1.5)).toBe('00:00:01,500');
  });

  it('formats small fractional seconds', () => {
    expect(formatSRT(0.1)).toBe('00:00:00,100');
  });

  it('formats complex time', () => {
    // 1h 23m 45.678s
    expect(formatSRT(5025.678)).toBe('01:23:45,678');
  });
});

describe('generateSRT', () => {
  it('generates empty SRT for empty scenes', () => {
    expect(generateSRT([])).toBe('');
  });

  it('generates single scene SRT', () => {
    const scenes = [
      { narrative: 'Hello world', assetType: 'image' as const, audioDuration: 5 },
    ];
    const srt = generateSRT(scenes);
    const lines = srt.split('\n');
    expect(lines[0]).toBe('1');
    expect(lines[1]).toBe('00:00:00,000 --> 00:00:05,000');
    expect(lines[2]).toBe('Hello world');
  });

  it('generates multi-scene SRT with cumulative timing', () => {
    const scenes = [
      { narrative: 'Scene one', assetType: 'image' as const, audioDuration: 3 },
      { narrative: 'Scene two', assetType: 'video' as const, audioDuration: 4 },
      { narrative: 'Scene three', assetType: 'image' as const, audioDuration: 2 },
    ];
    const srt = generateSRT(scenes);
    const lines = srt.split('\n');

    // Scene 1: 0-3s
    expect(lines[0]).toBe('1');
    expect(lines[1]).toBe('00:00:00,000 --> 00:00:03,000');
    expect(lines[2]).toBe('Scene one');

    // Scene 2: 3-7s
    expect(lines[4]).toBe('2');
    expect(lines[5]).toBe('00:00:03,000 --> 00:00:07,000');
    expect(lines[6]).toBe('Scene two');

    // Scene 3: 7-9s
    expect(lines[8]).toBe('3');
    expect(lines[9]).toBe('00:00:07,000 --> 00:00:09,000');
    expect(lines[10]).toBe('Scene three');
  });

  it('uses estimatedDuration as fallback when audioDuration is missing', () => {
    const scenes = [
      { narrative: 'No audio duration', assetType: 'image' as const, estimatedDuration: 8 },
    ];
    const srt = generateSRT(scenes);
    expect(srt).toContain('00:00:00,000 --> 00:00:08,000');
  });

  it('uses 5s default when both audioDuration and estimatedDuration are missing', () => {
    const scenes = [
      { narrative: 'Default duration', assetType: 'placeholder' as const },
    ];
    const srt = generateSRT(scenes);
    expect(srt).toContain('00:00:00,000 --> 00:00:05,000');
  });
});

describe('getAudioMeanVolume', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('parses mean_volume from ffmpeg stderr', async () => {
    spawnMock.mockImplementation(() => {
      const child = new PassThrough() as any;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stderr.push('[Parsed_volumedetect_0 @ 0x1234] mean_volume: -20.3 dB\n');
        child.stderr.push(null);
        child.stdout.push(null);
        child.emit('close', 0, null);
      });
      return child;
    });
    const vol = await getAudioMeanVolume('/tmp/test.wav');
    expect(vol).toBe(-20.3);
  });

  it('returns -Infinity when no volume detected', async () => {
    spawnMock.mockImplementation(() => {
      const child = new PassThrough() as any;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stderr.push('some other output\n');
        child.stderr.push(null);
        child.stdout.push(null);
        child.emit('close', 0, null);
      });
      return child;
    });
    const vol = await getAudioMeanVolume('/tmp/test.wav');
    expect(vol).toBe(-Infinity);
  });

  it('returns -Infinity on spawn error', async () => {
    spawnMock.mockImplementation(() => {
      const child = new PassThrough() as any;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.emit('error', new Error('ENOENT'));
      });
      return child;
    });
    const vol = await getAudioMeanVolume('/tmp/test.wav');
    expect(vol).toBe(-Infinity);
  });
});

describe('getVideoInfo', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('parses video info from ffprobe output', async () => {
    execFileMock.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(null, JSON.stringify({
        format: { duration: '10.5' },
        streams: [{ width: 1920, height: 1080 }],
      }), '');
    });
    const info = await getVideoInfo('/tmp/video.mp4');
    expect(info).toEqual({ duration: 10.5, width: 1920, height: 1080 });
  });

  it('returns undefined on ffprobe error', async () => {
    execFileMock.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(new Error('ENOENT'), '', '');
    });
    const info = await getVideoInfo('/tmp/missing.mp4');
    expect(info).toBeUndefined();
  });

  it('handles missing streams gracefully', async () => {
    execFileMock.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(null, JSON.stringify({ format: { duration: '5.0' } }), '');
    });
    const info = await getVideoInfo('/tmp/audio-only.mp4');
    expect(info).toEqual({ duration: 5, width: 0, height: 0 });
  });
});

describe('isFFmpegAvailable', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('returns false when ffmpeg is not found', async () => {
    execFileMock.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(new Error('ENOENT'), '', '');
    });
    expect(await isFFmpegAvailable()).toBe(false);
  });
});

describe('getMediaDuration', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('returns 0 on ffprobe error', async () => {
    execFileMock.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(new Error('ENOENT'), '', '');
    });
    expect(await getMediaDuration('/tmp/missing.wav')).toBe(0);
  });

  it('returns 0 for non-numeric output', async () => {
    execFileMock.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(null, 'N/A\n', '');
    });
    expect(await getMediaDuration('/tmp/bad.wav')).toBe(0);
  });
});

describe('ffmpeg CLI security', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks ffmpeg availability via execFile args instead of shell strings', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, 'ffmpeg version', '');
    });

    await expect(isFFmpegAvailable()).resolves.toBe(true);
    const [binary, args, options, callback] = execFileMock.mock.calls[0];
    expect(binary).toMatch(/(^ffmpeg$|\/ffmpeg$)/);
    expect(args).toEqual(['-version']);
    expect(options).toEqual(expect.objectContaining({ timeout: 10_000, windowsHide: true }));
    expect(callback).toEqual(expect.any(Function));
  });

  it('sanitizes media paths before ffprobe execution', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, '12.5\n', '');
    });

    const rawPath = './tmp/../fixtures/demo clip.mp4';
    const duration = await getMediaDuration(rawPath);

    expect(duration).toBe(12.5);
    const [binary, args, options, callback] = execFileMock.mock.calls[0];
    expect(binary).toMatch(/(^ffprobe$|\/ffprobe$)/);
    expect(args).toEqual([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      resolve(rawPath),
    ]);
    expect(options).toEqual(expect.objectContaining({ timeout: 15_000, windowsHide: true }));
    expect(callback).toEqual(expect.any(Function));
  });

  it('assembles videos via spawn with argv arrays and sanitized paths', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, '5\n', '');
    });
    spawnMock.mockImplementation(() => {
      const child = new PassThrough() as PassThrough & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
        on: PassThrough['on'];
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.emit('close', 0, null);
      });
      return child;
    });

    const tempRoot = mkdtempSync(join(tmpdir(), 'ffmpeg-assembler-'));
    const assetsDir = join(tempRoot, 'assets');
    const outputDir = join(tempRoot, 'out');
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const assetPath = join(assetsDir, 'scene input.png');
    const audioPath = join(assetsDir, 'scene audio.wav');
    writeFileSync(assetPath, 'asset');
    writeFileSync(audioPath, 'audio');

    await assembleVideo(
      [
        {
          narrative: 'Scene one',
          assetUrl: assetPath,
          assetType: 'image',
          audioUrl: audioPath,
          audioDuration: 5,
        },
      ],
      {
        assetsDir: `${assetsDir}/../assets`,
        outputDir,
        projectTitle: 'security check',
      },
    );

    const firstCall = spawnMock.mock.calls[0];
    expect(firstCall[0]).toMatch(/(^ffmpeg$|\/ffmpeg$)/);
    expect(Array.isArray(firstCall[1])).toBe(true);
    expect(firstCall[1]).toEqual(expect.arrayContaining(['-loop', '1', '-i', resolve(assetPath), '-i', resolve(audioPath)]));
    expect(firstCall[2]).toEqual(expect.objectContaining({ cwd: resolve(outputDir, '_assembly_tmp') }));
    expect(firstCall[1].join(' ')).not.toContain('"');
  });
});

/* ------------------------------------------------------------------ */
/*  buildXfadeFilterGraph – per-transition duration support            */
/* ------------------------------------------------------------------ */

describe('buildXfadeFilterGraph', () => {
  // Import inline since the test file uses hoisted mocks
  let buildXfadeFilterGraph: typeof import('./ffmpegAssembler.js')['buildXfadeFilterGraph'];
  let XFADE_DURATION: number;

  beforeEach(async () => {
    const mod = await import('./ffmpegAssembler.js');
    buildXfadeFilterGraph = mod.buildXfadeFilterGraph;
    XFADE_DURATION = mod.XFADE_DURATION;
  });

  it('uses default XFADE_DURATION when transitionDurations not provided', () => {
    const { vFilters } = buildXfadeFilterGraph([5, 5], ['dissolve']);
    expect(vFilters[0]).toContain(`duration=${XFADE_DURATION}`);
  });

  it('uses per-transition durations when provided', () => {
    const { vFilters, aFilters } = buildXfadeFilterGraph(
      [5, 5, 5],
      ['dissolve', 'fade'],
      [1.0, 0.3],
    );
    expect(vFilters[0]).toContain('duration=1');
    expect(aFilters[0]).toContain('d=1');
    expect(vFilters[1]).toContain('duration=0.3');
    expect(aFilters[1]).toContain('d=0.3');
  });

  it('falls back to XFADE_DURATION for missing entries', () => {
    const { vFilters } = buildXfadeFilterGraph(
      [5, 5, 5],
      ['dissolve', 'fade'],
      [0.8], // only 1 entry for 2 transitions
    );
    expect(vFilters[0]).toContain('duration=0.8');
    expect(vFilters[1]).toContain(`duration=${XFADE_DURATION}`);
  });

  it('downgrades to hard cut when clip is shorter than 2×transitionDuration', () => {
    const { vFilters } = buildXfadeFilterGraph(
      [1.0, 5],
      ['dissolve'],
      [1.5], // 2×1.5 = 3.0 > 1.0 → downgrade
    );
    expect(vFilters[0]).toContain('concat=n=2');
    expect(vFilters[0]).not.toContain('xfade');
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 5 – Final output enhancements                               */
/* ------------------------------------------------------------------ */

describe('Phase 5 – final output enhancements', () => {
  let tempRoot: string;
  let assetsDir: string;
  let outputDir: string;
  let assetPath: string;
  let audioPath: string;

  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();

    execFileMock.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(null, '10\n', '');
    });

    spawnMock.mockImplementation(() => {
      const child = new PassThrough() as any;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.emit('close', 0, null);
      });
      return child;
    });

    tempRoot = mkdtempSync(join(tmpdir(), 'ffmpeg-phase5-'));
    assetsDir = join(tempRoot, 'assets');
    outputDir = join(tempRoot, 'out');
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    assetPath = join(assetsDir, 'scene.png');
    audioPath = join(assetsDir, 'scene.wav');
    writeFileSync(assetPath, 'asset');
    writeFileSync(audioPath, 'audio');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function lastSpawnArgs(): string[] {
    const calls = spawnMock.mock.calls;
    return calls[calls.length - 1][1] as string[];
  }

  function allSpawnArgs(): string[][] {
    return spawnMock.mock.calls.map((c: any) => c[1] as string[]);
  }

  const baseScenes = () => [{
    narrative: 'Test scene',
    assetUrl: assetPath,
    assetType: 'image' as const,
    audioUrl: audioPath,
    audioDuration: 5,
  }];

  it('applies fade-in video filter when fadeInDuration is set', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'fade-in-test',
      fadeInDuration: 0.5,
    });

    const args = lastSpawnArgs();
    const vfIdx = args.indexOf('-vf');
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toContain('fade=t=in:d=0.5');
  });

  it('applies fade-out video filter with correct start time', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'fade-out-test',
      fadeOutDuration: 1.0,
    });

    const args = lastSpawnArgs();
    const vfIdx = args.indexOf('-vf');
    expect(vfIdx).toBeGreaterThan(-1);
    // Duration is 10s (from mock), so start = 10 - 1 = 9.000
    expect(args[vfIdx + 1]).toContain('fade=t=out:st=9.000:d=1');
  });

  it('applies combined fade-in and fade-out video + audio filters', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'fade-both-test',
      fadeInDuration: 0.5,
      fadeOutDuration: 1.0,
    });

    const args = lastSpawnArgs();
    const vfIdx = args.indexOf('-vf');
    const afIdx = args.indexOf('-af');
    expect(vfIdx).toBeGreaterThan(-1);
    expect(afIdx).toBeGreaterThan(-1);

    // Video filters: fade-in + fade-out
    const vf = args[vfIdx + 1];
    expect(vf).toContain('fade=t=in:d=0.5');
    expect(vf).toContain('fade=t=out');

    // Audio filters: afade-in + afade-out
    const af = args[afIdx + 1];
    expect(af).toContain('afade=t=in:d=0.5');
    expect(af).toContain('afade=t=out');
  });

  it('adds title card drawtext filter when titleCard is set', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'title-test',
      titleCard: 'My Project Title',
    });

    const args = lastSpawnArgs();
    const vfIdx = args.indexOf('-vf');
    expect(vfIdx).toBeGreaterThan(-1);
    const vf = args[vfIdx + 1];
    expect(vf).toContain('drawtext=');
    expect(vf).toContain('My Project Title');
    expect(vf).toContain('fontcolor=0xFFFFFF');
    expect(vf).toContain('fontsize=48');
    expect(vf).toContain('alpha=');
  });

  it('escapes special characters in title card text', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'escape-test',
      titleCard: "Title: It's a Test",
    });

    const args = lastSpawnArgs();
    const vfIdx = args.indexOf('-vf');
    expect(vfIdx).toBeGreaterThan(-1);
    const vf = args[vfIdx + 1];
    expect(vf).toContain('drawtext=');
    // Colon should be escaped
    expect(vf).toContain('\\:');
  });

  it('uses two-pass encoding when twoPass=true and no fade/title filters', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'twopass-test',
      twoPass: true,
    });

    const calls = allSpawnArgs();
    // Find the pass 1 and pass 2 calls
    const pass1 = calls.find(a => a.includes('-pass') && a.includes('1') && a.includes('/dev/null'));
    const pass2 = calls.find(a => a.includes('-pass') && a.includes('2') && !a.includes('/dev/null'));

    expect(pass1).toBeDefined();
    expect(pass2).toBeDefined();

    // Pass 1 should include -an (no audio) and -f null
    expect(pass1).toEqual(expect.arrayContaining(['-an', '-f', 'null']));
    // Pass 2 should include -movflags +faststart
    expect(pass2).toEqual(expect.arrayContaining(['-movflags', '+faststart']));
  });

  it('falls back to single-pass CRF when twoPass=true but fade filters are active', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'twopass-fade-test',
      twoPass: true,
      fadeInDuration: 0.5,
    });

    const calls = allSpawnArgs();
    // Should NOT have pass 1/pass 2
    const pass1 = calls.find(a => a.includes('-pass') && a.includes('1') && a.includes('/dev/null'));
    expect(pass1).toBeUndefined();

    // Final call should use -crf (single-pass)
    const args = lastSpawnArgs();
    expect(args).toEqual(expect.arrayContaining(['-crf']));
    expect(args).toEqual(expect.arrayContaining(['-vf']));
  });

  it('uses stream-copy when no filters and no two-pass requested', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'copy-test',
    });

    const args = lastSpawnArgs();
    expect(args).toEqual(expect.arrayContaining(['-c', 'copy']));
    expect(args).toEqual(expect.arrayContaining(['-movflags', '+faststart']));
  });

  it('burns subtitles with enhanced styling (Arial, shadow, backdrop)', async () => {
    await assembleVideo(baseScenes(), {
      assetsDir,
      outputDir,
      projectTitle: 'subtitle-style-test',
    });

    // The subtitle burn step is NOT the last call — find the call that includes subtitles=
    const calls = allSpawnArgs();
    const subCall = calls.find(a => a.some(arg => arg.includes('subtitles=')));
    expect(subCall).toBeDefined();

    const vfArg = subCall!.find(arg => arg.includes('subtitles='));
    expect(vfArg).toBeDefined();
    expect(vfArg).toContain('Fontname=Arial');
    expect(vfArg).toContain('FontSize=20');
    expect(vfArg).toContain('Shadow=1');
    expect(vfArg).toContain('BackColour=&H00000000&');
    expect(vfArg).toContain('Outline=2');
    expect(vfArg).toContain('MarginV=35');
  });
});

/* ---- hexToAssColor ---- */

describe('hexToAssColor', () => {
  it('converts standard hex #RRGGBB to &HBBGGRR&', () => {
    expect(hexToAssColor('#FF0000')).toBe('&H0000FF&');
    expect(hexToAssColor('#00FF00')).toBe('&H00FF00&');
    expect(hexToAssColor('#0000FF')).toBe('&HFF0000&');
  });

  it('handles white and black', () => {
    expect(hexToAssColor('#FFFFFF')).toBe('&HFFFFFF&');
    expect(hexToAssColor('#000000')).toBe('&H000000&');
  });

  it('handles lowercase hex', () => {
    expect(hexToAssColor('#aabbcc')).toBe('&HCCBBAA&');
  });

  it('handles missing # prefix', () => {
    expect(hexToAssColor('FF8800')).toBe('&H0088FF&');
  });

  it('returns white fallback for invalid length', () => {
    expect(hexToAssColor('#FFF')).toBe('&HFFFFFF&');
    expect(hexToAssColor('')).toBe('&HFFFFFF&');
    expect(hexToAssColor('#12345')).toBe('&HFFFFFF&');
  });
});

/* ---- buildSubtitleForceStyle ---- */

describe('buildSubtitleForceStyle', () => {
  it('builds force_style with all fields', () => {
    const style = {
      fontName: 'Arial',
      fontSize: 24,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      shadowEnabled: true,
      marginV: 35,
      backdropEnabled: false,
      backdropOpacity: 0,
    };
    const result = buildSubtitleForceStyle(style);
    expect(result).toContain('Fontname=Arial');
    expect(result).toContain('FontSize=24');
    expect(result).toContain('PrimaryColour=&HFFFFFF&');
    expect(result).toContain('OutlineColour=&H000000&');
    expect(result).toContain('Outline=2');
    expect(result).toContain('Shadow=1');
    expect(result).toContain('MarginV=35');
    expect(result).toContain('BackColour=&H00000000&');
    expect(result).not.toContain('BorderStyle=4');
  });

  it('enables backdrop with opacity', () => {
    const style = {
      fontName: 'Georgia',
      fontSize: 20,
      primaryColor: '#FFFDE7',
      outlineColor: '#1A1A1A',
      outlineWidth: 0,
      shadowEnabled: false,
      marginV: 50,
      backdropEnabled: true,
      backdropOpacity: 0.6,
    };
    const result = buildSubtitleForceStyle(style);
    expect(result).toContain('Shadow=0');
    expect(result).toContain('BorderStyle=4');
    // 0.6 opacity → alpha = (1-0.6)*255 = 102 = 0x66
    expect(result).toContain('BackColour=&H66000000&');
  });

  it('fully opaque backdrop (opacity=1)', () => {
    const style = {
      fontName: 'Arial',
      fontSize: 20,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 0,
      shadowEnabled: false,
      marginV: 35,
      backdropEnabled: true,
      backdropOpacity: 1,
    };
    const result = buildSubtitleForceStyle(style);
    // alpha = (1-1)*255 = 0 = 0x00
    expect(result).toContain('BackColour=&H00000000&');
    expect(result).toContain('BorderStyle=4');
  });

  it('fully transparent backdrop (opacity=0 with backdrop enabled) does not add BorderStyle', () => {
    const style = {
      fontName: 'Arial',
      fontSize: 20,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 0,
      shadowEnabled: false,
      marginV: 35,
      backdropEnabled: true,
      backdropOpacity: 0,
    };
    const result = buildSubtitleForceStyle(style);
    // backdropEnabled=true but opacity=0 → condition fails
    expect(result).not.toContain('BorderStyle=4');
  });
});
