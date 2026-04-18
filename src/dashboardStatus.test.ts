import { describe, it, expect } from 'vitest';
import { getDashboardStatus, getCardAction } from '../shared/dashboardStatus';
import type { PipelineProject, PipelineStage, ProcessStatus } from '../shared/types';

/* ---- helpers ---- */

const ALL_STAGES: PipelineStage[] = [
  'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH', 'NARRATIVE_MAP',
  'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING', 'STORYBOARD', 'VIDEO_IR_COMPILE',
  'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
];

function makeStageStatus(override: Partial<Record<PipelineStage, ProcessStatus>> = {}): Record<PipelineStage, ProcessStatus> {
  const base: Record<string, ProcessStatus> = {};
  for (const s of ALL_STAGES) base[s] = 'pending';
  return { ...base, ...override } as Record<PipelineStage, ProcessStatus>;
}

function makeProject(patch: Partial<PipelineProject> = {}): PipelineProject {
  return {
    id: 'proj-test',
    title: 'Test',
    topic: 'test topic',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    stageStatus: makeStageStatus(),
    logs: [],
    ...patch,
  };
}

/* ---- getDashboardStatus ---- */

describe('getDashboardStatus', () => {
  it('returns "error" when project.error is set', () => {
    const p = makeProject({ error: 'something failed' });
    expect(getDashboardStatus(p)).toBe('error');
  });

  it('returns "error" when any stage has error status', () => {
    const p = makeProject({
      stageStatus: makeStageStatus({ RESEARCH: 'error' }),
    });
    expect(getDashboardStatus(p)).toBe('error');
  });

  it('returns "completed" when all stages are completed', () => {
    const allCompleted: Partial<Record<PipelineStage, ProcessStatus>> = {};
    for (const s of ALL_STAGES) allCompleted[s] = 'completed';
    const p = makeProject({ stageStatus: makeStageStatus(allCompleted) });
    expect(getDashboardStatus(p)).toBe('completed');
  });

  it('returns "scriptReview" when paused at SCRIPT_GENERATION', () => {
    const p = makeProject({ isPaused: true, pausedAtStage: 'SCRIPT_GENERATION' });
    expect(getDashboardStatus(p)).toBe('scriptReview');
  });

  it('returns "scriptReview" when paused at QA_REVIEW', () => {
    const p = makeProject({ isPaused: true, pausedAtStage: 'QA_REVIEW' });
    expect(getDashboardStatus(p)).toBe('scriptReview');
  });

  it('returns "visualReview" when paused at STORYBOARD', () => {
    const p = makeProject({ isPaused: true, pausedAtStage: 'STORYBOARD' });
    expect(getDashboardStatus(p)).toBe('visualReview');
  });

  it('returns "visualReview" when paused at REFERENCE_IMAGE', () => {
    const p = makeProject({ isPaused: true, pausedAtStage: 'REFERENCE_IMAGE' });
    expect(getDashboardStatus(p)).toBe('visualReview');
  });

  it('returns "analysis" when QA_REVIEW is not yet completed', () => {
    const p = makeProject({
      stageStatus: makeStageStatus({ CAPABILITY_ASSESSMENT: 'completed', STYLE_EXTRACTION: 'processing' }),
    });
    expect(getDashboardStatus(p)).toBe('analysis');
  });

  it('returns "visualGenerating" when QA done but KEYFRAME_GEN not completed', () => {
    const p = makeProject({
      stageStatus: makeStageStatus({
        CAPABILITY_ASSESSMENT: 'completed',
        STYLE_EXTRACTION: 'completed',
        RESEARCH: 'completed',
        NARRATIVE_MAP: 'completed',
        SCRIPT_GENERATION: 'completed',
        QA_REVIEW: 'completed',
        TEMPORAL_PLANNING: 'completed',
        STORYBOARD: 'completed',
        REFERENCE_IMAGE: 'completed',
        KEYFRAME_GEN: 'processing',
      }),
    });
    expect(getDashboardStatus(p)).toBe('visualGenerating');
  });

  it('returns "assembling" when KEYFRAME_GEN is completed but later stages pending', () => {
    const p = makeProject({
      stageStatus: makeStageStatus({
        CAPABILITY_ASSESSMENT: 'completed',
        STYLE_EXTRACTION: 'completed',
        RESEARCH: 'completed',
        NARRATIVE_MAP: 'completed',
        SCRIPT_GENERATION: 'completed',
        QA_REVIEW: 'completed',
        TEMPORAL_PLANNING: 'completed',
        STORYBOARD: 'completed',
        REFERENCE_IMAGE: 'completed',
        KEYFRAME_GEN: 'completed',
        VIDEO_GEN: 'processing',
      }),
    });
    expect(getDashboardStatus(p)).toBe('assembling');
  });

  it('error takes priority over completed', () => {
    const allCompleted: Partial<Record<PipelineStage, ProcessStatus>> = {};
    for (const s of ALL_STAGES) allCompleted[s] = 'completed';
    const p = makeProject({
      stageStatus: makeStageStatus(allCompleted),
      error: 'late error',
    });
    expect(getDashboardStatus(p)).toBe('error');
  });

  it('error in stageStatus takes priority over pause', () => {
    const p = makeProject({
      isPaused: true,
      pausedAtStage: 'SCRIPT_GENERATION',
      stageStatus: makeStageStatus({ TTS: 'error' }),
    });
    expect(getDashboardStatus(p)).toBe('error');
  });
});

/* ---- getCardAction ---- */

describe('getCardAction', () => {
  const dummy = makeProject();

  it('maps scriptReview -> 审核脚本 / script', () => {
    expect(getCardAction(dummy, 'scriptReview')).toEqual({ label: '审核脚本', target: 'script' });
  });

  it('maps visualReview -> 审核视觉 / storyboard', () => {
    expect(getCardAction(dummy, 'visualReview')).toEqual({ label: '审核视觉', target: 'storyboard' });
  });

  it('maps visualGenerating -> 审核视觉 / storyboard', () => {
    expect(getCardAction(dummy, 'visualGenerating')).toEqual({ label: '审核视觉', target: 'storyboard' });
  });

  it('maps completed -> 查看成片 / production', () => {
    expect(getCardAction(dummy, 'completed')).toEqual({ label: '查看成片', target: 'production' });
  });

  it('maps error -> 查看错误 / production', () => {
    expect(getCardAction(dummy, 'error')).toEqual({ label: '查看错误', target: 'production' });
  });

  it('maps assembling -> 查看进度 / production', () => {
    expect(getCardAction(dummy, 'assembling')).toEqual({ label: '查看进度', target: 'production' });
  });

  it('maps analysis (default) -> 查看进度 / style', () => {
    expect(getCardAction(dummy, 'analysis')).toEqual({ label: '查看进度', target: 'style' });
  });
});
