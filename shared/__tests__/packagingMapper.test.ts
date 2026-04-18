/* ------------------------------------------------------------------ */
/*  Tests: packagingStyleToRefineOptions mapper                       */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  packagingStyleToRefineOptions,
  SUBTITLE_PRESETS,
  type PackagingTrack,
} from '../types.js';

function makePkg(overrides: Partial<PackagingTrack> = {}): PackagingTrack {
  return {
    subtitlePosition: 'bottom',
    subtitleHasShadow: true,
    subtitleHasBackdrop: false,
    subtitleFontSize: 'medium',
    subtitlePrimaryColor: '#FFFFFF',
    subtitleOutlineColor: '#000000',
    subtitleFontCategory: 'sans-serif',
    transitionDominantStyle: 'cut',
    transitionEstimatedDurationSec: 0.5,
    hasIntroCard: false,
    introCardDurationSec: 0,
    hasFadeIn: false,
    fadeInDurationSec: 0,
    hasOutroCard: false,
    outroCardDurationSec: 0,
    hasFadeOut: false,
    fadeOutDurationSec: 0,
    ...overrides,
  };
}

const FULL_CONFIDENCE: Record<string, string> = {
  subtitle_primary_color: 'confident',
  subtitle_outline_color: 'confident',
  subtitle_font_size: 'confident',
  transition_estimated_duration_sec: 'confident',
};

describe('packagingStyleToRefineOptions', () => {
  it('returns empty for undefined pkg', () => {
    const { options, provenance } = packagingStyleToRefineOptions(undefined, undefined);
    expect(options).toEqual({});
    expect(provenance.size).toBe(0);
  });

  it('maps sans-serif font category to classic_white preset', () => {
    const { options } = packagingStyleToRefineOptions(
      makePkg({ subtitleFontCategory: 'sans-serif' }),
      FULL_CONFIDENCE,
    );
    expect(options.subtitlePreset).toBe('classic_white');
  });

  it('maps serif font category to cinematic preset', () => {
    // cinematic preset: primaryColor=#FFFDE7, outlineColor=#1A1A1A, fontSize=22 (large→24 is close but medium→20 differs)
    // Use 'no subtitle_font_size confidence' so fontSize override is skipped, keeping preset's 22.
    const noFontSizeConfidence = { ...FULL_CONFIDENCE };
    delete noFontSizeConfidence.subtitle_font_size;
    const { options } = packagingStyleToRefineOptions(
      makePkg({ subtitleFontCategory: 'serif', subtitlePrimaryColor: '#FFFDE7', subtitleOutlineColor: '#1A1A1A' }),
      noFontSizeConfidence,
    );
    expect(options.subtitlePreset).toBe('cinematic');
  });

  it('maps backdrop to backdrop_black preset', () => {
    const { options } = packagingStyleToRefineOptions(
      makePkg({ subtitleHasBackdrop: true }),
      FULL_CONFIDENCE,
    );
    expect(options.subtitlePreset).toBe('backdrop_black');
    expect(options.subtitleStyle!.backdropEnabled).toBe(true);
  });

  it('switches to custom preset when colors differ from base preset', () => {
    const { options } = packagingStyleToRefineOptions(
      makePkg({ subtitlePrimaryColor: '#FF0000' }),
      FULL_CONFIDENCE,
    );
    // classic_white preset has #FFFFFF as primary; #FF0000 differs → custom
    expect(options.subtitlePreset).toBe('custom');
  });

  it('maps transition duration', () => {
    const { options, provenance } = packagingStyleToRefineOptions(
      makePkg({ transitionEstimatedDurationSec: 1.5 }),
      FULL_CONFIDENCE,
    );
    expect(options.transitionDuration).toBe(1.5);
    expect(provenance.has('transitionDuration')).toBe(true);
  });

  it('does not map zero transition duration', () => {
    const { options, provenance } = packagingStyleToRefineOptions(
      makePkg({ transitionEstimatedDurationSec: 0 }),
      FULL_CONFIDENCE,
    );
    expect(options.transitionDuration).toBeUndefined();
    expect(provenance.has('transitionDuration')).toBe(false);
  });

  it('maps fade in/out', () => {
    const { options, provenance } = packagingStyleToRefineOptions(
      makePkg({ hasFadeIn: true, fadeInDurationSec: 0.5, hasFadeOut: true, fadeOutDurationSec: 1.0 }),
      FULL_CONFIDENCE,
    );
    expect(options.fadeInDuration).toBe(0.5);
    expect(options.fadeOutDuration).toBe(1.0);
    expect(provenance.has('fadeInDuration')).toBe(true);
    expect(provenance.has('fadeOutDuration')).toBe(true);
  });

  it('maps intro card to titleCard', () => {
    const { options, provenance } = packagingStyleToRefineOptions(
      makePkg({ hasIntroCard: true, introCardDurationSec: 3 }),
      FULL_CONFIDENCE,
    );
    expect(options.titleCard).toBeDefined();
    expect(options.titleCard!.duration).toBe(3);
    expect(provenance.has('titleCard')).toBe(true);
  });

  it('does not create titleCard when hasIntroCard is false', () => {
    const { options } = packagingStyleToRefineOptions(
      makePkg({ hasIntroCard: false }),
      FULL_CONFIDENCE,
    );
    expect(options.titleCard).toBeUndefined();
  });

  it('maps bgmRelativeVolume to bgmVolume', () => {
    const { options, provenance } = packagingStyleToRefineOptions(
      makePkg(),
      FULL_CONFIDENCE,
      0.3,
    );
    expect(options.bgmVolume).toBe(0.3);
    expect(provenance.has('bgmVolume')).toBe(true);
  });

  it('does not map bgmVolume when bgmRelativeVolume is 0', () => {
    const { options, provenance } = packagingStyleToRefineOptions(
      makePkg(),
      FULL_CONFIDENCE,
      0,
    );
    expect(options.bgmVolume).toBeUndefined();
    expect(provenance.has('bgmVolume')).toBe(false);
  });

  it('records provenance for subtitle fields', () => {
    const { provenance } = packagingStyleToRefineOptions(
      makePkg(),
      FULL_CONFIDENCE,
    );
    expect(provenance.has('subtitlePreset')).toBe(true);
    expect(provenance.has('subtitleStyle')).toBe(true);
  });

  it('maps large font size to 24', () => {
    const { options } = packagingStyleToRefineOptions(
      makePkg({ subtitleFontSize: 'large' }),
      { ...FULL_CONFIDENCE, subtitle_font_size: 'confident' },
    );
    expect(options.subtitleStyle!.fontSize).toBe(24);
  });
});
