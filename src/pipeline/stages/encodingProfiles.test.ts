import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveEncodingProfile, getQualityTier, buildEncodingArgs, type QualityTier } from './encodingProfiles.js';

describe('resolveEncodingProfile', () => {
  it('returns balanced profile by default', () => {
    const profile = resolveEncodingProfile(undefined, 1920, 1080, 30);
    expect(profile.crf).toBe(20);
    expect(profile.preset).toBe('medium');
    expect(profile.audioBitrate).toBe('192k');
    expect(profile.twoPass).toBe(false);
  });

  it('returns draft profile with higher CRF', () => {
    const profile = resolveEncodingProfile('draft', 1920, 1080, 30);
    expect(profile.crf).toBe(28);
    expect(profile.preset).toBe('fast');
    expect(profile.audioBitrate).toBe('128k');
    expect(profile.twoPass).toBe(false);
  });

  it('returns premium profile with lower CRF and 2-pass', () => {
    const profile = resolveEncodingProfile('premium', 1920, 1080, 30);
    expect(profile.crf).toBe(16);
    expect(profile.preset).toBe('slow');
    expect(profile.audioBitrate).toBe('256k');
    expect(profile.twoPass).toBe(true);
    expect(profile.maxrate).toBe('8M');
    expect(profile.bufsize).toBe('16M');
  });

  it('uses provided resolution and fps', () => {
    const profile = resolveEncodingProfile('balanced', 1080, 1920, 60);
    expect(profile.width).toBe(1080);
    expect(profile.height).toBe(1920);
    expect(profile.fps).toBe(60);
  });

  it('all tiers use libx264', () => {
    const tiers: QualityTier[] = ['draft', 'balanced', 'premium'];
    for (const tier of tiers) {
      expect(resolveEncodingProfile(tier, 1920, 1080, 30).videoCodec).toBe('libx264');
    }
  });

  it('draft has lower audio sample rate', () => {
    expect(resolveEncodingProfile('draft', 1920, 1080, 30).audioSampleRate).toBe(44100);
  });

  it('premium has standard audio sample rate', () => {
    expect(resolveEncodingProfile('premium', 1920, 1080, 30).audioSampleRate).toBe(48000);
  });
});

describe('getQualityTier', () => {
  const originalEnv = process.env.QUALITY_TIER;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.QUALITY_TIER;
    } else {
      process.env.QUALITY_TIER = originalEnv;
    }
  });

  it('returns "balanced" when no env var set', () => {
    delete process.env.QUALITY_TIER;
    expect(getQualityTier()).toBe('balanced');
  });

  it('returns "draft" when env is "draft"', () => {
    process.env.QUALITY_TIER = 'draft';
    expect(getQualityTier()).toBe('draft');
  });

  it('returns "premium" when env is "premium"', () => {
    process.env.QUALITY_TIER = 'premium';
    expect(getQualityTier()).toBe('premium');
  });

  it('returns "balanced" for invalid env value', () => {
    process.env.QUALITY_TIER = 'ultra';
    expect(getQualityTier()).toBe('balanced');
  });

  it('is case-insensitive', () => {
    process.env.QUALITY_TIER = 'DRAFT';
    expect(getQualityTier()).toBe('draft');
  });
});

describe('buildEncodingArgs', () => {
  it('includes -preset for balanced', () => {
    const profile = resolveEncodingProfile('balanced', 1920, 1080, 30);
    const args = buildEncodingArgs(profile);
    expect(args).toContain('-preset');
    expect(args).toContain('medium');
  });

  it('includes -maxrate and -bufsize for premium', () => {
    const profile = resolveEncodingProfile('premium', 1920, 1080, 30);
    const args = buildEncodingArgs(profile);
    expect(args).toContain('-maxrate');
    expect(args).toContain('8M');
    expect(args).toContain('-bufsize');
    expect(args).toContain('16M');
  });

  it('does not include -maxrate for draft', () => {
    const profile = resolveEncodingProfile('draft', 1920, 1080, 30);
    const args = buildEncodingArgs(profile);
    expect(args).not.toContain('-maxrate');
  });
});
