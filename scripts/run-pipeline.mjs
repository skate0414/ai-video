#!/usr/bin/env node

/**
 * 独立后端视频生成脚本 (Standalone Backend Pipeline Runner)
 *
 * 使用 Gemini API (Premium 模式) 运行完整的视频生成流水线，
 * 无需 Electron 或浏览器，只需要后端即可。
 *
 * 前置条件:
 *   - GEMINI_API_KEY 环境变量 (Google AI Studio API Key)
 *   - FFmpeg (brew install ffmpeg)
 *   - edge-tts (pip install edge-tts)
 *
 * 用法:
 *   GEMINI_API_KEY=your-key node scripts/run-pipeline.mjs
 *   GEMINI_API_KEY=your-key node scripts/run-pipeline.mjs --topic "你的主题" --video /path/to/video.mov
 */

import { fork } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/* ------------------------------------------------------------------ */
/*  Configuration                                                     */
/* ------------------------------------------------------------------ */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌ 请设置 GEMINI_API_KEY 环境变量');
  console.error('');
  console.error('   获取 API Key: https://aistudio.google.com/apikey');
  console.error('   然后运行:');
  console.error('   GEMINI_API_KEY=你的key node scripts/run-pipeline.mjs');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
function getArgValue(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const TOPIC = getArgValue('--topic') || '生而为人有多难得';
const SAMPLE_VIDEO_PATH = getArgValue('--video') ||
  join(process.env.HOME, 'Library/Application Support/ai-video-browser-shell/data/uploads/1775932775232_你的身体有多爱你.mov');

const PORT = 3221; // Use a different port to avoid conflict with dev server
const SERVER_URL = `http://localhost:${PORT}`;
const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = join(PROJECT_ROOT, 'data-standalone');

/* ------------------------------------------------------------------ */
/*  Setup standalone data directory                                   */
/* ------------------------------------------------------------------ */

function setupDataDir() {
  console.log('📁 Setting up standalone data directory...');

  // Create directory structure
  for (const sub of ['profiles/gemini', 'uploads', 'projects', 'assets']) {
    mkdirSync(join(DATA_DIR, sub), { recursive: true });
  }

  // 1. config.json — Gemini API key + premium quality tier
  writeFileSync(join(DATA_DIR, 'config.json'), JSON.stringify({
    geminiApiKey: GEMINI_API_KEY,
    qualityTier: 'premium',
    _schemaVersion: 2,
  }, null, 2));

  // 2. resources.json — minimal gemini account with valid profile dir
  writeFileSync(join(DATA_DIR, 'resources.json'), JSON.stringify([
    {
      id: 'acc_standalone_gemini',
      type: 'chat',
      provider: 'gemini',
      label: 'Gemini (API)',
      siteUrl: 'https://gemini.google.com/app',
      profileDir: join(DATA_DIR, 'profiles/gemini'),
      quotaExhausted: false,
      capabilities: { text: true },
    },
  ], null, 2));

  // 3. provider-presets.json — copy from bundled data but enable video gen for gemini
  const bundledPresets = JSON.parse(readFileSync(join(PROJECT_ROOT, 'data/provider-presets.json'), 'utf-8'));
  if (bundledPresets.gemini) {
    bundledPresets.gemini.videoGeneration = true; // Enable Veo via API
    bundledPresets.gemini.tts = true; // Enable Gemini TTS via API
  }
  writeFileSync(join(DATA_DIR, 'provider-presets.json'), JSON.stringify(bundledPresets, null, 2));

  // 4. models.json — copy from bundled data
  copyFileSync(join(PROJECT_ROOT, 'data/models.json'), join(DATA_DIR, 'models.json'));

  // 5. Copy sample video to uploads
  if (!existsSync(SAMPLE_VIDEO_PATH)) {
    console.error(`❌ 样本视频文件不存在: ${SAMPLE_VIDEO_PATH}`);
    console.error('   请使用 --video /path/to/video.mov 指定样本视频路径');
    process.exit(1);
  }

  const videoFilename = `standalone_${basename(SAMPLE_VIDEO_PATH)}`;
  const destVideo = join(DATA_DIR, 'uploads', videoFilename);
  if (!existsSync(destVideo)) {
    console.log(`📹 Copying sample video: ${basename(SAMPLE_VIDEO_PATH)}`);
    copyFileSync(SAMPLE_VIDEO_PATH, destVideo);
  }

  console.log(`✅ Data directory ready: ${DATA_DIR}`);
  return videoFilename;
}

/* ------------------------------------------------------------------ */
/*  Server lifecycle                                                  */
/* ------------------------------------------------------------------ */

/** Start the backend server as a child process. */
function startServer() {
  console.log('🚀 Starting backend server...');

  const child = fork(join(PROJECT_ROOT, 'src/server.ts'), [], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DATA_DIR: DATA_DIR,
      PORT: String(PORT),
      GEMINI_API_KEY: GEMINI_API_KEY,
      // Do NOT set ELECTRON_SHELL — we want standalone mode
    },
    execArgv: ['--import', 'tsx'],
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  child.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.log(`  [server] ${line}`);
  });

  child.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && !line.includes('ExperimentalWarning')) {
      console.error(`  [server] ${line}`);
    }
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`❌ Server exited with code ${code}`);
    }
  });

  return child;
}

/** Wait for server to be ready via health check. */
async function waitForServer(maxWaitMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(`${SERVER_URL}/health`);
      if (resp.ok) {
        console.log('✅ Server is ready');
        return;
      }
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }
  throw new Error('Server did not start within 30 seconds');
}

/* ------------------------------------------------------------------ */
/*  HTTP API helpers                                                  */
/* ------------------------------------------------------------------ */

async function postJson(path, body) {
  const resp = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : null;
  if (!resp.ok) {
    throw new Error(`POST ${path} failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function getJson(path) {
  const resp = await fetch(`${SERVER_URL}${path}`);
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

/* ------------------------------------------------------------------ */
/*  Pipeline execution                                                */
/* ------------------------------------------------------------------ */

function formatElapsed(startMs) {
  const elapsed = Math.max(0, Math.round((Date.now() - startMs) / 1000));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const STAGE_LABELS = {
  CAPABILITY_ASSESSMENT: '安全评估',
  STYLE_EXTRACTION: '风格提取',
  RESEARCH: '主题研究',
  NARRATIVE_MAP: '叙事结构',
  CALIBRATION: '校准',
  SCRIPT_GENERATION: '脚本生成',
  FACT_VERIFICATION: '事实核查',
  QA_REVIEW: '质量审核',
  STORYBOARD: '分镜脚本',
  REFERENCE_IMAGE: '参考图生成',
  KEYFRAME_GEN: '关键帧生成',
  VIDEO_GEN: '视频生成',
  TTS: '语音合成',
  ASSEMBLY: '视频组装',
  REFINEMENT: '最终检查',
};

async function runPipeline(videoFilename) {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📽️  主题: ${TOPIC}`);
  console.log(`🎬  样本视频: ${basename(SAMPLE_VIDEO_PATH)}`);
  console.log(`🔧  模式: Premium (Gemini API)`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // Step 1: Create project
  console.log('📋 Creating project...');
  const project = await postJson('/api/pipeline', {
    topic: TOPIC,
    title: TOPIC,
    qualityTier: 'premium',
  });
  console.log(`✅ Project created: ${project.id}`);

  // Step 2: Start pipeline
  console.log('▶️  Starting pipeline...');
  await postJson(`/api/pipeline/${project.id}/start`, {
    videoFilePath: videoFilename,
  });
  console.log('✅ Pipeline started');
  console.log('');

  // Step 3: Monitor progress
  const startTime = Date.now();
  let lastState = '';
  let lastHandledPause = '';
  let lastLogCount = 0;

  while (true) {
    const proj = await getJson(`/api/pipeline/${project.id}`);

    // Build state string
    const currentStage = proj.currentStage || '(awaiting)';
    const currentStatus = proj.currentStatus || 'pending';
    const stageLabel = STAGE_LABELS[currentStage] || currentStage;
    const currentState = `${currentStage}:${currentStatus}:paused=${Boolean(proj.isPaused)}`;

    // Print state changes
    if (currentState !== lastState) {
      lastState = currentState;
      const statusIcon = currentStatus === 'completed' ? '✅'
        : currentStatus === 'processing' ? '⏳'
        : currentStatus === 'failed' ? '❌'
        : '⬜';
      console.log(`[${formatElapsed(startTime)}] ${statusIcon} ${stageLabel} (${currentStage}) — ${currentStatus}`);
    }

    // Print new log entries
    if (proj.logs && proj.logs.length > lastLogCount) {
      for (let i = lastLogCount; i < proj.logs.length; i++) {
        const log = proj.logs[i];
        const icon = log.type === 'error' ? '🔴' : log.type === 'warning' ? '🟡' : log.type === 'success' ? '🟢' : '📝';
        console.log(`  ${icon} ${log.message}`);
      }
      lastLogCount = proj.logs.length;
    }

    // Check for failure
    const failedStages = Object.entries(proj.stageStatus || {})
      .filter(([, status]) => status === 'failed')
      .map(([stage]) => stage);
    if (failedStages.length > 0) {
      console.log('');
      console.log(`❌ 流水线失败 — 失败阶段: ${failedStages.join(', ')}`);
      if (proj.error) console.log(`   错误: ${proj.error}`);
      return proj;
    }

    // Check for completion
    if (proj.stageStatus?.REFINEMENT === 'completed' || proj.stageStatus?.ASSEMBLY === 'completed') {
      console.log('');
      console.log('═══════════════════════════════════════════════════');
      console.log(`🎉 视频生成完成！ 耗时: ${formatElapsed(startTime)}`);
      if (proj.finalVideoPath) {
        console.log(`📁 输出路径: ${proj.finalVideoPath}`);
      }

      // Print stage summary
      console.log('');
      console.log('阶段概览:');
      for (const [stage, status] of Object.entries(proj.stageStatus)) {
        const icon = status === 'completed' ? '✅' : status === 'skipped' ? '⏭️' : '⬜';
        const label = STAGE_LABELS[stage] || stage;
        console.log(`  ${icon} ${label}`);
      }
      console.log('═══════════════════════════════════════════════════');
      return proj;
    }

    // Auto-handle pauses (QA review, reference image approval)
    if (proj.isPaused && proj.pausedAtStage) {
      const pauseKey = `${proj.pausedAtStage}:${proj.updatedAt}`;
      if (pauseKey !== lastHandledPause) {
        lastHandledPause = pauseKey;
        console.log(`  🔄 Auto-handling pause at: ${STAGE_LABELS[proj.pausedAtStage] || proj.pausedAtStage}`);

        if (proj.pausedAtStage === 'QA_REVIEW') {
          await postJson(`/api/pipeline/${project.id}/qa-override`, {
            feedback: 'auto-approved by run-pipeline.mjs',
          });
        }
        if (proj.pausedAtStage === 'REFERENCE_IMAGE') {
          await postJson(`/api/pipeline/${project.id}/approve-reference`, {});
        }
        await postJson(`/api/pipeline/${project.id}/resume`, {});
      }
    }

    await sleep(5000);
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('');
  console.log('🤖 AI Video Pipeline — 独立后端运行模式');
  console.log('');

  // Step 1: Setup data directory
  const videoFilename = setupDataDir();

  // Step 2: Start server
  const server = startServer();

  try {
    // Step 3: Wait for server
    await waitForServer();

    // Step 4: Run pipeline
    const result = await runPipeline(videoFilename);

    // Give server time to flush
    await sleep(2000);

    return result;
  } finally {
    // Cleanup: kill server
    console.log('');
    console.log('🛑 Shutting down server...');
    server.kill('SIGTERM');
    // Force kill after 5s
    setTimeout(() => {
      try { server.kill('SIGKILL'); } catch {}
    }, 5000).unref();
  }
}

main()
  .then((result) => {
    if (result?.finalVideoPath) {
      console.log(`\n✅ 最终视频: ${result.finalVideoPath}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('');
    console.error('❌ Pipeline error:', err.message || err);
    process.exit(1);
  });
