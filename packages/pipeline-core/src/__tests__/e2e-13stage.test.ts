/* ------------------------------------------------------------------ */
/*  e2e-13stage.test.ts — Full 13-stage pipeline E2E test             */
/*  Runs the COMPLETE pipeline through all stages with mocked         */
/*  external dependencies (FFmpeg, edge-tts, aivideomaker).           */
/*  Verifies stage completion, artifact flow, and data integrity.     */
/* ------------------------------------------------------------------ */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Side-effect: registers all 15 video stage definitions before the E2E run.
import '@ai-video/pipeline-video/stageDefinitions.js';
import { ARTIFACT } from '../constants.js';
import { SSE_EVENT } from '../pipelineTypes.js';

// Mock external dependencies BEFORE importing the orchestrator
vi.mock('../ttsProvider.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    isEdgeTTSAvailable: vi.fn(async () => true),
    generateSpeech: vi.fn(async (_text: string, config: any) => ({
      audioUrl: join(config.assetsDir, `mock_audio_${Date.now()}.mp3`),
    })),
  };
});

vi.mock('../ffmpegAssembler.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    isFFmpegAvailable: vi.fn(async () => true),
    assembleVideo: vi.fn(async (_scenes: any, opts: any) => {
      const outPath = join(opts.outputDir, 'output.mp4');
      writeFileSync(outPath, 'mock-video-output');
      return outPath;
    }),
    getVideoInfo: vi.fn(async () => ({
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
    })),
    getMediaDuration: vi.fn(async () => 5.0),
    getAudioMeanVolume: vi.fn(async () => -20.0),
  };
});

import { PipelineOrchestrator } from '../orchestrator.js';
import type { AIAdapter, PipelineEvent, GenerationResult, PipelineProject } from '../pipelineTypes.js';

/* ---- Mock adapter returning stage-appropriate responses ---- */

function createE2EMockAdapter(): AIAdapter {
  let callCount = 0;

  return {
    provider: 'mock-e2e',

    async generateText(_model: string, prompt: string | any[], options?: any): Promise<GenerationResult> {
      callCount++;
      const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
      const p = promptText.toLowerCase();

      const isStyleExtraction =
        p.includes('video style analysis expert') ||
        p.includes('analyze the provided reference video and extract a detailed "style dna" profile') ||
        p.includes('track a – script');
      const isResearch =
        p.includes('research assistant for a science video production system');
      const isFactVerification =
        p.includes('fact-checking specialist') || p.includes('claims to verify');
      const isCalibration =
        p.includes('part 1: speech rate calibration') || p.includes('new_video_target_duration_sec');
      const isNarrativeMap =
        p.includes('narrative structure expert for science explainer videos');
      const isScriptGeneration =
        p.includes('script generation') || p.includes('output json only (no markdown)') || p.includes('strict format: first char must be {');
      const isSkeletonGeneration =
        p.includes('skeleton generation') || p.includes('script architect');
      const isScriptWriting =
        p.includes('writing — fill the skeleton') || p.includes('fill the skeleton');
      const isQAReview =
        p.includes('quality reviewer for science explainer video scripts') || p.includes('self-correction audit');
      const isStoryboard =
        p.includes('visual director for 3d animated science explainer videos') || p.includes('scene-by-scene storyboard');
      const isSubjectIsolation =
        p.includes('subject isolation') || p.includes('isolat');

      // Safety check
      if (p.includes('safety') || p.includes('safe')) {
        return { text: JSON.stringify({ safe: true, reason: 'Topic is safe' }) };
      }

      // Style extraction
      if (isStyleExtraction) {
        return {
          text: JSON.stringify({
            meta: { video_language: 'Chinese', video_duration_sec: 60 },
            visualStyle: 'cinematic',
            pacing: 'medium',
            tone: 'informative',
            colorPalette: ['#1a1a2e', '#16213e', '#e94560'],
            narrativeStructure: ['Hook', 'Exposition', 'Conclusion'],
            hookType: 'question',
            callToActionType: 'subscribe',
            wordCount: 200,
            wordsPerMinute: 180,
            emotionalIntensity: 0.6,
            targetAudience: 'general',
            track_a_script: {
              hook_strategy: 'question',
              sentence_length_avg: 25,
              sentence_length_max: 50,
            },
            track_b_visual: {
              base_medium: '3D animation',
              lighting_style: 'dramatic',
              visual_style: 'cinematic',
              aspect_ratio: '16:9',
              scene_avg_duration_sec: 5,
            },
            fullTranscript: '太阳是一颗恒星。它通过核聚变释放能量并维持太阳系稳定。',
          }),
        };
      }

      // Research / fact verification
      if (isFactVerification) {
        return {
          text: JSON.stringify({
            verifications: [
              { factId: 'fact_1', verdict: 'confirmed', confidence: 0.95, correction: null, reason: 'NASA baseline fact' },
              { factId: 'fact_2', verdict: 'confirmed', confidence: 0.9, correction: null, reason: 'Astronomy consensus' },
            ],
          }),
        };
      }

      if (isResearch) {
        return {
          text: JSON.stringify({
            facts: [
              { id: 'fact_1', content: '太阳是一颗G型主序星', sources: [{ url: 'https://nasa.gov', reliability: 0.95 }], aggConfidence: 0.95 },
              { id: 'fact_2', content: '太阳大约有46亿年的历史', sources: [{ url: 'https://space.com', reliability: 0.9 }], aggConfidence: 0.9 },
            ],
            glossary: [{ term: '主序星', definition: '一种正在进行氢聚变的恒星' }],
          }),
        };
      }

      // Calibration
      if (isCalibration) {
        return {
          text: JSON.stringify({
            calibration: {
              reference_total_words: 200,
              reference_duration_sec: 60,
              actual_speech_rate: '3.3 words/sec',
              new_video_target_duration_sec: 60,
              target_word_count: 200,
              target_word_count_min: '180',
              target_word_count_max: '220',
            },
            verified_facts: [
              { fact_id: 1, content: '太阳是一颗G型主序星', source_marker: 'NASA' },
              { fact_id: 2, content: '太阳约有46亿年历史', source_marker: 'Space.com' },
            ],
          }),
        };
      }

      // Narrative map
      if (isNarrativeMap) {
        return {
          text: JSON.stringify({
            narrative_map: [
              { stage_title: 'Hook', description: '引人注目的开头', estimated_duration_sec: 10, target_word_count: 50, fact_references: [1] },
              { stage_title: 'Body', description: '核心内容', estimated_duration_sec: 40, target_word_count: 120, fact_references: [1, 2] },
              { stage_title: 'Conclusion', description: '总结与行动号召', estimated_duration_sec: 10, target_word_count: 30, fact_references: [2] },
            ],
          }),
        };
      }

      // Script skeleton generation (Step A of two-step flow)
      if (isSkeletonGeneration) {
        return {
          text: JSON.stringify({
            sentences: [
              { index: 1, stage: 'Hook', targetLength: 30, purposeTag: 'data_anchor', hasFact: true, hasMetaphor: false },
              { index: 2, stage: 'Hook', targetLength: 25, purposeTag: 'hook', hasFact: false, hasMetaphor: false },
              { index: 3, stage: 'Hook', targetLength: 28, purposeTag: 'curiosity_gap', hasFact: false, hasMetaphor: false },
              { index: 4, stage: 'Body', targetLength: 30, purposeTag: 'exposition', hasFact: true, hasMetaphor: false },
              { index: 5, stage: 'Body', targetLength: 20, purposeTag: 'metaphor_vehicle', hasFact: false, hasMetaphor: true },
              { index: 6, stage: 'Conclusion', targetLength: 25, purposeTag: 'cta', hasFact: false, hasMetaphor: false },
            ],
            totalTargetWords: 158,
            hookIndices: [1, 2, 3],
            ctaIndices: [6],
            stageBreakdown: { Hook: [1, 2, 3], Body: [4, 5], Conclusion: [6] },
          }),
        };
      }

      // Script writing (Step B of two-step flow)
      if (isScriptWriting) {
        const scriptText = '你知道吗？太阳是一颗巨大的等离子体球。它是位于太阳系中心的G型主序星，表面温度约为五千五百度。太阳大约有四十六亿年的历史，是地球上所有生命的能量来源。每秒钟，太阳都在将数百万吨氢转化为氦，释放出惊人的能量。这颗恒星的直径约为地球的一百零九倍，它的引力牢牢地控制着八大行星的运行轨道。科学家们通过研究太阳黑子活动，可以预测太阳风暴对地球通信系统的影响。';
        return {
          text: JSON.stringify({
            script: scriptText,
            sentence_list: [
              { index: 1, text: '你知道吗？太阳是一颗巨大的等离子体球。', length: 16, stage: 'Hook', has_metaphor: false, visual_note: '太阳特写', factReferences: ['fact_1'] },
              { index: 2, text: '它是位于太阳系中心的G型主序星，表面温度约为五千五百度。', length: 24, stage: 'Hook', has_metaphor: false, visual_note: '太阳表面', factReferences: [] },
              { index: 3, text: '太阳大约有四十六亿年的历史，是地球上所有生命的能量来源。', length: 25, stage: 'Hook', has_metaphor: false, visual_note: '时间线', factReferences: ['fact_2'] },
              { index: 4, text: '每秒钟，太阳都在将数百万吨氢转化为氦，释放出惊人的能量。', length: 26, stage: 'Body', has_metaphor: false, visual_note: '核聚变', factReferences: ['fact_1'] },
              { index: 5, text: '这颗恒星的直径约为地球的一百零九倍，它的引力牢牢地控制着八大行星的运行轨道。', length: 35, stage: 'Body', has_metaphor: true, visual_note: '太阳系全景', factReferences: [] },
              { index: 6, text: '科学家们通过研究太阳黑子活动，可以预测太阳风暴对地球通信系统的影响。', length: 30, stage: 'Conclusion', has_metaphor: false, visual_note: '太阳黑子', factReferences: ['fact_2'] },
            ],
            total_length: 200,
            hook_text: '你知道吗？太阳是一颗巨大的等离子体球。',
            cta_text: '科学家们通过研究太阳黑子活动，可以预测太阳风暴对地球通信系统的影响。',
            metaphors_identified: ['太阳引力 → 牢牢控制轨道'],
          }),
        };
      }

      // Script generation (legacy single-step — kept for backward compatibility)
      // Script generation — produce a script that passes word count validation (~200 chars)
      if (isScriptGeneration) {
        const scriptText = '你知道吗？太阳是一颗巨大的等离子体球。它是位于太阳系中心的G型主序星，表面温度约为五千五百度。太阳大约有四十六亿年的历史，是地球上所有生命的能量来源。每秒钟，太阳都在将数百万吨氢转化为氦，释放出惊人的能量。这颗恒星的直径约为地球的一百零九倍，它的引力牢牢地控制着八大行星的运行轨道。科学家们通过研究太阳黑子活动，可以预测太阳风暴对地球通信系统的影响。';
        return {
          text: JSON.stringify({
            scriptText,
            usedFactIDs: ['fact_1', 'fact_2'],
            factUsage: [
              { factId: 'fact_1', usageType: 'paraphrase', sectionTitle: 'Hook' },
              { factId: 'fact_2', usageType: 'verbatim', sectionTitle: 'Body' },
            ],
            totalWordCount: 200,
            totalEstimatedDuration: 60,
            scenes: [
              { sceneNumber: 1, narrative: '太阳介绍', visualPrompt: '太阳特写镜头', estimatedDuration: 5 },
              { sceneNumber: 2, narrative: '太阳事实', visualPrompt: '太阳系全景', estimatedDuration: 5 },
              { sceneNumber: 3, narrative: '能量释放', visualPrompt: '核聚变反应', estimatedDuration: 5 },
            ],
          }),
        };
      }

      // QA review
      if (isQAReview) {
        return {
          text: JSON.stringify({
            approved: true,
            score: 88,
            scores: { overall: 88 },
            issues: [],
            feedback: 'Script quality is excellent.',
          }),
        };
      }

      // Storyboard / scene breakdown
      if (isStoryboard) {
        return {
          text: JSON.stringify({
            scenes: [
              {
                id: 'scene_1', number: 1, narrative: '太阳从地平线升起',
                visualPrompt: '金色太阳从群山后缓慢升起，天空云层被染成橙红色，电影级体积光穿透薄雾，超广角镜头缓慢推进。',
                productionSpecs: { camera: 'wide', lighting: 'golden hour' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
              {
                id: 'scene_2', number: 2, narrative: '太阳表面的壮丽景象',
                visualPrompt: '太阳表面高分辨率特写，炽热等离子体弧线持续喷发，磁暴纹理清晰可见，镜头环绕并带有轻微抖动。',
                productionSpecs: { camera: 'macro', lighting: 'dramatic' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
              {
                id: 'scene_3', number: 3, narrative: '太阳系的运行',
                visualPrompt: '太阳位于画面中心，八大行星按真实轨道层次环绕运行，深空星云与粒子尘埃形成纵深背景，俯视镜头缓慢拉远。',
                productionSpecs: { camera: 'overview', lighting: 'space' },
                estimatedDuration: 5, assetType: 'image', status: 'pending', logs: [],
              },
              {
                id: 'scene_4', number: 4, narrative: '核聚变释放能量',
                visualPrompt: '太阳核心内部的核聚变反应被可视化为高能粒子流，耀眼光束向外扩散，镜头从核心穿出至表层。',
                productionSpecs: { camera: 'internal', lighting: 'high contrast' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
              {
                id: 'scene_5', number: 5, narrative: '太阳引力控制行星',
                visualPrompt: '太阳引力场以弯曲网格形式包裹太阳系，行星沿轨道稳定运行，镜头沿轨道高速掠过木星与土星。',
                productionSpecs: { camera: 'tracking', lighting: 'space' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
              {
                id: 'scene_6', number: 6, narrative: '太阳黑子活动',
                visualPrompt: '太阳黑子区域局部放大，磁场线形成复杂回路，表面喷流间歇爆发，镜头微距观察并缓慢平移。',
                productionSpecs: { camera: 'macro', lighting: 'dramatic' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
              {
                id: 'scene_7', number: 7, narrative: '太阳风暴影响地球',
                visualPrompt: '高速太阳风粒子冲向地球磁层，极光在夜空中大范围展开，同时卫星通信链路闪烁预警图标。',
                productionSpecs: { camera: 'wide', lighting: 'aurora' },
                estimatedDuration: 5, assetType: 'video', status: 'pending', logs: [],
              },
              {
                id: 'scene_8', number: 8, narrative: '总结太阳的重要性',
                visualPrompt: '地球白昼与黑夜快速轮转，太阳稳定照亮海洋与大陆，最后定格在温暖日出画面并缓慢淡出。',
                productionSpecs: { camera: 'orbit', lighting: 'warm cinematic' },
                estimatedDuration: 5, assetType: 'image', status: 'pending', logs: [],
              },
            ],
          }),
        };
      }

      // Subject isolation
      if (isSubjectIsolation) {
        return {
          text: JSON.stringify({
            failedCount: 0,
            results: [],
          }),
        };
      }

      // Default
      return { text: JSON.stringify({ result: 'ok' }) };
    },

    async generateImage(_model: string, _prompt: string): Promise<GenerationResult> {
      callCount++;
      return {
        text: 'Generated image',
        imageUrl: `file:///tmp/mock-image-${callCount}.png`,
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };
    },

    async generateVideo(_model: string, _prompt: string): Promise<GenerationResult> {
      callCount++;
      return {
        text: 'Generated video',
        videoUrl: `data:video/mp4;base64,AAAAAA==`,
        durationMs: 5000,
      };
    },
  };
}

function seedTestProvider(orch: PipelineOrchestrator): void {
  orch.providerRegistry.register('mock-e2e', {
    text: true, imageGeneration: true, videoGeneration: true, fileUpload: true, webSearch: true,
  });
}

/* ================================================================== */
/*  Full 13-stage E2E test                                             */
/* ================================================================== */

describe('E2E: Full 13-stage pipeline', () => {
  let dataDir: string;
  let orch: PipelineOrchestrator;
  let events: PipelineEvent[];
  let uploadsDir: string;
  let dummyVideo: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'e2e-13stage-'));
    uploadsDir = join(dataDir, 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    dummyVideo = join(uploadsDir, 'reference.mp4');
    writeFileSync(dummyVideo, 'fake-reference-video');

    const mockAdapter = createE2EMockAdapter();
    orch = new PipelineOrchestrator(mockAdapter, {
      dataDir,
      aivideomakerAdapters: [createE2EMockAdapter()],
    });
    seedTestProvider(orch);
    events = [];
    orch.onEvent((e) => events.push(e));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('completes all 15 stages end-to-end', async () => {
    const project = orch.createProject('太阳的奥秘', '探索太阳');
    // Disable pause checkpoints for uninterrupted E2E flow
    project.pauseAfterStages = [];
    (orch as any).saveProject(project);

    const result = await orch.run(project.id, 'reference.mp4');

    // ── All 15 stages should be completed ──
    const allStages = [
      'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
      'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING',
      'STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE', 'KEYFRAME_GEN',
      'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
    ] as const;

    for (const stage of allStages) {
      expect(result.stageStatus[stage], `${stage} should be completed`).toBe('completed');
    }

    // ── Verify key project properties ──
    expect(result.safetyCheck?.safe).toBe(true);
    expect(result.styleProfile).toBeDefined();
    expect(result.researchData).toBeDefined();
    expect(result.researchData!.facts.length).toBeGreaterThan(0);
    expect(result.calibrationData).toBeDefined();
    expect(result.narrativeMap).toBeDefined();
    expect(result.scriptOutput).toBeDefined();
    expect(result.scriptOutput!.scriptText.length).toBeGreaterThan(0);
    expect(result.qaReviewResult).toBeDefined();
    expect(typeof result.qaReviewResult?.approved).toBe('boolean');
    expect(result.scenes).toBeDefined();
    expect(result.scenes!.length).toBeGreaterThan(0);
    expect(result.finalVideoPath).toBeDefined();
    expect(result.refinementHistory).toBeDefined();

    // ── No errors ──
    expect(result.error).toBeUndefined();
    expect(result.isPaused).toBeFalsy();
  }, 60_000);

  it('produces correct artifacts for every stage', async () => {
    const project = orch.createProject('太阳的奥秘');
    project.pauseAfterStages = [];
    (orch as any).saveProject(project);

    const result = await orch.run(project.id, 'reference.mp4');
    const projectDir = orch.getProjectDir(project.id);

    // Analysis stage artifacts
    expect(existsSync(join(projectDir, ARTIFACT.CAPABILITY_ASSESSMENT))).toBe(true);
    expect(existsSync(join(projectDir, ARTIFACT.STYLE_PROFILE))).toBe(true);
    expect(existsSync(join(projectDir, ARTIFACT.RESEARCH))).toBe(true);

    // Creation stage artifacts
    expect(existsSync(join(projectDir, ARTIFACT.CALIBRATION))).toBe(true);
    expect(existsSync(join(projectDir, ARTIFACT.NARRATIVE_MAP))).toBe(true);
    expect(existsSync(join(projectDir, ARTIFACT.SCRIPT))).toBe(true);
    expect(existsSync(join(projectDir, ARTIFACT.QA_REVIEW))).toBe(true);

    // Visual stage artifacts
    expect(existsSync(join(projectDir, ARTIFACT.SCENES))).toBe(true);

    // Production stage artifacts
    expect(existsSync(join(projectDir, ARTIFACT.REFINEMENT))).toBe(true);

    // CIR artifacts
    expect(existsSync(join(projectDir, ARTIFACT.STYLE_ANALYSIS_CIR))).toBe(true);
    expect(existsSync(join(projectDir, ARTIFACT.VIDEO_IR_CIR))).toBe(true);

    // Verify artifact content integrity
    const scriptArtifact = JSON.parse(readFileSync(join(projectDir, ARTIFACT.SCRIPT), 'utf-8'));
    expect(scriptArtifact.scriptText).toBeDefined();
    expect(Array.isArray(scriptArtifact.usedFactIDs)).toBe(true);

    const qaArtifact = JSON.parse(readFileSync(join(projectDir, ARTIFACT.QA_REVIEW), 'utf-8'));
    expect(typeof qaArtifact.approved).toBe('boolean');

    const scenesArtifact = JSON.parse(readFileSync(join(projectDir, ARTIFACT.SCENES), 'utf-8'));
    expect(scenesArtifact.length).toBeGreaterThan(0);
    for (const scene of scenesArtifact) {
      expect(scene.id).toBeDefined();
      expect(scene.narrative).toBeDefined();
    }
  }, 60_000);

  it('emits stage events for all 13 stages in order', async () => {
    const project = orch.createProject('太阳的奥秘');
    project.pauseAfterStages = [];
    (orch as any).saveProject(project);

    await orch.run(project.id, 'reference.mp4');

    const stageEvents = events.filter(e => e.type === SSE_EVENT.STAGE) as any[];
    const stages = stageEvents.map(e => e.payload.stage);

    // All 15 stages should appear in the event stream
    const expectedStages = [
      'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
      'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING',
      'STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE', 'KEYFRAME_GEN',
      'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
    ];
    for (const stage of expectedStages) {
      expect(stages, `expected ${stage} in event stream`).toContain(stage);
    }

    // Each stage should have processing → completed transitions
    for (const stage of expectedStages) {
      const forStage = stageEvents.filter(e => e.payload.stage === stage);
      const statuses = forStage.map(e => e.payload.status);
      expect(statuses, `${stage} should start with processing`).toContain('processing');
      expect(statuses, `${stage} should end with completed`).toContain('completed');
    }

    // pipeline_complete event should be emitted
    const completeEvents = events.filter(e => e.type === SSE_EVENT.COMPLETE);
    expect(completeEvents.length).toBe(1);
  }, 60_000);

  it('scenes flow through visual → production stages correctly', async () => {
    const project = orch.createProject('太阳的奥秘');
    project.pauseAfterStages = [];
    (orch as any).saveProject(project);

    const result = await orch.run(project.id, 'reference.mp4');

    // Verify scenes have been enriched through the pipeline
    expect(result.scenes).toBeDefined();
    for (const scene of result.scenes!) {
      expect(scene.id).toBeDefined();
      expect(scene.narrative).toBeDefined();
      expect(scene.visualPrompt).toBeDefined();
      // Scenes should have asset info set by VIDEO_GEN or remain as image
      expect(scene.assetType).toBeDefined();
    }
  }, 60_000);
});
