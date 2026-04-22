/**
 * stageTopology.golden.test.ts — pin the resolved execution order of the
 * built-in stage registry. After B-1 every built-in stage carries an
 * `after:` declaration, so the topological sort — not import order —
 * decides what runs when. This test catches accidental drift from
 * either renaming a stage, dropping an `after:` clause, or shuffling
 * the registration order in a way that no longer produces the correct
 * canonical pipeline.
 *
 * If the order legitimately changes, update the EXPECTED_ORDER list
 * below in the same commit and review the diff carefully.
 */

import { describe, it, expect } from 'vitest';

import '../stages/defs/index.js';
import { getStageOrder } from '@ai-video/pipeline-core/stageRegistry.js';

const EXPECTED_ORDER = [
  'CAPABILITY_ASSESSMENT',
  'STYLE_EXTRACTION',
  'RESEARCH',
  'NARRATIVE_MAP',
  'SCRIPT_GENERATION',
  'QA_REVIEW',
  'TEMPORAL_PLANNING',
  'STORYBOARD',
  'VIDEO_IR_COMPILE',
  'REFERENCE_IMAGE',
  'KEYFRAME_GEN',
  'VIDEO_GEN',
  'TTS',
  'ASSEMBLY',
  'REFINEMENT',
];

describe('stageRegistry — built-in topology golden snapshot', () => {
  it('produces the canonical pipeline order purely from `after:` declarations', () => {
    const order = getStageOrder();
    expect(order).toEqual(EXPECTED_ORDER);
  });
});
