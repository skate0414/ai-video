#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { formatElapsed, getJson, parseCliArgs, getServerUrl, postJson } from '../lib/backendApi.mjs';
import { REPO_ROOT, resolveFromRepo } from '../lib/paths.mjs';

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ scriptPath, code: 0, durationMs: Date.now() - startedAt });
      }
      else reject(new Error(`${scriptPath} exited with code ${code ?? 1}`));
    });
  });
}

function slugify(value) {
  return String(value || 'acceptance')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'acceptance';
}

function sanitizeReportName(value) {
  return String(value || '')
    .trim()
    .replace(/\.(md|json)$/i, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function toIsoSafeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function formatDurationMs(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function readGitValue(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function loadGitMetadata() {
  const commit = readGitValue(['rev-parse', 'HEAD']);
  const shortCommit = commit ? commit.slice(0, 12) : '';
  const branch = readGitValue(['rev-parse', '--abbrev-ref', 'HEAD']);
  const statusOutput = readGitValue(['status', '--short']);
  return {
    branch: branch || 'unknown',
    commit: commit || 'unknown',
    shortCommit: shortCommit || 'unknown',
    isDirty: Boolean(statusOutput),
  };
}

function buildMarkdownReport(report) {
  const lines = [
    '# 后端验收报告',
    '',
    `- 报告版本：${report.reportVersion}`,
    `- 生成时间：${report.generatedAt}`,
    `- 主题：${report.topic}`,
    `- 标题：${report.title}`,
    `- 质量档位：${report.qualityTier}`,
    `- 服务地址：${report.serverUrl}`,
    `- 项目 ID：${report.projectId || '未生成'}`,
    `- 总体结果：${report.success ? '通过' : '失败'}`,
    `- 总耗时：${report.totalElapsed}`,
    `- Git Branch：${report.git?.branch || 'unknown'}`,
    `- Git Commit：${report.git?.shortCommit || report.git?.commit || 'unknown'}`,
    `- Git Dirty：${report.git?.isDirty ? 'yes' : 'no'}`,
    '',
    '## 步骤结果',
    '',
  ];

  for (const step of report.steps) {
    lines.push(`- ${step.name}: ${step.status} (${step.duration})`);
    if (step.detail) lines.push(`  - ${step.detail}`);
  }

  lines.push('', '## 项目状态摘要', '');
  if (!report.projectSummary) {
    lines.push('- 无可用项目状态');
  } else {
    lines.push(`- currentStage: ${report.projectSummary.currentStage}`);
    lines.push(`- currentStatus: ${report.projectSummary.currentStatus}`);
    lines.push(`- isPaused: ${report.projectSummary.isPaused}`);
    lines.push(`- error: ${report.projectSummary.error || '无'}`);
    lines.push(`- completedStages: ${report.projectSummary.completedStages}`);
    lines.push(`- failedStages: ${report.projectSummary.failedStages || '无'}`);
    lines.push(`- finalVideoPath: ${report.projectSummary.finalVideoPath || '无'}`);
  }

  lines.push('', '## 运行诊断摘要', '');
  if (!report.diagnostics) {
    lines.push('- 无诊断信息');
  } else {
    if (report.diagnostics.configSummary) {
      const config = report.diagnostics.configSummary;
      lines.push(`- config.qualityTier: ${config.qualityTier}`);
      lines.push(`- config.hasApiKey: ${config.hasApiKey}`);
      lines.push(`- config.productionConcurrency: ${config.productionConcurrency}`);
      lines.push(`- config.videoProfiles: ${config.videoProfiles}`);
    }

    if (report.diagnostics.accountSummary?.length) {
      lines.push('', '### 账号摘要', '');
      for (const account of report.diagnostics.accountSummary) {
        lines.push(`- ${account.provider}: total=${account.total}, available=${account.available}, exhausted=${account.exhausted}`);
      }
    }

    if (report.diagnostics.projectStageStats) {
      const stats = report.diagnostics.projectStageStats;
      lines.push('', '### 阶段统计', '');
      lines.push(`- completed: ${stats.completed}`);
      lines.push(`- failed: ${stats.failed}`);
      lines.push(`- pending: ${stats.pending}`);
      lines.push(`- processing: ${stats.processing}`);
      lines.push(`- paused: ${stats.paused}`);
      lines.push(`- sceneTotal: ${stats.sceneTotal}`);
      lines.push(`- sceneVideo: ${stats.sceneVideo}`);
      lines.push(`- sceneImage: ${stats.sceneImage}`);
      lines.push(`- scenePendingAssets: ${stats.scenePendingAssets}`);
    }

    if (report.diagnostics.failureContext?.length) {
      lines.push('', '### 失败上下文', '');
      for (const item of report.diagnostics.failureContext) {
        lines.push(`- ${item}`);
      }
    }
  }

  lines.push('', '## 结论', '');
  lines.push(report.success
    ? '- 本次标准后端验收流程已完成，主链路达到通过条件。'
    : '- 本次标准后端验收流程未通过，请根据失败步骤和项目状态继续排查。');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function loadProjectSummary(serverUrl, projectId) {
  if (!projectId) return null;
  try {
    const project = await getJson(serverUrl, `/api/pipeline/${projectId}`);
    const failedStages = Object.entries(project.stageStatus || {})
      .filter(([, status]) => status === 'failed')
      .map(([stage]) => stage)
      .join(', ');
    const completedStages = Object.values(project.stageStatus || {})
      .filter((status) => status === 'completed')
      .length;
    return {
      currentStage: project.currentStage || '(awaiting)',
      currentStatus: project.currentStatus || 'pending',
      isPaused: Boolean(project.isPaused),
      error: project.error || '',
      completedStages,
      failedStages,
      finalVideoPath: project.finalVideoPath || '',
    };
  } catch {
    return null;
  }
}

function summarizeAccounts(accounts) {
  const grouped = new Map();
  for (const account of accounts || []) {
    const current = grouped.get(account.provider) || { provider: account.provider, total: 0, available: 0, exhausted: 0 };
    current.total += 1;
    if (account.quotaExhausted) current.exhausted += 1;
    else current.available += 1;
    grouped.set(account.provider, current);
  }
  return [...grouped.values()].sort((left, right) => left.provider.localeCompare(right.provider));
}

function buildProjectStageStats(project) {
  const stageStatus = project?.stageStatus || {};
  const statuses = Object.values(stageStatus);
  const scenes = project?.scenes || [];
  return {
    completed: statuses.filter((status) => status === 'completed').length,
    failed: statuses.filter((status) => status === 'failed').length,
    pending: statuses.filter((status) => status === 'pending').length,
    processing: statuses.filter((status) => status === 'processing').length,
    paused: statuses.filter((status) => status === 'paused').length,
    sceneTotal: scenes.length,
    sceneVideo: scenes.filter((scene) => scene.assetType === 'video').length,
    sceneImage: scenes.filter((scene) => scene.assetType === 'image').length,
    scenePendingAssets: scenes.filter((scene) => !scene.assetUrl).length,
  };
}

async function loadDiagnostics(serverUrl, projectId, fatalError) {
  const diagnostics = {
    configSummary: null,
    accountSummary: [],
    projectStageStats: null,
    failureContext: [],
  };

  try {
    const config = await getJson(serverUrl, '/api/config');
    diagnostics.configSummary = {
      qualityTier: config.qualityTier ?? 'unknown',
      hasApiKey: Boolean(config.hasApiKey),
      productionConcurrency: config.productionConcurrency ?? 'unknown',
      videoProfiles: config.videoProviderConfig?.profileDirs?.length ?? 0,
    };
  } catch (error) {
    diagnostics.failureContext.push(`无法读取 /api/config: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const state = await getJson(serverUrl, '/api/state');
    diagnostics.accountSummary = summarizeAccounts(state.accounts || []);
  } catch (error) {
    diagnostics.failureContext.push(`无法读取 /api/state: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (projectId) {
    try {
      const project = await getJson(serverUrl, `/api/pipeline/${projectId}`);
      diagnostics.projectStageStats = buildProjectStageStats(project);
      if (project.currentStage) diagnostics.failureContext.push(`当前阶段: ${project.currentStage}`);
      if (project.currentStatus) diagnostics.failureContext.push(`当前状态: ${project.currentStatus}`);
      if (project.pausedAtStage) diagnostics.failureContext.push(`暂停阶段: ${project.pausedAtStage}`);
      if (project.error) diagnostics.failureContext.push(`项目错误: ${project.error}`);
    } catch (error) {
      diagnostics.failureContext.push(`无法读取项目状态: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (fatalError) diagnostics.failureContext.push(`验收失败原因: ${fatalError}`);
  return diagnostics;
}

function resolveReportDirectory(reportDir) {
  if (!reportDir) return resolveFromRepo('src', 'testing', 'reports');
  return isAbsolute(reportDir) ? reportDir : resolve(REPO_ROOT, reportDir);
}

function writeAcceptanceReport(report, options = {}) {
  const reportsDir = resolveReportDirectory(options.reportDir);
  mkdirSync(reportsDir, { recursive: true });

  const requestedName = sanitizeReportName(options.reportName);
  const baseName = requestedName || `${toIsoSafeTimestamp()}-${slugify(report.topic)}`;
  const jsonPath = join(reportsDir, `${baseName}.json`);
  const mdPath = join(reportsDir, `${baseName}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, buildMarkdownReport(report));

  return { jsonPath, mdPath };
}

async function main() {
  const { positionals, flags } = parseCliArgs();
  const serverUrl = getServerUrl(flags);
  const topic = positionals[0] || String(flags.get('--topic') || '后端标准验收项目');
  const title = String(flags.get('--title') || topic);
  const qualityTier = String(flags.get('--quality-tier') || 'free');
  const videoFilePath = flags.get('--video-file');
  const reportName = typeof flags.get('--report-name') === 'string' ? String(flags.get('--report-name')) : '';
  const reportDir = typeof flags.get('--report-dir') === 'string' ? String(flags.get('--report-dir')) : '';
  const skipPreflight = Boolean(flags.get('--skip-preflight'));
  const skipCreate = Boolean(flags.get('--skip-create'));
  const existingProjectId = flags.get('--project-id');
  const startedAt = Date.now();
  const steps = [];
  let projectId = String(existingProjectId || '');
  let success = false;
  let fatalError = '';
  let activeStep = 'bootstrap';

  console.log('=== Backend Acceptance ===');
  console.log(`server: ${serverUrl}`);
  console.log(`topic: ${topic}`);
  console.log(`qualityTier: ${qualityTier}`);
  if (reportName) console.log(`reportName: ${sanitizeReportName(reportName)}`);
  if (reportDir) console.log(`reportDir: ${resolveReportDirectory(reportDir)}`);

  try {
    // ── Browser stability quick check ──
    {
      activeStep = 'browser-stability';
      const stabilityStart = Date.now();
      try {
        const state = await getJson(serverUrl, '/api/state');
        const hasAccounts = (state.accounts || []).length > 0;
        const checks = ['server_reachable'];
        if (hasAccounts) checks.push('accounts_present');

        // Check selector cache exists (indicates prior detection ran)
        try {
          const cacheState = await getJson(serverUrl, '/api/selector-cache').catch(() => null);
          if (cacheState) checks.push('selector_cache_available');
        } catch { /* optional */ }

        steps.push({
          name: 'browser-stability',
          status: 'passed',
          duration: formatDurationMs(Date.now() - stabilityStart),
          durationMs: Date.now() - stabilityStart,
          detail: `checks: ${checks.join(', ')}`,
        });
      } catch (error) {
        // Non-blocking: browser stability check failure doesn't abort acceptance
        steps.push({
          name: 'browser-stability',
          status: 'warning',
          duration: formatDurationMs(Date.now() - stabilityStart),
          durationMs: Date.now() - stabilityStart,
          detail: `non-blocking: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    if (!skipPreflight) {
      activeStep = 'preflight';
      const result = await runScript('src/testing/scripts/preflight-health-check.mjs', ['--server-url', serverUrl, '--strong']);
      steps.push({ name: 'preflight', status: 'passed', duration: formatDurationMs(result.durationMs), durationMs: result.durationMs, detail: '预检查通过' });
    } else {
      steps.push({ name: 'preflight', status: 'skipped', duration: '00:00', durationMs: 0, detail: '通过 --skip-preflight 跳过' });
    }

    if (!skipCreate) {
      activeStep = 'create-project';
      const createStartedAt = Date.now();
      const project = await postJson(serverUrl, '/api/pipeline', { topic, title, qualityTier });
      projectId = project.id;
      console.log(`created project: ${projectId}`);
      steps.push({ name: 'create-project', status: 'passed', duration: formatDurationMs(Date.now() - createStartedAt), durationMs: Date.now() - createStartedAt, detail: `projectId=${projectId}` });
    } else {
      steps.push({ name: 'create-project', status: 'skipped', duration: '00:00', durationMs: 0, detail: '通过 --skip-create 跳过' });
    }

    if (!projectId) {
      throw new Error('No projectId available. Use --project-id or allow project creation.');
    }

    activeStep = 'auto-run-project';
    const args = [projectId, '--server-url', serverUrl];
    if (videoFilePath && typeof videoFilePath === 'string') {
      args.push('--video-file', videoFilePath);
    }

    const runResult = await runScript('src/testing/scripts/auto-run-project.mjs', args);
  steps.push({ name: 'auto-run-project', status: 'passed', duration: formatDurationMs(runResult.durationMs), durationMs: runResult.durationMs, detail: `projectId=${projectId}` });
    success = true;
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
    const lastStep = steps.at(-1)?.name;
    if (lastStep !== activeStep) {
      steps.push({ name: activeStep, status: 'failed', duration: formatElapsed(startedAt), durationMs: Date.now() - startedAt, detail: fatalError });
    }
  }

  const projectSummary = await loadProjectSummary(serverUrl, projectId);
  const diagnostics = await loadDiagnostics(serverUrl, projectId, fatalError);
  const git = loadGitMetadata();
  const report = {
    reportVersion: '1.0',
    generatedAt: new Date().toISOString(),
    topic,
    title,
    qualityTier,
    serverUrl,
    projectId,
    success,
    fatalError,
    totalElapsed: formatElapsed(startedAt),
    git,
    steps,
    projectSummary,
    diagnostics,
  };

  const reportPaths = writeAcceptanceReport(report, { reportName, reportDir });
  console.log(`acceptance report saved: ${reportPaths.mdPath}`);
  console.log(`acceptance report json: ${reportPaths.jsonPath}`);

  if (!success) {
    throw new Error(fatalError || 'Acceptance failed');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
