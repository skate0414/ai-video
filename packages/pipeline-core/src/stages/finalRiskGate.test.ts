/* ------------------------------------------------------------------ */
/*  Tests for runFinalRiskGate                                         */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi } from 'vitest';
import { runFinalRiskGate } from './finalRiskGate.js';
import { SafetyBlockError } from '../orchestrator.js';
import type { PipelineScene } from '../sharedTypes.js';

/* ---- Helpers ---- */

function makeScene(overrides: Partial<PipelineScene> = {}): PipelineScene {
  return {
    id: 's1',
    number: 1,
    narrative: 'This is a safe narrative sentence.',
    visualPrompt: 'A cinematic wide shot of a mountain at sunrise.',
    estimatedDuration: 5,
    assetUrl: 'https://example.com/video.mp4',
    assetType: 'video',
    audioUrl: 'https://example.com/audio.mp3',
    status: 'done',
    ...overrides,
  };
}

/** Extract log messages from a vi.fn() mock that received LogEntry-shaped objects. */
function logMessages(mockFn: ReturnType<typeof vi.fn>): string[] {
  return mockFn.mock.calls.map((c) => (c[0] as { message: string }).message);
}

/* ================================================================== */
/*  Happy-path: all checks pass                                        */
/* ================================================================== */

describe('runFinalRiskGate — happy path', () => {
  it('returns passed=true when all scenes are complete and text is safe', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene()],
      scriptText: 'The sun is a star.',
    });

    expect(result.passed).toBe(true);
    expect(result.checks.sceneCompleteness).toBe(true);
    expect(result.checks.placeholderDetection).toBe(true);
    expect(result.checks.narrativeSafety).toBe(true);
    expect(result.checks.missingAssets).toHaveLength(0);
    expect(result.checks.safetyIssues).toHaveLength(0);
  });

  it('handles multiple complete scenes', () => {
    const result = runFinalRiskGate({
      scenes: [
        makeScene({ id: 's1' }),
        makeScene({ id: 's2', assetType: 'image' }),
      ],
      scriptText: 'Water boils at 100°C.',
    });
    expect(result.passed).toBe(true);
    expect(result.checks.missingAssets).toHaveLength(0);
  });

  it('invokes onLog callback on success', () => {
    const onLog = vi.fn();
    runFinalRiskGate({
      scenes: [makeScene()],
      scriptText: 'Safe text.',
    }, onLog);
    expect(onLog).toHaveBeenCalled();
    const messages = logMessages(onLog);
    expect(messages.some(m => m.includes('all checks passed'))).toBe(true);
  });
});

/* ================================================================== */
/*  Scene completeness checks                                          */
/* ================================================================== */

describe('runFinalRiskGate — scene completeness', () => {
  it('detects missing assetUrl', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ assetUrl: undefined })],
      scriptText: 'Safe text.',
    });
    expect(result.passed).toBe(false);
    expect(result.checks.sceneCompleteness).toBe(false);
    expect(result.checks.missingAssets).toContain('s1');
  });

  it('detects empty assetUrl string', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ assetUrl: '' })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.sceneCompleteness).toBe(false);
    expect(result.checks.missingAssets).toContain('s1');
  });

  it('detects placeholder assetType', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ assetType: 'placeholder' })],
      scriptText: 'Safe text.',
    });
    expect(result.passed).toBe(false);
    expect(result.checks.sceneCompleteness).toBe(false);
    expect(result.checks.missingAssets).toContain('s1');
  });

  it('detects missing audioUrl', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ audioUrl: undefined })],
      scriptText: 'Safe text.',
    });
    expect(result.passed).toBe(false);
    expect(result.checks.sceneCompleteness).toBe(false);
    expect(result.checks.missingAssets).toContain('s1:audio');
  });

  it('collects both assetUrl and audioUrl as missing', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ assetUrl: undefined, audioUrl: undefined })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.missingAssets).toContain('s1');
    expect(result.checks.missingAssets).toContain('s1:audio');
  });

  it('reports missing assets across multiple scenes', () => {
    const result = runFinalRiskGate({
      scenes: [
        makeScene({ id: 's1', assetUrl: undefined }),
        makeScene({ id: 's2' }),
        makeScene({ id: 's3', audioUrl: undefined }),
      ],
      scriptText: 'Safe text.',
    });
    expect(result.checks.missingAssets).toContain('s1');
    expect(result.checks.missingAssets).toContain('s3:audio');
    expect(result.checks.missingAssets).not.toContain('s2');
  });
});

/* ================================================================== */
/*  Placeholder detection                                              */
/* ================================================================== */

describe('runFinalRiskGate — placeholder detection', () => {
  it('detects [TODO] in narrative', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ narrative: 'Scene text [TODO] more content.' })],
      scriptText: 'Safe text.',
    });
    expect(result.passed).toBe(false);
    expect(result.checks.placeholderDetection).toBe(false);
  });

  it('detects [INSERT] in visualPrompt', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ visualPrompt: 'Wide shot with [INSERT] subject here.' })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.placeholderDetection).toBe(false);
  });

  it('detects [PLACEHOLDER] (case-insensitive)', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ narrative: 'This is a [placeholder] text.' })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.placeholderDetection).toBe(false);
  });

  it('detects PLACEHOLDER word in narrative', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ narrative: 'PLACEHOLDER content here.' })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.placeholderDetection).toBe(false);
  });

  it('detects lorem ipsum', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ narrative: 'lorem ipsum dolor sit amet.' })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.placeholderDetection).toBe(false);
  });

  it('detects TBD in narrative', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ narrative: 'This scene is TBD.' })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.placeholderDetection).toBe(false);
  });

  it('does not flag clean narrative/visualPrompt', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({
        narrative: 'The sun rises over the mountains.',
        visualPrompt: 'Golden hour cinematic shot of mountain peaks.',
      })],
      scriptText: 'Safe text.',
    });
    expect(result.checks.placeholderDetection).toBe(true);
  });
});

/* ================================================================== */
/*  Narrative safety checks                                            */
/* ================================================================== */

describe('runFinalRiskGate — narrative safety', () => {
  it('throws SafetyBlockError when suicide keyword detected', () => {
    expect(() =>
      runFinalRiskGate({
        scenes: [makeScene()],
        scriptText: 'This script mentions 自杀 prevention.',
      })
    ).toThrow(SafetyBlockError);
  });

  it('throws SafetyBlockError when medical claim detected', () => {
    expect(() =>
      runFinalRiskGate({
        scenes: [makeScene()],
        scriptText: '这个产品可以治愈癌症。',
      })
    ).toThrow(SafetyBlockError);
  });

  it('includes safety issue labels in thrown error message', () => {
    expect(() =>
      runFinalRiskGate({
        scenes: [makeScene()],
        scriptText: '这个产品可以治愈癌症。',
      })
    ).toThrow(/medical_claim/);
  });

  it('sets narrativeSafety=false when safety check fails', () => {
    let result: ReturnType<typeof runFinalRiskGate> | undefined;
    try {
      result = runFinalRiskGate({
        scenes: [makeScene()],
        scriptText: 'He mentioned 自杀.',
      });
    } catch (err) {
      if (err instanceof SafetyBlockError) {
        // Expected — verify the error message hints at the issue
        expect(err.message).toContain('narrative safety failed');
        return;
      }
      throw err;
    }
    // Should not reach here
    expect(result?.checks.narrativeSafety).toBe(false);
  });

  it('skips safety check when safetyPreCleared=true', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene()],
      scriptText: '他提到了自杀这个话题。',
      safetyPreCleared: true,
    });
    expect(result.checks.narrativeSafety).toBe(true);
    expect(result.checks.safetyIssues).toHaveLength(0);
    // Other checks still pass
    expect(result.passed).toBe(true);
  });
});

/* ================================================================== */
/*  Failure log emission                                               */
/* ================================================================== */

describe('runFinalRiskGate — failure logging', () => {
  it('emits a warning log when completeness check fails', () => {
    const onLog = vi.fn();
    runFinalRiskGate({
      scenes: [makeScene({ assetUrl: undefined })],
      scriptText: 'Safe text.',
    }, onLog);
    const messages = logMessages(onLog);
    expect(messages.some(m => m.includes('FAILED'))).toBe(true);
    expect(messages.some(m => m.includes('missing assets'))).toBe(true);
  });

  it('emits a warning log when placeholder detected', () => {
    const onLog = vi.fn();
    runFinalRiskGate({
      scenes: [makeScene({ narrative: '[TODO] fill this in.' })],
      scriptText: 'Safe text.',
    }, onLog);
    const messages = logMessages(onLog);
    expect(messages.some(m => m.includes('placeholder content detected'))).toBe(true);
  });
});

/* ================================================================== */
/*  Edge cases                                                         */
/* ================================================================== */

describe('runFinalRiskGate — edge cases', () => {
  it('handles empty scenes array (no assets missing, no placeholders)', () => {
    const result = runFinalRiskGate({
      scenes: [],
      scriptText: 'Safe text.',
    });
    expect(result.checks.sceneCompleteness).toBe(true);
    expect(result.checks.placeholderDetection).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('works without an onLog callback', () => {
    expect(() =>
      runFinalRiskGate({
        scenes: [makeScene()],
        scriptText: 'Safe text.',
      })
    ).not.toThrow();
  });

  it('returns passed=false when multiple checks fail', () => {
    const result = runFinalRiskGate({
      scenes: [makeScene({ assetUrl: undefined, narrative: '[TODO] fix this.' })],
      scriptText: 'Safe text.',
    });
    expect(result.passed).toBe(false);
    expect(result.checks.sceneCompleteness).toBe(false);
    expect(result.checks.placeholderDetection).toBe(false);
  });
});
