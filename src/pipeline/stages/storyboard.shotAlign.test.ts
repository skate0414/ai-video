/* ------------------------------------------------------------------ */
/*  Tests: buildShotAlignedScenes – shot→scene proportional mapping   */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { buildShotAlignedScenes } from './storyboard.js';
import type { ScriptCIR, ShotBoundary, ShotCIR } from '../../cir/types.js';

/* ---- Helpers ---- */

function makeSentence(index: number, text: string) {
  return {
    index,
    text,
    beatIndex: 0,
    factReferences: [] as string[],
    estimatedDurationSec: 3,
  };
}

function makeScript(sentenceTexts: string[]): ScriptCIR {
  const sentences = sentenceTexts.map((t, i) => makeSentence(i, t));
  return {
    _cir: 'Script',
    version: 1,
    fullText: sentenceTexts.join(''),
    sentences,
    totalWordCount: 100,
    totalDurationSec: sentenceTexts.length * 3,
    usedFactIDs: [],
    safety: { isHighRisk: false, categories: [], needsManualReview: false },
    styleConsistencyScore: 90,
    calibration: {
      targetWordCount: 100,
      targetWordCountMin: 80,
      targetWordCountMax: 120,
      targetDurationSec: sentenceTexts.length * 3,
      speechRate: 'medium',
    },
  };
}

function makeShot(index: number, startSec: number, endSec: number): ShotBoundary {
  return {
    index,
    startSec,
    endSec,
    durationSec: endSec - startSec,
    keyframePath: `/tmp/shot_${index}.jpg`,
    cameraMotion: 'pan',
    transitionToNext: index === 0 ? 'dissolve' : 'cut',
    dominantColors: ['#FF0000'],
    subjectDescription: `Subject ${index}`,
  };
}

function makeShotCIR(shots: ShotBoundary[], videoDurationSec: number): ShotCIR {
  const totalDuration = shots.reduce((s, sh) => s + sh.durationSec, 0) || 1;
  return {
    _cir: 'ShotAnalysis',
    version: 1,
    shots,
    totalShots: shots.length,
    avgShotDurationSec: totalDuration / (shots.length || 1),
    rhythmSignature: shots.map(s => s.durationSec / totalDuration),
    videoDurationSec,
  };
}

describe('buildShotAlignedScenes', () => {
  it('creates one scene per shot when sentences >= shots', () => {
    const script = makeScript(['Sentence A.', 'Sentence B.', 'Sentence C.', 'Sentence D.']);
    const shots = [
      makeShot(0, 0, 5),
      makeShot(1, 5, 10),
    ];
    const shotCIR = makeShotCIR(shots, 10);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    expect(scenes.length).toBe(2);
    // All sentences distributed across the two scenes
    const allNarrative = scenes.map(s => s.narrative).join('');
    for (const text of ['Sentence A.', 'Sentence B.', 'Sentence C.', 'Sentence D.']) {
      expect(allNarrative).toContain(text);
    }
  });

  it('each scene has at least 1 sentence', () => {
    const script = makeScript(['A.', 'B.', 'C.']);
    const shots = [
      makeShot(0, 0, 3),
      makeShot(1, 3, 6),
      makeShot(2, 6, 9),
    ];
    const shotCIR = makeShotCIR(shots, 9);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    for (const scene of scenes) {
      expect(scene.narrative.length).toBeGreaterThan(0);
    }
  });

  it('merges empty shots when more shots than sentences', () => {
    const script = makeScript(['Only one sentence.']);
    const shots = [
      makeShot(0, 0, 2),
      makeShot(1, 2, 4),
      makeShot(2, 4, 6),
    ];
    const shotCIR = makeShotCIR(shots, 6);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    // Empty shots are filtered, so we get ≤ sentences.length scenes
    expect(scenes.length).toBeLessThanOrEqual(1);
    expect(scenes[0].narrative).toContain('Only one sentence.');
  });

  it('uses shot duration as estimatedDuration', () => {
    const script = makeScript(['A.', 'B.']);
    const shots = [
      makeShot(0, 0, 4),
      makeShot(1, 4, 10),
    ];
    const shotCIR = makeShotCIR(shots, 10);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    expect(scenes[0].estimatedDuration).toBe(4);
    expect(scenes[1].estimatedDuration).toBe(6);
  });

  it('incorporates shot camera motion into productionSpecs', () => {
    const script = makeScript(['A.']);
    const shots = [makeShot(0, 0, 5)];
    shots[0] = { ...shots[0], cameraMotion: 'tracking' };
    const shotCIR = makeShotCIR(shots, 5);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    expect(scenes[0].productionSpecs.camera).toBe('tracking');
  });

  it('includes dominant colors in production notes', () => {
    const script = makeScript(['A.']);
    const shots = [{ ...makeShot(0, 0, 5), dominantColors: ['#00FF00', '#0000FF'] }];
    const shotCIR = makeShotCIR(shots, 5);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    expect(scenes[0].productionSpecs.notes).toContain('#00FF00');
    expect(scenes[0].productionSpecs.notes).toContain('#0000FF');
  });

  it('falls back to buildSceneStructure when shots array is empty', () => {
    const script = makeScript(['A.', 'B.']);
    const shotCIR = makeShotCIR([], 10);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    // Should still produce scenes (via fallback)
    expect(scenes.length).toBeGreaterThan(0);
  });

  it('assigns sequential scene IDs starting at 1', () => {
    const script = makeScript(['A.', 'B.', 'C.']);
    const shots = [makeShot(0, 0, 3), makeShot(1, 3, 6), makeShot(2, 6, 9)];
    const shotCIR = makeShotCIR(shots, 9);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    scenes.forEach((scene, i) => {
      expect(scene.id).toBe(`scene_${i + 1}`);
      expect(scene.number).toBe(i + 1);
    });
  });

  it('proportionally distributes sentences for unequal shot durations', () => {
    // Shot 0: 8s (80%), Shot 1: 2s (20%) → with 5 sentences,
    // shot 0 should get ~4 sentences, shot 1 ~1
    const script = makeScript(['A.', 'B.', 'C.', 'D.', 'E.']);
    const shots = [
      makeShot(0, 0, 8),
      makeShot(1, 8, 10),
    ];
    const shotCIR = makeShotCIR(shots, 10);

    const scenes = buildShotAlignedScenes(script, shotCIR, 3);
    expect(scenes.length).toBe(2);
    // The longer shot should have more narrative content
    expect(scenes[0].narrative.length).toBeGreaterThan(scenes[1].narrative.length);
  });
});
