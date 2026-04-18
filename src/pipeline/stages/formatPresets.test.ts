import { describe, expect, it } from 'vitest';
import { resolveFormatPreset, getFormatName, FORMAT_PRESETS } from './formatPresets.js';

describe('FORMAT_PRESETS', () => {
  it('has 16:9 preset at 1920x1080', () => {
    expect(FORMAT_PRESETS['16:9'].width).toBe(1920);
    expect(FORMAT_PRESETS['16:9'].height).toBe(1080);
  });

  it('has 9:16 preset at 1080x1920', () => {
    expect(FORMAT_PRESETS['9:16'].width).toBe(1080);
    expect(FORMAT_PRESETS['9:16'].height).toBe(1920);
  });

  it('has 1:1 preset at 1080x1080', () => {
    expect(FORMAT_PRESETS['1:1'].width).toBe(1080);
    expect(FORMAT_PRESETS['1:1'].height).toBe(1080);
  });

  it('has 4:3 preset at 1440x1080', () => {
    expect(FORMAT_PRESETS['4:3'].width).toBe(1440);
    expect(FORMAT_PRESETS['4:3'].height).toBe(1080);
  });

  it('has 21:9 preset at 2560x1080', () => {
    expect(FORMAT_PRESETS['21:9'].width).toBe(2560);
    expect(FORMAT_PRESETS['21:9'].height).toBe(1080);
  });

  it('all presets have normFilter containing scale and pad', () => {
    for (const [name, preset] of Object.entries(FORMAT_PRESETS)) {
      expect(preset.normFilter).toContain('scale=');
      expect(preset.normFilter).toContain('pad=');
      expect(preset.normFilter).toContain('setsar=1');
    }
  });
});

describe('resolveFormatPreset', () => {
  it('resolves 1920x1080 to 16:9', () => {
    const preset = resolveFormatPreset(1920, 1080);
    expect(preset.aspect).toBe('16:9');
    expect(preset.width).toBe(1920);
  });

  it('resolves 1080x1920 to 9:16', () => {
    const preset = resolveFormatPreset(1080, 1920);
    expect(preset.aspect).toBe('9:16');
    expect(preset.width).toBe(1080);
  });

  it('resolves 1080x1080 to 1:1', () => {
    const preset = resolveFormatPreset(1080, 1080);
    expect(preset.aspect).toBe('1:1');
  });

  it('resolves 1440x1080 to 4:3', () => {
    const preset = resolveFormatPreset(1440, 1080);
    expect(preset.aspect).toBe('4:3');
  });

  it('resolves 2560x1080 to 21:9', () => {
    const preset = resolveFormatPreset(2560, 1080);
    expect(preset.aspect).toBe('21:9');
  });

  it('creates custom preset for non-standard resolutions', () => {
    const preset = resolveFormatPreset(300, 200);
    expect(preset.label).toContain('Custom');
    expect(preset.width).toBe(300);
    expect(preset.height).toBe(200);
  });

  it('custom preset has valid normFilter', () => {
    const preset = resolveFormatPreset(300, 200);
    expect(preset.normFilter).toContain('scale=300:200');
    expect(preset.normFilter).toContain('pad=300:200');
  });

  it('tolerates close aspect ratios (e.g. 1280x720 ≈ 16:9)', () => {
    const preset = resolveFormatPreset(1280, 720);
    expect(preset.aspect).toBe('16:9');
  });
});

describe('getFormatName', () => {
  it('returns "16:9" for 1920x1080', () => {
    expect(getFormatName(1920, 1080)).toBe('16:9');
  });

  it('returns "9:16" for 1080x1920', () => {
    expect(getFormatName(1080, 1920)).toBe('9:16');
  });

  it('returns "1:1" for 1080x1080', () => {
    expect(getFormatName(1080, 1080)).toBe('1:1');
  });

  it('returns undefined for non-standard resolution', () => {
    expect(getFormatName(300, 200)).toBeUndefined();
  });
});
