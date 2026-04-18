import { describe, expect, it } from 'vitest';
import { resolveSFXLayer, buildSFXPlan, buildSFXMixArgs, type SFXLayer } from './sfxDesign.js';

describe('resolveSFXLayer', () => {
  it('returns ambient_drone for "ambient" hint', () => {
    const sfx = resolveSFXLayer('ambient sounds', 10);
    expect(sfx).toBeDefined();
    expect(sfx!.label).toBe('ambient_drone');
    expect(sfx!.lavfiSource).toContain('anoisesrc');
    expect(sfx!.lavfiSource).toContain('brown');
    expect(sfx!.lavfiSource).toContain('d=10');
  });

  it('returns ambient_drone for "atmosphere" hint', () => {
    const sfx = resolveSFXLayer('dark atmosphere', 5);
    expect(sfx).toBeDefined();
    expect(sfx!.label).toBe('ambient_drone');
  });

  it('returns rising_tension for "tension" hint', () => {
    const sfx = resolveSFXLayer('rising tension', 8);
    expect(sfx).toBeDefined();
    expect(sfx!.label).toBe('rising_tension');
    expect(sfx!.lavfiSource).toContain('sine=f=80');
  });

  it('returns rising_tension for "suspense" hint', () => {
    const sfx = resolveSFXLayer('suspense builds', 6);
    expect(sfx!.label).toBe('rising_tension');
  });

  it('returns impact_hit for "impact" hint', () => {
    const sfx = resolveSFXLayer('heavy impact', 3);
    expect(sfx).toBeDefined();
    expect(sfx!.label).toBe('impact_hit');
    expect(sfx!.lavfiSource).toContain('sine=f=40');
  });

  it('returns calm_ambient for "calm" hint', () => {
    const sfx = resolveSFXLayer('calm and peaceful', 10);
    expect(sfx).toBeDefined();
    expect(sfx!.label).toBe('calm_ambient');
    expect(sfx!.lavfiSource).toContain('pink');
  });

  it('returns calm_ambient for "gentle" hint', () => {
    const sfx = resolveSFXLayer('gentle background', 5);
    expect(sfx!.label).toBe('calm_ambient');
  });

  it('returns nature_wind for "nature" hint', () => {
    const sfx = resolveSFXLayer('nature sounds', 10);
    expect(sfx).toBeDefined();
    expect(sfx!.label).toBe('nature_wind');
    expect(sfx!.lavfiSource).toContain('pink');
  });

  it('returns nature_wind for "wind" hint', () => {
    const sfx = resolveSFXLayer('wind through trees', 7);
    expect(sfx!.label).toBe('nature_wind');
  });

  it('returns urban_ambient for "urban" hint', () => {
    const sfx = resolveSFXLayer('urban traffic', 10);
    expect(sfx).toBeDefined();
    expect(sfx!.label).toBe('urban_ambient');
    expect(sfx!.lavfiSource).toContain('brown');
  });

  it('returns urban_ambient for "city" hint', () => {
    const sfx = resolveSFXLayer('busy city street', 8);
    expect(sfx!.label).toBe('urban_ambient');
  });

  it('returns undefined for "silence" hint', () => {
    expect(resolveSFXLayer('silence', 10)).toBeUndefined();
  });

  it('returns undefined for "none" hint', () => {
    expect(resolveSFXLayer('none', 10)).toBeUndefined();
  });

  it('returns undefined for undefined hint', () => {
    expect(resolveSFXLayer(undefined, 10)).toBeUndefined();
  });

  it('returns undefined for unrecognized hint', () => {
    expect(resolveSFXLayer('xyzzy random', 10)).toBeUndefined();
  });

  it('uses ceiled duration in lavfi source', () => {
    const sfx = resolveSFXLayer('ambient', 4.3);
    expect(sfx!.lavfiSource).toContain('d=5');
  });

  it('sets appropriate volume levels', () => {
    const ambient = resolveSFXLayer('ambient', 10);
    const impact = resolveSFXLayer('impact', 10);
    const calm = resolveSFXLayer('calm', 10);
    // Impact should be louder than calm
    expect(impact!.volume).toBeGreaterThan(calm!.volume);
    // Ambient should be moderate
    expect(ambient!.volume).toBeGreaterThan(0);
    expect(ambient!.volume).toBeLessThan(1);
  });
});

describe('buildSFXPlan', () => {
  it('returns array of same length as scenes', () => {
    const scenes = [
      { production: { sound: 'ambient' }, audioDuration: 5 },
      { production: { sound: undefined }, audioDuration: 5 },
      { production: { sound: 'tension' }, audioDuration: 8 },
    ];
    const plan = buildSFXPlan(scenes);
    expect(plan).toHaveLength(3);
  });

  it('returns undefined for scenes with no sound hint', () => {
    const plan = buildSFXPlan([{ production: { sound: undefined }, audioDuration: 5 }]);
    expect(plan[0]).toBeUndefined();
  });

  it('returns SFXLayer for scenes with recognized sound hint', () => {
    const plan = buildSFXPlan([{ production: { sound: 'ambient' }, audioDuration: 10 }]);
    expect(plan[0]).toBeDefined();
    expect(plan[0]!.label).toBe('ambient_drone');
  });

  it('uses estimatedDuration as fallback', () => {
    const plan = buildSFXPlan([{ production: { sound: 'ambient' }, estimatedDuration: 7 }]);
    expect(plan[0]!.lavfiSource).toContain('d=7');
  });

  it('defaults to 5s if no duration', () => {
    const plan = buildSFXPlan([{ production: { sound: 'ambient' } }]);
    expect(plan[0]!.lavfiSource).toContain('d=5');
  });
});

describe('buildSFXMixArgs', () => {
  it('returns inputs and filterComplex', () => {
    const sfx: SFXLayer = {
      label: 'test',
      lavfiSource: 'anoisesrc=d=5:c=brown:a=0.01',
      volume: 0.05,
    };
    const result = buildSFXMixArgs(sfx, 5);
    expect(result.inputs).toContain('-f');
    expect(result.inputs).toContain('lavfi');
    expect(result.inputs).toContain(sfx.lavfiSource);
    expect(result.filterComplex).toContain('volume=0.05');
    expect(result.filterComplex).toContain('amix');
  });

  it('uses amix with duration=first', () => {
    const sfx: SFXLayer = {
      label: 'test',
      lavfiSource: 'anoisesrc=d=5:c=pink:a=0.01',
      volume: 0.03,
    };
    const result = buildSFXMixArgs(sfx, 5);
    expect(result.filterComplex).toContain('duration=first');
  });
});
