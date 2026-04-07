import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PipelineOrchestrator } from '../orchestrator.js';
import type { AIAdapter, PipelineEvent } from '../types.js';

/* ---- Minimal mock adapter (never called in CRUD tests) ---- */
const mockAdapter: AIAdapter = {
  provider: 'mock',
  generateText: async () => ({ text: '' }),
  generateImage: async () => ({ text: '' }),
  generateVideo: async () => ({ text: '' }),
};

describe('PipelineOrchestrator', () => {
  let dataDir: string;
  let orch: PipelineOrchestrator;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pipeline-test-'));
    orch = new PipelineOrchestrator(mockAdapter, {
      dataDir,
      qualityTier: 'free',
    });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('createProject returns a project with correct fields', () => {
    const project = orch.createProject('太阳的奥秘', '太阳视频');
    expect(project.id).toMatch(/^proj_/);
    expect(project.topic).toBe('太阳的奥秘');
    expect(project.title).toBe('太阳视频');
    expect(project.qualityTier).toBe('free');
    expect(project.createdAt).toBeDefined();
    expect(project.stageStatus).toBeDefined();
    // All 13 stages should be present with 'pending' status
    const expectedStages = [
      'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
      'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW',
      'STORYBOARD', 'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS',
      'ASSEMBLY', 'REFINEMENT',
    ];
    expect(Object.keys(project.stageStatus).sort()).toEqual(expectedStages.sort());
    for (const stage of expectedStages) {
      expect(project.stageStatus[stage as keyof typeof project.stageStatus]).toBe('pending');
    }
    expect(project.logs).toEqual([]);
  });

  it('createProject defaults title from topic', () => {
    const project = orch.createProject('一个很长很长的视频主题名称这里超过五十个字符的时候要截断一下');
    expect(project.title.length).toBeLessThanOrEqual(50);
  });

  it('loadProject returns the created project', () => {
    const created = orch.createProject('Test topic');
    const loaded = orch.loadProject(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(created.id);
    expect(loaded!.topic).toBe('Test topic');
  });

  it('loadProject returns null for unknown id', () => {
    expect(orch.loadProject('nonexistent')).toBeNull();
  });

  it('listProjects returns all projects sorted by date desc', async () => {
    orch.createProject('Topic A');
    // Ensure unique Date.now() values
    await new Promise(r => setTimeout(r, 5));
    orch.createProject('Topic B');
    await new Promise(r => setTimeout(r, 5));
    orch.createProject('Topic C');
    const list = orch.listProjects();
    expect(list).toHaveLength(3);
    // Most recent first
    expect(list[0].topic).toBe('Topic C');
    expect(list[2].topic).toBe('Topic A');
  });

  it('emits pipeline_created event', () => {
    const events: PipelineEvent[] = [];
    orch.onEvent((e) => events.push(e));
    const project = orch.createProject('Test');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('pipeline_created');
    expect((events[0] as any).payload.projectId).toBe(project.id);
  });

  it('onEvent returns unsubscribe function', () => {
    const events: PipelineEvent[] = [];
    const unsub = orch.onEvent((e) => events.push(e));
    orch.createProject('A');
    expect(events).toHaveLength(1);
    unsub();
    orch.createProject('B');
    expect(events).toHaveLength(1); // no new event after unsub
  });

  it('getQualityTier returns configured tier', () => {
    expect(orch.getQualityTier()).toBe('free');
  });

  it('createProject with model overrides persists them', () => {
    const overrides = { image_generation: { adapter: 'api' as const } };
    const project = orch.createProject('Topic', undefined, overrides);
    const loaded = orch.loadProject(project.id);
    expect(loaded!.modelOverrides).toEqual(overrides);
  });

  it('deleteProject removes the project', () => {
    const project = orch.createProject('To delete');
    expect(orch.deleteProject(project.id)).toBe(true);
    expect(orch.loadProject(project.id)).toBeNull();
  });

  it('deleteProject returns false for unknown id', () => {
    expect(orch.deleteProject('nonexistent')).toBe(false);
  });

  it('approveQaReview marks QA_REVIEW as completed', () => {
    const project = orch.createProject('QA test');
    const result = orch.approveQaReview(project.id, { feedback: 'Looks good' });
    expect(result.stageStatus.QA_REVIEW).toBe('completed');
    expect(result.qaReviewResult).toEqual({
      approved: true,
      feedback: 'Looks good',
    });
  });

  it('approveReferenceImages marks REFERENCE_IMAGE as completed', () => {
    const project = orch.createProject('Ref test');
    const result = orch.approveReferenceImages(project.id);
    expect(result.stageStatus.REFERENCE_IMAGE).toBe('completed');
  });

  it('default pauseAfterStages includes QA_REVIEW, STORYBOARD, REFERENCE_IMAGE', () => {
    const project = orch.createProject('Pause test');
    expect(project.pauseAfterStages).toContain('QA_REVIEW');
    expect(project.pauseAfterStages).toContain('STORYBOARD');
    expect(project.pauseAfterStages).toContain('REFERENCE_IMAGE');
  });
});
