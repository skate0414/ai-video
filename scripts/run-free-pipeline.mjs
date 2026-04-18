#!/usr/bin/env node

/**
 * 免费模式视频生成脚本 (Free Mode Pipeline Runner)
 *
 * 启动 Electron 桌面应用，通过浏览器自动化（Gemini/KlingAI）
 * 运行完整的视频生成流水线。全程自动，无需手动操作。
 *
 * 用法:
 *   node scripts/run-free-pipeline.mjs
 *   node scripts/run-free-pipeline.mjs --topic "你的主题" --video data/你的视频.mov
 *
 * 前置条件:
 *   - FFmpeg (brew install ffmpeg)
 *   - edge-tts (pip install edge-tts)
 *   - Electron 应用中已登录 Gemini 和 KlingAI
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

/* ------------------------------------------------------------------ */
/*  Configuration                                                     */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
function getArgValue(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const TOPIC = getArgValue('--topic') || '生而为人有多难得';
const VIDEO_SOURCE = getArgValue('--video') || 'data/你的身体有多爱你.mp4';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const BACKEND_PORT = 3220;
const SERVER_URL = `http://localhost:${BACKEND_PORT}`;

// Electron data directory (macOS)
const ELECTRON_DATA_DIR = join(
  homedir(),
  'Library/Application Support/ai-video-browser-shell/data',
);
const UPLOADS_DIR = join(ELECTRON_DATA_DIR, 'uploads');

/* ------------------------------------------------------------------ */
/*  Prepare video file                                                */
/* ------------------------------------------------------------------ */

function prepareVideo() {
  // Resolve video path
  const videoPath = resolve(PROJECT_ROOT, VIDEO_SOURCE);
  if (!existsSync(videoPath)) {
    console.error(`❌ 视频文件不存在: ${videoPath}`);
    process.exit(1);
  }
  console.log(`📹 样本视频: ${videoPath}`);

  // Ensure uploads directory exists
  if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // Copy to uploads with unique name
  const videoName = basename(videoPath);
  const uniqueName = `${Date.now()}_${videoName}`;
  const destPath = join(UPLOADS_DIR, uniqueName);
  copyFileSync(videoPath, destPath);
  console.log(`✅ 视频已复制到: ${destPath}`);

  return uniqueName;
}

/* ------------------------------------------------------------------ */
/*  Start Electron desktop app                                        */
/* ------------------------------------------------------------------ */

function startDesktop() {
  console.log('🖥️  启动 Electron 桌面应用...');

  const child = spawn('npm', ['run', 'dev:desktop'], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    detached: false,
  });

  child.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) {
      // Filter important lines
      if (
        line.includes('running at') ||
        line.includes('ready') ||
        line.includes('error') ||
        line.includes('Error') ||
        line.includes('pipeline') ||
        line.includes('Pipeline') ||
        line.includes('[server]') ||
        line.includes('Stage') ||
        line.includes('stage')
      ) {
        console.log(`  [desktop] ${line}`);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && !line.includes('ExperimentalWarning') && !line.includes('DeprecationWarning')) {
      // Only show meaningful errors
      if (line.includes('error') || line.includes('Error') || line.includes('FAIL')) {
        console.error(`  [desktop] ${line}`);
      }
    }
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`❌ Desktop app exited with code ${code}`);
    }
  });

  return child;
}

/* ------------------------------------------------------------------ */
/*  Wait for backend health check                                     */
/* ------------------------------------------------------------------ */

async function waitForBackend(maxWaitMs = 60_000) {
  console.log('⏳ 等待后端服务启动...');
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(`${SERVER_URL}/health`);
      if (resp.ok) {
        console.log('✅ 后端服务已就绪');
        return;
      }
    } catch {
      // Not ready yet
    }
    await sleep(1000);
  }
  throw new Error('后端服务在 60 秒内未启动');
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
/*  Pipeline execution & monitoring                                   */
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
  CALIBRATION: '校准',
  NARRATIVE_MAP: '叙事结构',
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
  console.log(`🎬  样本视频: ${basename(VIDEO_SOURCE)}`);
  console.log(`🔧  模式: Free (浏览器自动化)`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // Check setup status
  try {
    const setup = await getJson('/api/setup/status');
    console.log(`📊 环境状态:`);
    console.log(`   FFmpeg:     ${setup.ffmpegAvailable ? '✅' : '❌ (需安装: brew install ffmpeg)'}`);
    console.log(`   edge-tts:   ${setup.edgeTtsAvailable ? '✅' : '⚠️ (可选: pip install edge-tts)'}`);
    console.log(`   Playwright: ${setup.playwrightAvailable ? '✅' : '❌'}`);
    console.log(`   账号数量:   ${setup.accountCount}`);
    console.log('');
  } catch {
    // setup endpoint might not exist
  }

  // Step 1: Create project
  console.log('📋 创建项目...');
  const project = await postJson('/api/pipeline', {
    topic: TOPIC,
    title: TOPIC,
    qualityTier: 'free',
  });
  console.log(`✅ 项目已创建: ${project.id}`);

  // Step 2: Start pipeline with video
  console.log('▶️  启动流水线...');
  await postJson(`/api/pipeline/${project.id}/start`, {
    videoFilePath: videoFilename,
  });
  console.log('✅ 流水线已启动');
  console.log('');
  console.log('📡 实时监控中... (Ctrl+C 可中断监控，流水线仍会在后台运行)');
  console.log('');

  // Step 3: Monitor progress
  const startTime = Date.now();
  let lastState = '';
  let lastHandledPause = '';
  let lastLogCount = 0;
  let consecutiveErrors = 0;

  while (true) {
    let proj;
    try {
      proj = await getJson(`/api/pipeline/${project.id}`);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors > 10) {
        console.error('❌ 无法连接后端服务，请检查 Electron 应用是否仍在运行');
        return null;
      }
      await sleep(3000);
      continue;
    }

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
        const icon = log.type === 'error' ? '🔴'
          : log.type === 'warning' ? '🟡'
          : log.type === 'success' ? '🟢'
          : '📝';
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
      console.log(`❌ 流水线失败 — 失败阶段: ${failedStages.map(s => STAGE_LABELS[s] || s).join(', ')}`);
      if (proj.error) console.log(`   错误: ${proj.error}`);
      console.log('');
      console.log(`💡 可在 Electron 应用 UI 中查看详细日志，或重试该阶段。`);
      console.log(`   项目 ID: ${project.id}`);
      return proj;
    }

    // Check for completion
    if (proj.stageStatus?.REFINEMENT === 'completed' || proj.stageStatus?.ASSEMBLY === 'completed') {
      console.log('');
      console.log('═══════════════════════════════════════════════════');
      console.log(`🎉 视频生成完成！耗时: ${formatElapsed(startTime)}`);
      if (proj.finalVideoPath) {
        console.log(`📁 输出路径: ${proj.finalVideoPath}`);
      }

      // Print stage summary
      console.log('');
      console.log('阶段概览:');
      for (const [stage, status] of Object.entries(proj.stageStatus)) {
        const icon = status === 'completed' ? '✅'
          : status === 'skipped' ? '⏭️'
          : status === 'failed' ? '❌'
          : '⬜';
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
        const label = STAGE_LABELS[proj.pausedAtStage] || proj.pausedAtStage;
        console.log(`  🔄 自动处理暂停: ${label}`);

        try {
          if (proj.pausedAtStage === 'QA_REVIEW') {
            await postJson(`/api/pipeline/${project.id}/qa-override`, {
              feedback: 'auto-approved by run-free-pipeline.mjs',
            });
          }
          if (proj.pausedAtStage === 'REFERENCE_IMAGE') {
            await postJson(`/api/pipeline/${project.id}/approve-reference`, {});
          }
          await postJson(`/api/pipeline/${project.id}/resume`, {});
        } catch (err) {
          console.error(`  🟡 自动处理暂停失败: ${err.message}`);
        }
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
  console.log('🤖 AI Video Pipeline — 免费模式 (浏览器自动化)');
  console.log('');

  // Step 1: Prepare video
  const videoFilename = prepareVideo();

  // Step 2: Start desktop app
  const desktop = startDesktop();

  // Handle Ctrl+C gracefully
  let shuttingDown = false;
  process.on('SIGINT', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n');
    console.log('⚠️  监控已中断。Electron 应用仍在后台运行。');
    console.log('   流水线将继续在 Electron 中执行。');
    console.log('   可在 http://localhost:5173 的 UI 中查看进度。');
    process.exit(0);
  });

  try {
    // Step 3: Wait for backend
    await waitForBackend();

    // Step 4: Run pipeline
    const result = await runPipeline(videoFilename);

    if (result?.finalVideoPath) {
      console.log(`\n✅ 最终视频: ${result.finalVideoPath}`);
    }

    console.log('\n💡 Electron 应用仍在运行，可关闭窗口退出。');
    // Don't kill Electron — let user view results in UI
  } catch (err) {
    console.error('');
    console.error('❌ 错误:', err.message || err);
    console.error('');
    console.error('💡 排查建议:');
    console.error('   1. 确认 Electron 应用中已登录 Gemini (gemini.google.com)');
    console.error('   2. 确认 Electron 应用中已登录 KlingAI (klingai.com)');
    console.error('   3. 检查网络连接');
    process.exit(1);
  }
}

main();
