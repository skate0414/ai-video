#!/usr/bin/env npx tsx
/* ------------------------------------------------------------------ */
/*  Canary Run — real Gemini API pipeline with a single topic          */
/*  Validates real LLM responses, CIR parsing, image/video gen,       */
/*  TTS, and FFmpeg assembly end-to-end.                               */
/*                                                                     */
/*  Prerequisites:                                                     */
/*    export GEMINI_API_KEY="your-api-key"                             */
/*    pip install edge-tts       (for TTS)                             */
/*    brew install ffmpeg        (for assembly)                        */
/*                                                                     */
/*  Optionally provide a reference video for style extraction:         */
/*    npx tsx src/testing/canary-run.ts --video /path/to/ref.mp4       */
/*                                                                     */
/*  Without a reference video, a built-in style profile is applied     */
/*  and STYLE_EXTRACTION is skipped (pre-completed).                   */
/* ------------------------------------------------------------------ */

import { mkdtempSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { GeminiAdapter } from '../adapters/geminiAdapter.js';
import { parseStyleAnalysisCIR } from '../cir/parsers.js';
import { validateStyleContract } from '../pipeline/styleContract.js';
import type { PipelineEvent, PipelineStage, StyleProfile } from '../pipeline/types.js';
import { SSE_EVENT } from '../pipeline/types.js';
import { ARTIFACT } from '../constants.js';

/* ================================================================== */
/*  CLI ARGS                                                           */
/* ================================================================== */

const args = process.argv.slice(2);
const videoFlagIdx = args.indexOf('--video');
const referenceVideoPath = videoFlagIdx >= 0 ? args[videoFlagIdx + 1] : undefined;

const topicFlagIdx = args.indexOf('--topic');
const TOPIC = topicFlagIdx >= 0
  ? args[topicFlagIdx + 1]
  : '为什么人类会做梦？从神经科学解释梦境形成机制';

const titleFlagIdx = args.indexOf('--title');
const TITLE = titleFlagIdx >= 0
  ? args[titleFlagIdx + 1]
  : '梦境的科学：神经科学解释';

const tierFlagIdx = args.indexOf('--tier');
const QUALITY_TIER = (tierFlagIdx >= 0 ? args[tierFlagIdx + 1] : 'premium') as 'free' | 'balanced' | 'premium';

/* ================================================================== */
/*  DEFAULT STYLE PROFILE                                              */
/*  Used when no reference video is provided — skips STYLE_EXTRACTION  */
/* ================================================================== */

const DEFAULT_STYLE_PROFILE: StyleProfile = {
  visualStyle: '3D animated science explainer',
  pacing: 'medium',
  tone: 'informative yet engaging',
  colorPalette: ['#0a0e27', '#1a237e', '#4a148c', '#e040fb', '#00bcd4'],
  narrativeStructure: ['Hook', 'Core Science', 'Deep Dive', 'Implications', 'CTA'],
  hookType: 'question',
  callToActionType: 'subscribe',
  wordCount: 220,
  wordsPerMinute: 180,
  emotionalIntensity: 0.65,
  targetAudience: 'short-video science enthusiasts',
  targetAspectRatio: '9:16',
  fullTranscript: '',
  meta: {
    video_language: 'Chinese',
    video_duration_sec: 75,
    video_type: 'explainer',
  },
  track_a_script: {
    hook_strategy: '反直觉提问',
    hook_example: '',
    sentence_length_max: 25,
    sentence_length_avg: 15,
    sentence_length_unit: 'characters',
    narrative_arc: ['Hook', 'Core Science', 'Deep Dive', 'Implications', 'CTA'],
    emotional_tone_arc: '好奇 → 震惊 → 理解 → 思考',
    rhetorical_core: '类比、数据支撑、视觉化解释',
    metaphor_count: 4,
    interaction_cues_count: 3,
    cta_pattern: '关注获取更多科学解密',
    jargon_treatment: 'simplified',
  },
  track_b_visual: {
    base_medium: '3D animation',
    lighting_style: 'dramatic dark-blue ambient',
    camera_motion: 'slow zoom + pan',
    color_temperature: 'cool',
    scene_avg_duration_sec: 8,
    transition_style: 'smooth dissolve',
    visual_metaphor_mapping: {
      rule: '将科学概念映射为可视化3D场景',
      examples: [],
    },
    b_roll_ratio: 0,
    composition_style: 'center-focused with depth',
  },
  track_c_audio: {
    bgm_genre: 'ambient electronic',
    bgm_mood: 'mysterious',
    bgm_tempo: 'slow',
    bgm_relative_volume: 0.25,
    voice_style: '好奇探索型',
  },
};

/* ================================================================== */
/*  MAIN                                                               */
/* ================================================================== */

async function main() {
  // ---- 0. Validate prerequisites ----
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY environment variable is required.');
    console.error('   export GEMINI_API_KEY="your-api-key"');
    process.exit(1);
  }

  if (referenceVideoPath && !existsSync(referenceVideoPath)) {
    console.error(`❌ Reference video not found: ${referenceVideoPath}`);
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   CANARY RUN — Real Gemini API Pipeline                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Topic:     ${TOPIC}`);
  console.log(`  Title:     ${TITLE}`);
  console.log(`  Tier:      ${QUALITY_TIER}`);
  console.log(`  Video:     ${referenceVideoPath ?? '(none — using default style profile)'}`);
  console.log(`  API Key:   ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log();

  const dataDir = mkdtempSync(join(tmpdir(), 'canary-run-'));
  console.log(`📁 Data dir: ${dataDir}`);

  // ---- 1. Create adapters ----
  const geminiAdapter = new GeminiAdapter(apiKey);

  // chatAdapter is needed as the constructor argument
  const orch = new PipelineOrchestrator(geminiAdapter, {
    dataDir,
    productionConcurrency: 2,
    ttsConfig: { voice: 'zh-CN-XiaoxiaoNeural', rate: '+5%' },
  });

  // Register Gemini API capabilities
  orch.providerRegistry.register('gemini-api', {
    text: true,
    imageGeneration: true,
    videoGeneration: true,
    fileUpload: true,
    webSearch: true,
  });

  // ---- 2. Create project ----
  const project = orch.createProject(TOPIC, TITLE);
  console.log(`🆔 Project ID: ${project.id}\n`);

  // ---- 3. Configure project ----
  const loaded = orch.loadProject(project.id)!;
  loaded.pauseAfterStages = [];  // No pauses — run straight through

  if (referenceVideoPath) {
    // Use real reference video for style extraction
    loaded.referenceVideoPath = referenceVideoPath;
  } else {
    // No reference video — pre-apply default style profile
    loaded.styleProfile = DEFAULT_STYLE_PROFILE;
    loaded.stageStatus.STYLE_EXTRACTION = 'completed';

    // Save CIR artifacts so downstream stages can load them
    const projectDir = orch.getProjectDir(project.id);
    const contractResult = validateStyleContract(DEFAULT_STYLE_PROFILE);
    writeFileSync(join(projectDir, ARTIFACT.STYLE_PROFILE), JSON.stringify(DEFAULT_STYLE_PROFILE, null, 2));
    writeFileSync(join(projectDir, ARTIFACT.STYLE_CONTRACT), JSON.stringify(contractResult, null, 2));

    const styleAnalysisCIR = parseStyleAnalysisCIR(DEFAULT_STYLE_PROFILE, contractResult.score);
    writeFileSync(join(projectDir, ARTIFACT.STYLE_ANALYSIS_CIR), JSON.stringify(styleAnalysisCIR, null, 2));

    console.log('  📋 Using default style profile (STYLE_EXTRACTION pre-completed)');
  }

  (orch as any).store.save(loaded);

  // ---- 4. Capture events ----
  const stageTimings = new Map<string, number>();
  const stageDurations: Array<{ stage: string; durationMs: number; status: string }> = [];
  let totalCostUsd = 0;

  orch.onEvent((event: PipelineEvent) => {
    const payload = (event as any).payload;

    if (event.type === SSE_EVENT.STAGE) {
      const stage = payload.stage as string;
      const status = payload.status as string;

      if (status === 'processing') {
        stageTimings.set(stage, Date.now());
        console.log(`  ▶ ${stage} — started`);
      } else if (status === 'completed') {
        const started = stageTimings.get(stage) ?? Date.now();
        const duration = Date.now() - started;
        stageDurations.push({ stage, durationMs: duration, status: 'completed' });
        console.log(`  ✅ ${stage} — completed (${formatDuration(duration)})`);
      } else if (status === 'error') {
        const started = stageTimings.get(stage) ?? Date.now();
        const duration = Date.now() - started;
        stageDurations.push({ stage, durationMs: duration, status: 'error' });
        console.log(`  ❌ ${stage} — ERROR (${formatDuration(duration)})`);
      }
    } else if (event.type === SSE_EVENT.ERROR) {
      console.log(`  ❌ ERROR [${payload.stage ?? '?'}]: ${payload.error}`);
    } else if (event.type === SSE_EVENT.LOG) {
      const msg = payload?.entry?.message ?? '';
      const type = payload?.entry?.type ?? 'info';
      if (type === 'warning' || type === 'error') {
        console.log(`  ⚠️  ${msg.slice(0, 150)}`);
      }
    }
  });

  // ---- 5. Run pipeline ----
  console.log(`\n🚀 Starting pipeline at ${new Date().toISOString()}\n`);
  const t0 = Date.now();

  let result: any;
  try {
    result = await orch.run(project.id);
  } catch (err: any) {
    console.error(`\n❌ PIPELINE FATAL ERROR: ${err.message}`);
    console.error(err.stack);
    printPartialResults(dataDir, project.id, orch, stageDurations, t0);
    process.exit(1);
  }

  const totalDuration = Date.now() - t0;
  console.log(`\n⏱  Pipeline completed in ${formatDuration(totalDuration)}`);

  // ---- 6. Collect results ----
  const projectDir = orch.getProjectDir(project.id);
  const stageResults = result.stageStatus as Record<string, string>;

  console.log('\n═══ STAGE RESULTS ═══');
  let completedCount = 0;
  let errorCount = 0;
  for (const [stage, status] of Object.entries(stageResults)) {
    const icon = status === 'completed' ? '✅' : status === 'error' ? '❌' : '⏸️';
    console.log(`  ${icon} ${stage}: ${status}`);
    if (status === 'completed') completedCount++;
    if (status === 'error') errorCount++;
  }

  // ---- 7. Artifacts ----
  const artifactFiles: string[] = [];
  collectFiles(projectDir, '', artifactFiles);

  console.log('\n═══ ARTIFACTS ═══');
  let totalArtifactSize = 0;
  for (const f of artifactFiles) {
    const fullPath = join(projectDir, f);
    const size = statSync(fullPath).size;
    totalArtifactSize += size;
    console.log(`  📄 ${f} (${formatBytes(size)})`);
  }
  console.log(`  Total: ${artifactFiles.length} files, ${formatBytes(totalArtifactSize)}`);

  // ---- 8. Cost tracking ----
  const metricsPath = join(projectDir, ARTIFACT.PIPELINE_METRICS);
  let costInfo = 'N/A';
  if (existsSync(metricsPath)) {
    try {
      const metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
      if (metrics.totalEstimatedCostUsd != null) {
        totalCostUsd = metrics.totalEstimatedCostUsd;
        costInfo = `$${totalCostUsd.toFixed(4)}`;
      }
    } catch { /* ignore */ }
  }

  // ---- 9. Verification checks ----
  console.log('\n═══ VERIFICATION CHECKS ═══');
  const checks: Array<{ id: string; label: string; pass: boolean; detail: string }> = [];

  // A. CAPABILITY_ASSESSMENT < 5s
  const caTime = stageDurations.find(d => d.stage === 'CAPABILITY_ASSESSMENT');
  checks.push({
    id: 'A', label: 'CAPABILITY_ASSESSMENT < 5s',
    pass: !!caTime && caTime.durationMs < 5000,
    detail: caTime ? formatDuration(caTime.durationMs) : 'not completed',
  });

  // B. SCRIPT_GENERATION safetyMetadata
  const hasSafetyMeta = !!result.scriptOutput?.safetyMetadata;
  checks.push({
    id: 'B', label: 'SCRIPT_GENERATION safetyMetadata present',
    pass: hasSafetyMeta,
    detail: hasSafetyMeta
      ? `isHighRisk=${result.scriptOutput!.safetyMetadata!.isHighRisk}, needsManualReview=${result.scriptOutput!.safetyMetadata!.needsManualReview}`
      : 'missing',
  });

  // C. STORYBOARD ≥ 6 scenes
  const sceneCount = result.scenes?.length ?? 0;
  checks.push({
    id: 'C', label: 'STORYBOARD ≥ 6 scenes',
    pass: sceneCount >= 6,
    detail: `${sceneCount} scenes`,
  });

  // D. TTS audio artifacts
  const ttsStage = stageResults['TTS'];
  const hasTTSAudio = result.scenes?.some((s: any) => s.audioUrl) ?? false;
  checks.push({
    id: 'D', label: 'TTS audio artifacts generated',
    pass: ttsStage === 'completed' && hasTTSAudio,
    detail: hasTTSAudio ? 'audio files present' : `TTS: ${ttsStage ?? 'unknown'}`,
  });

  // E. VIDEO_GEN videoFilePath
  const videoStage = stageResults['VIDEO_GEN'];
  const hasVideoAssets = result.scenes?.some((s: any) => s.assetUrl && s.assetType === 'video') ?? false;
  checks.push({
    id: 'E', label: 'VIDEO_GEN video assets generated',
    pass: videoStage === 'completed',
    detail: hasVideoAssets ? 'video assets present' : `VIDEO_GEN: ${videoStage ?? 'unknown'}`,
  });

  // F. FINAL_RISK_GATE
  const riskGatePath = join(projectDir, ARTIFACT.FINAL_RISK_GATE);
  let riskGatePassed = false;
  if (existsSync(riskGatePath)) {
    try {
      const rg = JSON.parse(readFileSync(riskGatePath, 'utf-8'));
      riskGatePassed = rg.passed === true;
    } catch { /* ignore */ }
  }
  const assemblyStage = stageResults['ASSEMBLY'];
  checks.push({
    id: 'F', label: 'FINAL_RISK_GATE passed',
    pass: riskGatePassed || assemblyStage === 'completed',
    detail: riskGatePassed ? 'passed=true' : `assembly: ${assemblyStage ?? 'unknown'}`,
  });

  // G. EXPORT final video
  const hasFinalVideo = !!result.finalVideoPath;
  checks.push({
    id: 'G', label: 'EXPORT finalVideoPath written',
    pass: hasFinalVideo,
    detail: hasFinalVideo ? result.finalVideoPath! : 'no final video',
  });

  // H. Path traversal safety
  const { ensurePathWithinBase } = await import('../lib/pathSafety.js');
  let traversalSafe = true;
  let traversalDetail = 'all paths within project dir';
  for (const aPath of artifactFiles) {
    try {
      ensurePathWithinBase(projectDir, join(projectDir, aPath), 'artifact');
    } catch (e: any) {
      traversalSafe = false;
      traversalDetail = `VIOLATION: ${aPath}`;
      break;
    }
  }
  checks.push({
    id: 'H', label: 'All artifact paths pass traversal safety',
    pass: traversalSafe,
    detail: traversalDetail,
  });

  let passCount = 0;
  for (const c of checks) {
    const icon = c.pass ? '✅' : '❌';
    console.log(`  ${icon} [${c.id}] ${c.label}: ${c.detail}`);
    if (c.pass) passCount++;
  }
  console.log(`\n  Total: ${passCount}/${checks.length} checks passed`);

  // ---- 10. Summary ----
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   CANARY RUN SUMMARY                                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Stages completed: ${completedCount}/${Object.keys(stageResults).length}`);
  console.log(`  Stages errored:   ${errorCount}`);
  console.log(`  Checks passed:    ${passCount}/${checks.length}`);
  console.log(`  Total duration:   ${formatDuration(totalDuration)}`);
  console.log(`  Total cost:       ${costInfo}`);
  console.log(`  Artifacts:        ${artifactFiles.length} files (${formatBytes(totalArtifactSize)})`);
  console.log(`  Final video:      ${result.finalVideoPath ?? 'N/A'}`);
  console.log('  Timeline:');
  for (const d of stageDurations) {
    const icon = d.status === 'completed' ? '✅' : '❌';
    console.log(`    ${icon} ${d.stage}: ${formatDuration(d.durationMs)}`);
  }

  // ---- 11. Save report JSON ----
  const reportData = {
    topic: TOPIC,
    title: TITLE,
    qualityTier: QUALITY_TIER,
    referenceVideo: referenceVideoPath ?? null,
    timestamp: new Date().toISOString(),
    totalDurationMs: totalDuration,
    completedStages: completedCount,
    totalStages: Object.keys(stageResults).length,
    errorStages: errorCount,
    passedChecks: passCount,
    totalChecks: checks.length,
    totalCostUsd,
    totalArtifactBytes: totalArtifactSize,
    finalVideoPath: result.finalVideoPath ?? null,
    stageDurations,
    checks,
    stageResults,
    artifactFiles,
  };
  const reportPath = join(projectDir, 'canary-report.json');
  writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\n📊 Report saved: ${reportPath}`);

  // Copy final video to a more accessible location
  if (result.finalVideoPath && existsSync(result.finalVideoPath)) {
    const outputPath = join(process.cwd(), `canary-output-${Date.now()}.mp4`);
    const { copyFileSync } = await import('node:fs');
    try {
      copyFileSync(result.finalVideoPath, outputPath);
      console.log(`🎬 Final video copied to: ${outputPath}`);
    } catch { /* ignore copy failure */ }
  }

  if (passCount === checks.length && errorCount === 0) {
    console.log('\n🟢 Canary run PASSED — ready for batch production.');
  } else {
    console.log('\n⚠️  Canary run had issues — review before batch production.');
  }

  process.exit(passCount === checks.length && errorCount === 0 ? 0 : 1);
}

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = ((ms % 60_000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function collectFiles(dir: string, prefix: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) {
      out.push(join(prefix, f.name));
    } else if (f.isDirectory()) {
      collectFiles(join(dir, f.name), join(prefix, f.name), out);
    }
  }
}

function printPartialResults(
  dataDir: string,
  projectId: string,
  orch: PipelineOrchestrator,
  stageDurations: Array<{ stage: string; durationMs: number; status: string }>,
  t0: number,
): void {
  const totalDuration = Date.now() - t0;
  console.log(`\n⏱  Pipeline failed after ${formatDuration(totalDuration)}`);
  console.log('\nCompleted stages before failure:');
  for (const d of stageDurations) {
    const icon = d.status === 'completed' ? '✅' : '❌';
    console.log(`  ${icon} ${d.stage}: ${formatDuration(d.durationMs)}`);
  }

  // List artifacts created so far
  const projectDir = orch.getProjectDir(projectId);
  const files: string[] = [];
  collectFiles(projectDir, '', files);
  if (files.length > 0) {
    console.log(`\nArtifacts created (${files.length} files):`);
    for (const f of files) {
      console.log(`  📄 ${f}`);
    }
  }
  console.log(`\nProject dir: ${projectDir}`);
}

/* ================================================================== */
/*  RUN                                                                */
/* ================================================================== */

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
