import { describe, it, expect } from 'vitest';
import './index.js';
import { getStageOrder } from '@ai-video/pipeline-core/stageRegistry.js';

describe('stage defs index side-effect registration', () => {
  it('registers all expected stages in execution order', () => {
    const order = getStageOrder();
    expect(order).toContain('CAPABILITY_ASSESSMENT');
    expect(order).toContain('STYLE_EXTRACTION');
    expect(order).toContain('RESEARCH');
    expect(order).toContain('NARRATIVE_MAP');
    expect(order).toContain('SCRIPT_GENERATION');
    expect(order).toContain('QA_REVIEW');
    expect(order).toContain('TEMPORAL_PLANNING');
    expect(order).toContain('STORYBOARD');
    expect(order).toContain('VIDEO_IR_COMPILE');
    expect(order).toContain('REFERENCE_IMAGE');
    expect(order).toContain('KEYFRAME_GEN');
    expect(order).toContain('VIDEO_GEN');
    expect(order).toContain('TTS');
    expect(order).toContain('ASSEMBLY');
    expect(order).toContain('REFINEMENT');
  });
});
