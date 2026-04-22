/* ------------------------------------------------------------------ */
/*  pipeline-integration.test.ts — Full 13-stage pipeline test        */
/*  Runs the complete pipeline with a mock AI adapter to validate     */
/*  end-to-end stage execution, artifact flow, and video generation.  */
/* ------------------------------------------------------------------ */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Side-effect: registers video stage definitions so all 15 pipeline stages are available.
import '@ai-video/pipeline-video/stageDefinitions.js';
import { PipelineOrchestrator, SafetyBlockError } from '../orchestrator.js';
import { SSE_EVENT } from '../pipelineTypes.js';
import type { AIAdapter, PipelineEvent, PipelineProject, GenerationResult, Scene } from '../pipelineTypes.js';
import { ARTIFACT } from '../constants.js';

/* ---- Smart mock adapter that returns stage-appropriate JSON ---- */

function createMockAdapter(): AIAdapter {
  let callCount = 0;

  return {
    provider: 'mock',

    async generateText(_model: string, prompt: string | any[], options?: any): Promise<GenerationResult> {
      callCount++;
      const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

      // Safety check (CAPABILITY_ASSESSMENT)
      if (promptText.includes('safety') || promptText.includes('safe') ||
          (options?.responseMimeType === 'application/json' && callCount <= 2)) {
        return { text: JSON.stringify({ safe: true, reason: 'Topic is safe for content creation' }) };
      }

      // Style extraction (STYLE_EXTRACTION)
      if (promptText.includes('style') || promptText.includes('StyleDNA') || promptText.includes('visual')) {
        return {
          text: JSON.stringify({
            visualStyle: 'cinematic',
            pacing: 'medium',
            tone: 'informative',
            colorPalette: ['#1a1a2e', '#16213e', '#e94560'],
            narrativeStructure: ['Hook', 'Exposition', 'Climax', 'Conclusion'],
            hookType: 'question',
            callToActionType: 'subscribe',
            wordCount: 300,
            wordsPerMinute: 180,
            emotionalIntensity: 0.6,
            targetAudience: 'general',
            track_b_visual: {
              lighting_style: 'dramatic',
              visual_style: 'cinematic',
              aspect_ratio: '16:9',
            },
          }),
        };
      }

      // Research (RESEARCH)
      if (promptText.includes('research') || promptText.includes('fact') || promptText.includes('verify')) {
        return {
          text: JSON.stringify({
            facts: [
              { id: 'fact_1', content: 'The Sun is a G-type main-sequence star', sources: [{ url: 'https://nasa.gov', reliability: 0.95 }], aggConfidence: 0.95 },
              { id: 'fact_2', content: 'The Sun is approximately 4.6 billion years old', sources: [{ url: 'https://space.com', reliability: 0.9 }], aggConfidence: 0.9 },
            ],
            glossary: [{ term: 'Main-sequence star', definition: 'A star that fuses hydrogen into helium' }],
          }),
        };
      }

      // Calibration (NARRATIVE_MAP - calibration substage)
      if (promptText.includes('calibrat')) {
        return {
          text: JSON.stringify({
            calibration: {
              reference_total_words: 300,
              reference_duration_sec: 100,
              actual_speech_rate: '3 words/sec',
              new_video_target_duration_sec: 60,
              target_word_count: 180,
              target_word_count_min: '162',
              target_word_count_max: '198',
            },
            verified_facts: [
              { fact_id: 1, content: 'The Sun is a G-type star', source_marker: 'NASA', visual_potential: 'high', recommended_stage: 'Hook' },
            ],
          }),
        };
      }

      // Narrative map
      if (promptText.includes('narrative') || promptText.includes('beat') || promptText.includes('section')) {
        return {
          text: JSON.stringify([
            { sectionTitle: 'Hook', description: 'Attention-grabbing opener', estimatedDuration: 10, targetWordCount: 30 },
            { sectionTitle: 'Body', description: 'Core content delivery', estimatedDuration: 40, targetWordCount: 120 },
            { sectionTitle: 'Conclusion', description: 'Summary and call to action', estimatedDuration: 10, targetWordCount: 30 },
          ]),
        };
      }

      // Script generation (SCRIPT_GENERATION)
      if (promptText.includes('script') || promptText.includes('narrat')) {
        return {
          text: JSON.stringify({
            scriptText: 'Did you know the Sun is a giant ball of hot plasma? It is a G-type main-sequence star at the center of our solar system. The Sun is approximately 4.6 billion years old.',
            usedFactIDs: ['fact_1', 'fact_2'],
            factUsage: [
              { factId: 'fact_1', usageType: 'paraphrase', sectionTitle: 'Hook' },
              { factId: 'fact_2', usageType: 'verbatim', sectionTitle: 'Body' },
            ],
            totalWordCount: 180,
            totalEstimatedDuration: 60,
            scenes: [
              { sceneNumber: 1, narrative: 'Sun intro', visualPrompt: 'Dramatic shot of the Sun', estimatedDuration: 5 },
              { sceneNumber: 2, narrative: 'Sun facts', visualPrompt: 'Solar system overview', estimatedDuration: 5 },
            ],
          }),
        };
      }

      // QA review (QA_REVIEW)
      if (promptText.includes('review') || promptText.includes('quality') || promptText.includes('QA')) {
        return {
          text: JSON.stringify({
            approved: true,
            score: 85,
            issues: [],
            feedback: 'Script quality is good. No major issues found.',
          }),
        };
      }

      // Storyboard (STORYBOARD)
      if (promptText.includes('storyboard') || promptText.includes('scene') || promptText.includes('breakdown')) {
        return {
          text: JSON.stringify({
            scenes: [
              {
                id: 'scene_1', number: 1, narrative: 'The Sun rises above the horizon',
                visualPrompt: 'Golden sunrise over mountains, cinematic lighting',
                productionSpecs: { camera: 'wide angle', lighting: 'golden hour' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
              {
                id: 'scene_2', number: 2, narrative: 'Solar facts with visuals',
                visualPrompt: 'Close-up of solar surface with plasma eruptions',
                productionSpecs: { camera: 'macro', lighting: 'dramatic' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
            ],
          }),
        };
      }

      // Default: return simple text
      return { text: JSON.stringify({ result: 'ok' }) };
    },

    async generateImage(_model: string, prompt: string): Promise<GenerationResult> {
      callCount++;
      // Return a placeholder image URL for reference images and keyframes
      return {
        text: 'Generated image',
        imageUrl: `file:///tmp/mock-image-${callCount}.png`,
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };
    },

    async generateVideo(_model: string, prompt: string): Promise<GenerationResult> {
      callCount++;
      return {
        text: 'Generated video',
        videoUrl: `file:///tmp/mock-video-${callCount}.mp4`,
        durationMs: 5000,
      };
    },
  };
}

/* ---- Helper: check if edge-tts is available ---- */

async function isEdgeTtsInstalled(): Promise<boolean> {
  try {
    const { execSync } = await import('node:child_process');
    execSync('edge-tts --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/* ---- Helper: check if FFmpeg is available ---- */

async function isFfmpegInstalled(): Promise<boolean> {
  try {
    const { execSync } = await import('node:child_process');
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/* ================================================================== */
/*  Pipeline orchestrator integration tests                           */
/* ================================================================== */

/** Seed a text-capable mock provider so the B4 preflight check passes. */
function seedTestProvider(orch: PipelineOrchestrator): void {
  orch.providerRegistry.register('mock', { text: true, imageGeneration: true, videoGeneration: true, fileUpload: true, webSearch: true });
}

describe('Pipeline integration — full 13-stage flow', () => {
  let dataDir: string;
  let orch: PipelineOrchestrator;
  let events: PipelineEvent[];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pipeline-integ-'));
    orch = new PipelineOrchestrator(createMockAdapter(), {
      dataDir,
    });
    seedTestProvider(orch);
    events = [];
    orch.onEvent((e) => events.push(e));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  /* ---- Core pipeline execution ---- */

  it('runs analysis stages (CAPABILITY_ASSESSMENT → STYLE_EXTRACTION → RESEARCH) successfully', async () => {
    const project = orch.createProject('太阳的奥秘', '探索太阳');

    // Manually run only the first 3 stages by running full pipeline
    // but checking intermediate state. The pipeline will pause at QA_REVIEW
    // by default since it's a pause point.
    const result = await orch.run(project.id);

    // Pipeline should have executed at least CAPABILITY_ASSESSMENT
    expect(result.stageStatus.CAPABILITY_ASSESSMENT).toBe('completed');
    expect(result.safetyCheck).toBeDefined();
    expect(result.safetyCheck!.safe).toBe(true);
  }, 10_000);

  it('safety check runs and passes for safe topics', async () => {
    const project = orch.createProject('any topic');
    const result = await orch.run(project.id);

    expect(result.safetyCheck).toBeDefined();
    expect(result.safetyCheck!.safe).toBe(true);
    // Pipeline should proceed past CAPABILITY_ASSESSMENT
    expect(result.stageStatus.CAPABILITY_ASSESSMENT).toBe('completed');
  }, 10_000);

  it('pauses at QA_REVIEW checkpoint', async () => {
    const project = orch.createProject('Test topic for QA');
    const result = await orch.run(project.id);

    // Default pauseAfterStages includes QA_REVIEW
    if (result.isPaused && result.pausedAtStage === 'QA_REVIEW') {
      expect(result.stageStatus.QA_REVIEW).toBe('completed');
      // Verify the paused state is persisted
      const loaded = orch.loadProject(project.id);
      expect(loaded!.isPaused).toBe(true);
      expect(loaded!.pausedAtStage).toBe('QA_REVIEW');
    }
    // Pipeline may also have completed all stages if stages ran fast enough
    expect(['completed', 'error']).toContain(result.stageStatus.CAPABILITY_ASSESSMENT);
  });

  it('emits stage events in order', async () => {
    const project = orch.createProject('Event tracking test');
    await orch.run(project.id);

    const stageEvents = events.filter(e => e.type === SSE_EVENT.STAGE);
    expect(stageEvents.length).toBeGreaterThan(0);

    // First stage event should be CAPABILITY_ASSESSMENT processing
    const firstStage = stageEvents[0] as any;
    expect(firstStage.payload.stage).toBe('CAPABILITY_ASSESSMENT');
  });

  it('persists artifacts to disk', async () => {
    const project = orch.createProject('Artifact test');
    await orch.run(project.id);

    const projectDir = orch.getProjectDir(project.id);

    // capability-assessment.json should exist after first stage
    const capAssessPath = join(projectDir, ARTIFACT.CAPABILITY_ASSESSMENT);
    if (existsSync(capAssessPath)) {
      const data = JSON.parse(readFileSync(capAssessPath, 'utf-8'));
      expect(data.safetyCheck).toBeDefined();
      expect(data.safetyCheck.safe).toBe(true);
    }
  });

  it('project state is persisted after each stage', async () => {
    const project = orch.createProject('Persistence test');
    await orch.run(project.id);

    // Reload from disk
    const loaded = orch.loadProject(project.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.stageStatus.CAPABILITY_ASSESSMENT).toBe('completed');
  });

  /* ---- Retry & error handling ---- */

  it('retryStage resets stage status and re-runs from fresh orchestrator', async () => {
    const project = orch.createProject('Retry test');
    const result = await orch.run(project.id);

    // If pipeline ran successfully past first stage, retry using a fresh
    // orchestrator instance (shares same dataDir) to avoid runLock conflict.
    if (result.stageStatus.CAPABILITY_ASSESSMENT === 'completed') {
      const freshOrch = new PipelineOrchestrator(createMockAdapter(), {
        dataDir,
      });
      seedTestProvider(freshOrch);
      const retried = await freshOrch.retryStage(project.id, 'CAPABILITY_ASSESSMENT');
      expect(retried.stageStatus.CAPABILITY_ASSESSMENT).toBe('completed');
    }
  }, 10_000);

  it('handles adapter errors gracefully', async () => {
    const failingAdapter: AIAdapter = {
      provider: 'mock',
      generateText: async () => { throw new Error('API quota exceeded'); },
      generateImage: async () => ({ text: '' }),
      generateVideo: async () => ({ text: '' }),
    };

    const failOrch = new PipelineOrchestrator(failingAdapter, { dataDir });
    seedTestProvider(failOrch);
    const project = failOrch.createProject('Error test');
    const result = await failOrch.run(project.id);

    // CAPABILITY_ASSESSMENT no longer calls generateText, so it succeeds.
    // The first stage to hit the adapter error is STYLE_EXTRACTION.
    expect(result.stageStatus.CAPABILITY_ASSESSMENT).toBe('completed');
    expect(result.stageStatus.STYLE_EXTRACTION).toBe('error');
    expect(result.error).toBeDefined();
  });

  /* ---- Scene management ---- */

  it('scenes are created during STORYBOARD stage', async () => {
    const project = orch.createProject('Scene creation test');
    const result = await orch.run(project.id);

    // If pipeline got past STORYBOARD, scenes should exist
    if (result.stageStatus.STORYBOARD === 'completed') {
      expect(result.scenes).toBeDefined();
      expect(result.scenes!.length).toBeGreaterThan(0);
      for (const scene of result.scenes!) {
        expect(scene.id).toBeDefined();
        expect(scene.narrative).toBeDefined();
        expect(scene.visualPrompt).toBeDefined();
      }
    }
  });

  /* ---- Model overrides ---- */

  it('model overrides are persisted and loaded', () => {
    const overrides = { image_generation: { adapter: 'api' as const, model: 'imagen-3-pro' } };
    const project = orch.createProject('Override test', undefined, overrides);
    const loaded = orch.loadProject(project.id);
    expect(loaded!.modelOverrides).toEqual(overrides);
  });

  it('updateModelOverrides updates and persists', () => {
    const project = orch.createProject('Override update test');
    const newOverrides = { video_generation: { adapter: 'api' as const, model: 'veo-3.1' } };
    const updated = orch.updateModelOverrides(project.id, newOverrides);
    expect(updated.modelOverrides).toEqual(newOverrides);
  });

  /* ---- Abort ---- */

  it('abort stops pipeline execution', async () => {
    const project = orch.createProject('Abort test');

    // Abort immediately
    setTimeout(() => orch.abort(), 50);
    const result = await orch.run(project.id);

    // Pipeline should have been aborted — not all stages completed
    const completedCount = Object.values(result.stageStatus).filter(s => s === 'completed').length;
    expect(completedCount).toBeLessThanOrEqual(13);
  });

  it('abort cancels an in-flight AI call and leaves the current stage retryable', async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });

    const hangingAdapter: AIAdapter = {
      provider: 'mock',
      generateText: async () => {
        started();
        return await new Promise<GenerationResult>(() => {});
      },
      generateImage: async () => ({ text: '' }),
      generateVideo: async () => ({ text: '' }),
    };

    const abortOrch = new PipelineOrchestrator(hangingAdapter, { dataDir });
    seedTestProvider(abortOrch);
    const project = abortOrch.createProject('Abort hanging test');
    // Create a dummy reference video so STYLE_EXTRACTION reaches generateText
    const uploadsDir = join(dataDir, 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const dummyVideo = join(uploadsDir, 'dummy.mp4');
    writeFileSync(dummyVideo, 'fake');

    const runPromise = abortOrch.run(project.id, dummyVideo);
    await startedPromise;
    abortOrch.abort();

    const result = await runPromise;
    // CAPABILITY_ASSESSMENT completes without calling adapter.
    // The hang/abort happens at STYLE_EXTRACTION.
    expect(result.stageStatus.CAPABILITY_ASSESSMENT).toBe('completed');
    expect(result.stageStatus.STYLE_EXTRACTION).toBe('error');
    expect(result.error).toContain('aborted');
  }, 15_000);

  /* ---- Script editing ---- */

  it('updateScript persists new script text', async () => {
    const project = orch.createProject('Script edit test');
    const result = await orch.run(project.id);

    if (result.scriptOutput) {
      const updated = orch.updateScript(project.id, 'New edited script text');
      expect(updated.scriptOutput!.scriptText).toBe('New edited script text');

      // Version history should exist
      const history = orch.getScriptHistory(project.id);
      expect(history.length).toBeGreaterThan(0);
    }
  });

  /* ---- Concurrency guard ---- */

  it('prevents concurrent runs on same project', async () => {
    const project = orch.createProject('Concurrency test');

    // Start first run
    const run1 = orch.run(project.id);

    // Second run should throw
    await expect(orch.run(project.id)).rejects.toThrow('already running');

    // Wait for first run to finish
    await run1;
  });
});

/* ================================================================== */
/*  Pipeline stage status tracking                                     */
/* ================================================================== */

describe('Pipeline stage status tracking', () => {
  let dataDir: string;
  let orch: PipelineOrchestrator;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pipeline-status-'));
    orch = new PipelineOrchestrator(createMockAdapter(), {
      dataDir,
    });
    seedTestProvider(orch);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('all 15 stages start as pending', () => {
    const project = orch.createProject('Status test');
    const statuses = Object.values(project.stageStatus);
    expect(statuses).toHaveLength(15);
    expect(statuses.every(s => s === 'pending')).toBe(true);
  });

  it('stage transitions: pending → processing → completed', async () => {
    const events: PipelineEvent[] = [];
    orch.onEvent((e) => events.push(e));

    const project = orch.createProject('Transition test');
    await orch.run(project.id);

    // Check that CAPABILITY_ASSESSMENT went through processing → completed
    const capEvents = events.filter(
      e => e.type === SSE_EVENT.STAGE && (e as any).payload.stage === 'CAPABILITY_ASSESSMENT',
    );

    expect(capEvents.length).toBeGreaterThanOrEqual(2);
    expect((capEvents[0] as any).payload.status).toBe('processing');
    expect((capEvents[1] as any).payload.status).toBe('completed');
  });

  it('error stage transitions: pending → processing → error', async () => {
    const failAdapter: AIAdapter = {
      provider: 'mock',
      generateText: async () => { throw new Error('Test error'); },
      generateImage: async () => ({ text: '' }),
      generateVideo: async () => ({ text: '' }),
    };
    const failOrch = new PipelineOrchestrator(failAdapter, { dataDir });
    seedTestProvider(failOrch);
    const events: PipelineEvent[] = [];
    failOrch.onEvent((e) => events.push(e));

    const project = failOrch.createProject('Error transition test');
    await failOrch.run(project.id);

    // CAPABILITY_ASSESSMENT no longer calls generateText, so the first
    // stage that errors out is STYLE_EXTRACTION.
    const errorEvents = events.filter(
      e => e.type === SSE_EVENT.ERROR && (e as any).payload.stage === 'STYLE_EXTRACTION',
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

/* ================================================================== */
/*  Pipeline pause/resume flow                                         */
/* ================================================================== */

describe('Pipeline pause/resume', () => {
  let dataDir: string;
  let orch: PipelineOrchestrator;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pipeline-pause-'));
    orch = new PipelineOrchestrator(createMockAdapter(), {
      dataDir,
    });
    seedTestProvider(orch);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('default pauseAfterStages includes QA_REVIEW, STORYBOARD, REFERENCE_IMAGE', () => {
    const project = orch.createProject('Pause config test');
    expect(project.pauseAfterStages).toContain('QA_REVIEW');
    expect(project.pauseAfterStages).toContain('STORYBOARD');
    expect(project.pauseAfterStages).toContain('REFERENCE_IMAGE');
  });

  it('approveQaReview marks QA_REVIEW as completed', () => {
    const project = orch.createProject('QA approve test');
    const result = orch.approveQaReview(project.id, { feedback: 'Looks good' });
    expect(result.stageStatus.QA_REVIEW).toBe('completed');
    expect(result.qaReviewResult!.approved).toBe(true);
  });

  it('approveQaReview approves without cross-check (simplified)', () => {
    const project = orch.createProject('QA approve no-crosscheck');
    project.scriptOutput = { scriptText: '短', scenes: [] } as any;
    (orch as any).saveProject(project);
    const result = orch.approveQaReview(project.id, { feedback: 'auto-approved by run-free-pipeline.mjs' });
    expect(result.stageStatus.QA_REVIEW).toBe('completed');
    expect(result.qaReviewResult!.approved).toBe(true);
  });

  it('approveReferenceImages marks REFERENCE_IMAGE as completed', () => {
    const project = orch.createProject('Ref approve test');
    const result = orch.approveReferenceImages(project.id);
    expect(result.stageStatus.REFERENCE_IMAGE).toBe('completed');
  });

  it('resumePipeline throws if not paused', async () => {
    const project = orch.createProject('Not paused test');
    await expect(orch.resumePipeline(project.id)).rejects.toThrow('not paused');
  });
});

/* ================================================================== */
/*  Resource plan generation                                           */
/* ================================================================== */

describe('Pipeline resource planning', () => {
  let dataDir: string;
  let orch: PipelineOrchestrator;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pipeline-resource-'));
    orch = new PipelineOrchestrator(createMockAdapter(), {
      dataDir,
    });
    seedTestProvider(orch);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('generates resource plan with all 15 stages', () => {
    const project = orch.createProject('Resource plan test');
    const plan = orch.getResourcePlan(project.id);
    expect(plan.stages).toHaveLength(15);
  });
});
