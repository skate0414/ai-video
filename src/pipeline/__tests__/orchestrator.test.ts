import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PipelineOrchestrator } from '../orchestrator.js';
import type { AIAdapter, PipelineEvent, Scene } from '../types.js';
import { ARTIFACT } from '../../constants.js';
import { SSE_EVENT } from '../types.js';

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
    expect(project.createdAt).toBeDefined();
    expect(project.stageStatus).toBeDefined();
    // All 15 stages should be present with 'pending' status
    const expectedStages = [
      'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
      'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING',
      'STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS',
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
    expect(events[0].type).toBe(SSE_EVENT.CREATED);
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

  /* ---- invalidateArtifactCache ---- */

  it('invalidateArtifactCache clears cached fields so ??= re-reads from disk', () => {
    const project = orch.createProject('Cache test');
    // Simulate ??= having populated cached fields
    (project as any).researchData = { facts: ['stale'] };
    (project as any).narrativeMap = { beats: ['stale'] };
    (project as any).scenes = [{ id: 's1' }];
    orch.saveProject(project);

    // Invalidate only research + narrativeMap
    orch.invalidateArtifactCache(project.id, [ARTIFACT.RESEARCH, ARTIFACT.NARRATIVE_MAP]);

    const reloaded = orch.loadProject(project.id)!;
    expect(reloaded.researchData).toBeUndefined();
    expect(reloaded.narrativeMap).toBeUndefined();
    // scenes should NOT be cleared (not in the invalidation set)
    expect(reloaded.scenes).toEqual([{ id: 's1' }]);
  });

  it('invalidateArtifactCache with no args clears all cacheable fields', () => {
    const project = orch.createProject('Cache all test');
    (project as any).styleProfile = { pacing: 'fast' };
    (project as any).researchData = { facts: [] };
    (project as any).calibrationData = { wpm: 150 };
    (project as any).narrativeMap = { beats: [] };
    (project as any).scriptOutput = { scriptText: 'hi' };
    (project as any).scenes = [{ id: 's1' }];
    orch.saveProject(project);

    orch.invalidateArtifactCache(project.id);

    const reloaded = orch.loadProject(project.id)!;
    expect(reloaded.styleProfile).toBeUndefined();
    expect(reloaded.researchData).toBeUndefined();
    expect(reloaded.calibrationData).toBeUndefined();
    expect(reloaded.narrativeMap).toBeUndefined();
    expect(reloaded.scriptOutput).toBeUndefined();
    expect(reloaded.scenes).toBeUndefined();
  });

  it('invalidateArtifactCache is no-op for nonexistent project', () => {
    // Should not throw
    orch.invalidateArtifactCache('nonexistent');
  });

  /* ---- D1-1: updateScript rebuilds ScriptCIR ---- */

  it('updateScript rebuilds script.cir.json so downstream stages see edited text', () => {
    const project = orch.createProject('CIR rebuild test');
    // Seed a scriptOutput so updateScript has something to update
    (project as any).scriptOutput = {
      scriptText: 'Original text. Second sentence.',
      usedFactIDs: [],
      factUsage: [],
    };
    orch.saveProject(project);

    // Edit the script
    orch.updateScript(project.id, 'Edited text. A brand new sentence. Third.');

    // Verify script.cir.json was rebuilt with edited text
    const cir = (orch as any).loadArtifact(project.id, ARTIFACT.SCRIPT_CIR);
    expect(cir).toBeDefined();
    expect(cir._cir).toBe('Script');
    expect(cir.fullText).toBe('Edited text. A brand new sentence. Third.');
    expect(cir.sentences.length).toBe(3);
  });

  /* ---- getProjectDir ---- */

  it('getProjectDir returns path within dataDir', () => {
    const project = orch.createProject('Dir test');
    const dir = orch.getProjectDir(project.id);
    expect(dir).toContain(dataDir);
    expect(dir).toContain(project.id);
  });

  /* ---- updateScenes ---- */

  it('updateScenes persists scene changes', () => {
    const project = orch.createProject('Scene test');
    const scenes: Scene[] = [
      { id: 's1', number: 1, narrative: 'Introduction scene', visualPrompt: 'A sunrise', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'pending', logs: [] },
      { id: 's2', number: 2, narrative: 'Main content', visualPrompt: 'A diagram', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'pending', logs: [] },
    ];
    const updated = orch.updateScenes(project.id, scenes);
    expect(updated.scenes).toHaveLength(2);
    expect(updated.scenes![0].narrative).toBe('Introduction scene');

    // Reload and verify persistence
    const reloaded = orch.loadProject(project.id)!;
    expect(reloaded.scenes).toHaveLength(2);
  });

  it('updateScenes throws for nonexistent project', () => {
    expect(() => orch.updateScenes('nonexistent', [])).toThrow('not found');
  });

  /* ---- updateModelOverrides ---- */

  it('updateModelOverrides persists overrides', () => {
    const project = orch.createProject('Override test');
    const overrides = { fact_research: { adapter: 'chat' as const, model: 'gemini-pro' } };
    const updated = orch.updateModelOverrides(project.id, overrides);
    expect(updated.modelOverrides).toEqual(overrides);

    const reloaded = orch.loadProject(project.id)!;
    expect(reloaded.modelOverrides).toEqual(overrides);
  });

  it('updateModelOverrides throws for nonexistent project', () => {
    expect(() => orch.updateModelOverrides('nonexistent', {})).toThrow('not found');
  });

  /* ---- updateStageProviderOverrides ---- */

  it('updateStageProviderOverrides persists stage-level overrides', () => {
    const project = orch.createProject('Stage override test');
    const overrides = { RESEARCH: 'gemini' };
    const updated = orch.updateStageProviderOverrides(project.id, overrides as any);
    expect(updated.stageProviderOverrides).toEqual(overrides);
  });

  /* ---- approveScene / rejectScene ---- */

  it('approveScene marks a scene as approved', () => {
    const project = orch.createProject('Approve test');
    const scenes: Scene[] = [
      { id: 's1', number: 1, narrative: 'n', visualPrompt: 'v', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'pending', logs: [] },
      { id: 's2', number: 2, narrative: 'n', visualPrompt: 'v', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'pending', logs: [] },
    ];
    orch.updateScenes(project.id, scenes);

    const updated = orch.approveScene(project.id, 's1');
    const scene = updated.scenes!.find(s => s.id === 's1')!;
    expect(scene.reviewStatus).toBe('approved');
    expect(scene.status).toBe('done');
  });

  it('approveScene completes REFERENCE_IMAGE when all scenes approved', () => {
    const project = orch.createProject('All approve test');
    const scenes: Scene[] = [
      { id: 's1', number: 1, narrative: 'n', visualPrompt: 'v', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'done', reviewStatus: 'approved', logs: [] },
      { id: 's2', number: 2, narrative: 'n', visualPrompt: 'v', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'pending', logs: [] },
    ];
    orch.updateScenes(project.id, scenes);

    const updated = orch.approveScene(project.id, 's2');
    expect(updated.stageStatus.REFERENCE_IMAGE).toBe('completed');
  });

  it('approveScene emits SCENE_REVIEW event', () => {
    const project = orch.createProject('Event test');
    const scenes: Scene[] = [
      { id: 's1', number: 1, narrative: 'n', visualPrompt: 'v', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'pending', logs: [] },
    ];
    orch.updateScenes(project.id, scenes);

    const events: PipelineEvent[] = [];
    orch.onEvent(e => events.push(e));
    orch.approveScene(project.id, 's1');

    const reviewEvent = events.find(e => e.type === SSE_EVENT.SCENE_REVIEW);
    expect(reviewEvent).toBeDefined();
  });

  it('approveScene throws for nonexistent scene', () => {
    const project = orch.createProject('Missing scene');
    orch.updateScenes(project.id, [
      { id: 's1', number: 1, narrative: 'n', visualPrompt: 'v', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'pending', logs: [] },
    ]);
    expect(() => orch.approveScene(project.id, 'nope')).toThrow('not found');
  });

  it('rejectScene marks a scene for regeneration', () => {
    const project = orch.createProject('Reject test');
    const scenes: Scene[] = [
      { id: 's1', number: 1, narrative: 'n', visualPrompt: 'v', productionSpecs: {}, assetType: 'image', estimatedDuration: 5, status: 'done', assetUrl: '/img.png', audioUrl: '/audio.mp3', logs: [] },
    ];
    orch.updateScenes(project.id, scenes);

    const updated = orch.rejectScene(project.id, 's1');
    const scene = updated.scenes!.find(s => s.id === 's1')!;
    expect(scene.reviewStatus).toBe('rejected');
    expect(scene.status).toBe('pending');
    expect(scene.assetUrl).toBeUndefined();
    expect(scene.audioUrl).toBeUndefined();
  });

  it('rejectScene throws for nonexistent scene', () => {
    const project = orch.createProject('Reject missing');
    orch.updateScenes(project.id, []);
    expect(() => orch.rejectScene(project.id, 'nope')).toThrow();
  });

  /* ---- setStyleProfile ---- */

  it('setStyleProfile sets profile and marks STYLE_EXTRACTION complete', () => {
    const project = orch.createProject('Style test');
    const profile = {
      visualStyle: 'cinematic',
      pacing: 'fast' as const,
      tone: 'dramatic',
      colorPalette: ['#000'],
      narrativeStructure: ['Hook'],
    };
    const updated = orch.setStyleProfile(project.id, profile as any);
    expect(updated.styleProfile).toEqual(profile);
    expect(updated.stageStatus.STYLE_EXTRACTION).toBe('completed');
  });

  it('setStyleProfile emits STAGE and ARTIFACT events', () => {
    const project = orch.createProject('Style event test');
    const events: PipelineEvent[] = [];
    orch.onEvent(e => events.push(e));

    orch.setStyleProfile(project.id, { visualStyle: 'doc' } as any);

    const stageEvent = events.find(e => e.type === SSE_EVENT.STAGE);
    const artifactEvent = events.find(e => e.type === SSE_EVENT.ARTIFACT);
    expect(stageEvent).toBeDefined();
    expect(artifactEvent).toBeDefined();
  });

  it('setStyleProfile persists format signature when provided', () => {
    const project = orch.createProject('Sig test');
    const sig = { shotCount: 5, avgShotSec: 3 };
    orch.setStyleProfile(project.id, { visualStyle: 'doc' } as any, sig);

    const loaded = orch.loadProject(project.id)!;
    expect(loaded.styleProfile).toBeDefined();
  });

  it('setStyleProfile throws for nonexistent project', () => {
    expect(() => orch.setStyleProfile('nonexistent', {} as any)).toThrow('not found');
  });

  /* ---- getScriptHistory ---- */

  it('getScriptHistory returns empty array when no history', () => {
    const project = orch.createProject('History test');
    expect(orch.getScriptHistory(project.id)).toEqual([]);
  });

  /* ---- requestPause ---- */

  it('requestPause sets pause flag', () => {
    const project = orch.createProject('Pause test 2');
    orch.requestPause(project.id);
    // No error thrown; the flag is internal state checked during pipeline run
  });

  /* ---- Script operations ---- */

  describe('updateScript', () => {
    it('updates scriptText on the project', () => {
      const project = orch.createProject('Script update test');
      const updated = orch.updateScript(project.id, '这是新的剧本文本。');
      expect(updated.scriptOutput?.scriptText).toBe('这是新的剧本文本。');
    });

    it('creates scriptOutput if missing', () => {
      const project = orch.createProject('Script create test');
      const updated = orch.updateScript(project.id, 'New script');
      expect(updated.scriptOutput).toBeDefined();
      expect(updated.scriptOutput!.scriptText).toBe('New script');
    });

    it('saves previous version to history', () => {
      const project = orch.createProject('Script history test');
      orch.updateScript(project.id, 'Version 1');
      orch.updateScript(project.id, 'Version 2');
      const history = orch.getScriptHistory(project.id);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].scriptText).toBe('Version 1');
    });

    it('throws for unknown project', () => {
      expect(() => orch.updateScript('nonexistent', 'text')).toThrow('not found');
    });
  });

  describe('getScriptHistory', () => {
    it('returns empty array for new project', () => {
      const project = orch.createProject('History empty test');
      expect(orch.getScriptHistory(project.id)).toEqual([]);
    });
  });

  describe('restoreScriptVersion', () => {
    it('restores a previous script version', () => {
      const project = orch.createProject('Restore test');
      orch.updateScript(project.id, 'First');
      orch.updateScript(project.id, 'Second');
      const restored = orch.restoreScriptVersion(project.id, 1);
      expect(restored.scriptOutput?.scriptText).toBe('First');
    });

    it('throws for non-existent version', () => {
      const project = orch.createProject('Restore fail test');
      expect(() => orch.restoreScriptVersion(project.id, 999)).toThrow('not found');
    });
  });

  /* ---- Scene operations ---- */

  describe('updateScenes', () => {
    it('persists updated scenes', () => {
      const project = orch.createProject('Scene update test');
      const scenes: Scene[] = [{
        id: 's1', number: 1, narrative: 'Test', visualPrompt: 'Visual',
        productionSpecs: {}, assetType: 'video', estimatedDuration: 5, status: 'pending', logs: [],
      } as Scene];
      const updated = orch.updateScenes(project.id, scenes);
      expect(updated.scenes).toHaveLength(1);
      expect(updated.scenes![0].id).toBe('s1');
    });

    it('throws for unknown project', () => {
      expect(() => orch.updateScenes('nonexistent', [])).toThrow('not found');
    });
  });

  describe('updateModelOverrides', () => {
    it('stores model overrides', () => {
      const project = orch.createProject('Override test');
      const updated = orch.updateModelOverrides(project.id, { text: 'gemini-2.0' } as any);
      expect(updated.modelOverrides).toEqual({ text: 'gemini-2.0' });
    });

    it('throws for unknown project', () => {
      expect(() => orch.updateModelOverrides('nonexistent', {})).toThrow('not found');
    });
  });

  describe('updateStageProviderOverrides', () => {
    it('stores stage provider overrides', () => {
      const project = orch.createProject('Stage override test');
      const overrides = { RESEARCH: { adapter: 'chat' as const, provider: 'gemini' } };
      const updated = orch.updateStageProviderOverrides(project.id, overrides);
      expect(updated.stageProviderOverrides).toEqual(overrides);
    });

    it('throws for unknown project', () => {
      expect(() => orch.updateStageProviderOverrides('nonexistent', {})).toThrow('not found');
    });
  });

  describe('getProjectDir', () => {
    it('returns a path containing the project ID', () => {
      const project = orch.createProject('Dir test');
      const dir = orch.getProjectDir(project.id);
      expect(dir).toContain(project.id);
    });
  });

  describe('getResourcePlan', () => {
    it('returns a resource plan for existing project', () => {
      const project = orch.createProject('Resource plan test');
      const plan = orch.getResourcePlan(project.id);
      expect(plan).toBeDefined();
      expect(plan).toHaveProperty('stages');
    });
  });
});
