#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  health-check.mjs — 后端运行日志健康检查                             */
/*  用法:                                                              */
/*    node scripts/health-check.mjs <logfile>                         */
/*    cat backend.log | node scripts/health-check.mjs                 */
/* ------------------------------------------------------------------ */

import { readFileSync } from 'node:fs';

// ── Read input ──────────────────────────────────────────────────────
const logFile = process.argv[2];
let raw;
if (logFile) {
  raw = readFileSync(logFile, 'utf-8');
} else if (!process.stdin.isTTY) {
  raw = readFileSync('/dev/stdin', 'utf-8');
} else {
  console.error('用法: node scripts/health-check.mjs <logfile>');
  console.error('  或: cat backend.log | node scripts/health-check.mjs');
  process.exit(1);
}

const lines = raw.split('\n').filter(Boolean);

// ── Counters ────────────────────────────────────────────────────────
const counters = {
  totalLines: lines.length,

  // Stage lifecycle
  stageStarted: 0,
  stageCompleted: 0,
  stageFailed: 0,
  stageFailures: [],        // { stage, error, ts }

  // Task lifecycle
  taskStarted: 0,
  taskDone: 0,
  taskTimeout: 0,
  taskError: 0,
  taskErrors: [],            // { taskId, error, ts }

  // Model selection
  modelSelectAttempts: 0,
  modelSelectFailed: 0,
  modelSelectFailReasons: [],

  // File upload
  uploadAttempts: 0,
  uploadFailed: 0,
  uploadDiagnostics: [],     // { screenshotPath, pageTitle, ts }

  // Selector health
  selectorChecks: [],        // { provider, healthScore, brokenSelectors, ts }

  // Response quality
  responseReceived: 0,
  responseTimeout: 0,
  emptyResponses: 0,

  // SSE connections
  sseConnected: 0,
  sseDisconnected: 0,
  sseMaxConcurrent: 0,

  // Infrastructure
  cdpConnected: false,
  chromiumPath: '',
  certErrors: 0,
  electronErrors: 0,

  // Video compression
  compressionJobs: 0,
  compressionDone: 0,
  compressionCached: 0,

  // Self-assessment
  selfAssessmentFailed: 0,

  // Browser lifecycle (crash/reconnect tracking)
  pageCrashes: 0,
  pageCrashReasons: [],      // { reason, accountId, ts }
  promptPageCrashes: 0,      // send_prompt_page_crashed errors
  browserReconnects: 0,      // closeBrowser → ensureBrowser cycles
  contextCloseFailures: 0,

  // Time span
  firstTs: null,
  lastTs: null,
};

// ── Parse each line ─────────────────────────────────────────────────
for (const line of lines) {
  // Try to extract structured JSON from the line
  const jsonMatch = line.match(/\{[^{}]*"(?:ts|level|module|action)"[^{}]*\}/);
  if (jsonMatch) {
    let evt;
    try { evt = JSON.parse(jsonMatch[0]); } catch { continue; }

    // Track time span
    if (evt.ts) {
      if (!counters.firstTs || evt.ts < counters.firstTs) counters.firstTs = evt.ts;
      if (!counters.lastTs || evt.ts > counters.lastTs) counters.lastTs = evt.ts;
    }

    const action = evt.action ?? '';
    const level = evt.level ?? '';
    const module_ = evt.module ?? '';

    // ── Stage lifecycle ──
    if (action === 'stage_start') counters.stageStarted++;
    if (action === 'stage_completed') counters.stageCompleted++;
    if (action === 'stage_failed') {
      counters.stageFailed++;
      counters.stageFailures.push({ stage: evt.stage, error: evt.error ?? evt.message, ts: evt.ts });
    }

    // ── Task lifecycle ──
    if (action === 'task_start') counters.taskStarted++;
    if (action === 'task_done') counters.taskDone++;
    if (action === 'submit_and_wait_timeout') counters.taskTimeout++;
    if (action === 'task_error') {
      counters.taskError++;
      counters.taskErrors.push({ taskId: evt.taskId, error: evt.error, ts: evt.ts });
    }

    // ── Model selection ──
    if (action === 'task_selecting_model') counters.modelSelectAttempts++;
    if (action === 'select_model_failed') {
      counters.modelSelectFailed++;
      // Extract first line of error for dedup
      const shortErr = (evt.error ?? '').split('\n')[0].slice(0, 120);
      if (!counters.modelSelectFailReasons.includes(shortErr)) {
        counters.modelSelectFailReasons.push(shortErr);
      }
    }

    // ── File upload ──
    if (action === 'task_uploading_attachments') counters.uploadAttempts++;
    if (action === 'upload_diagnostic') {
      counters.uploadFailed++;
      counters.uploadDiagnostics.push({
        screenshotPath: evt.screenshotPath,
        ts: evt.ts,
      });
    }
    if (action === 'upload_diagnostic_page') {
      const last = counters.uploadDiagnostics[counters.uploadDiagnostics.length - 1];
      if (last) last.pageTitle = evt.pageTitle;
    }

    // ── Selector health ──
    if (action === 'selector_health_check') {
      counters.selectorChecks.push({
        provider: evt.provider,
        healthScore: evt.healthScore,
        brokenSelectors: evt.brokenSelectors ?? [],
        ts: evt.ts,
      });
    }

    // ── Response quality ──
    if (action === 'send_prompt_response_received') {
      counters.responseReceived++;
      if (evt.answerLength === 0) counters.emptyResponses++;
    }
    if (action === 'send_prompt_response_timeout') counters.responseTimeout++;

    // ── Self-assessment ──
    if (action === 'self_assessment_failed') counters.selfAssessmentFailed++;

    // ── Browser lifecycle ──
    if (action === 'active_page_crashed') {
      counters.pageCrashes++;
      counters.pageCrashReasons.push({ reason: evt.reason ?? 'unknown', accountId: evt.accountId, ts: evt.ts });
    }
    if (action === 'send_prompt_page_crashed') counters.promptPageCrashes++;
    if (action === 'browser_context_died') counters.browserReconnects++;
    if (action === 'active_page_close_failed' || action === 'browser_context_close_failed') counters.contextCloseFailures++;

    // ── CDP / browser ──
    if (action === 'Connected' || (module_ === 'ElectronBridge' && line.includes('Connected'))) {
      counters.cdpConnected = true;
    }

    // ── Video compression ──
    if (action === 'start_compression') counters.compressionJobs++;
    if (action === 'compression_done') counters.compressionDone++;
    if (action === 'using_cached') counters.compressionCached++;

    continue;
  }

  // ── Plain-text patterns ──
  if (line.includes('SSE client connected')) {
    counters.sseConnected++;
    const m = line.match(/total=(\d+)/);
    if (m) counters.sseMaxConcurrent = Math.max(counters.sseMaxConcurrent, Number(m[1]));
  }
  if (line.includes('SSE client disconnected')) counters.sseDisconnected++;
  if (line.includes('Error parsing certificate')) counters.certErrors++;
  if (line.includes('Electron[') && (line.includes('TSM') || line.includes('IMK') || line.includes('representedObject'))) {
    counters.electronErrors++;
  }
  if (line.includes('Using Playwright bundled Chromium')) {
    const m = line.match(/Chromium:\s*(.+)/);
    if (m) counters.chromiumPath = m[1].trim();
  }
  if (line.includes('Connected') && line.includes('contexts') && line.includes('pages')) {
    counters.cdpConnected = true;
  }
}

// ── Scoring ─────────────────────────────────────────────────────────
// 6 dimensions, each 0-100, weighted into final score.
const dimensions = {};

// 1. Stage Success Rate (weight: 30)
if (counters.stageStarted > 0) {
  dimensions.stageSuccess = {
    score: Math.round((counters.stageCompleted / counters.stageStarted) * 100),
    weight: 30,
    detail: `${counters.stageCompleted}/${counters.stageStarted} 阶段完成，${counters.stageFailed} 失败`,
  };
} else {
  dimensions.stageSuccess = { score: 50, weight: 30, detail: '无阶段执行记录' };
}

// 2. Task Reliability (weight: 25)
if (counters.taskStarted > 0) {
  const successRate = counters.taskDone / counters.taskStarted;
  const timeoutPenalty = Math.min(counters.taskTimeout * 10, 50);
  const errorPenalty = Math.min(counters.taskError * 10, 50);
  dimensions.taskReliability = {
    score: Math.max(0, Math.round(successRate * 100 - timeoutPenalty - errorPenalty)),
    weight: 25,
    detail: `${counters.taskDone}/${counters.taskStarted} 任务完成，${counters.taskTimeout} 超时，${counters.taskError} 错误`,
  };
} else {
  dimensions.taskReliability = { score: 50, weight: 25, detail: '无任务执行记录' };
}

// 3. Model Selection (weight: 15)
if (counters.modelSelectAttempts > 0) {
  const failRate = counters.modelSelectFailed / counters.modelSelectAttempts;
  dimensions.modelSelection = {
    score: Math.round((1 - failRate) * 100),
    weight: 15,
    detail: `${counters.modelSelectAttempts - counters.modelSelectFailed}/${counters.modelSelectAttempts} 模型选择成功`,
  };
} else {
  dimensions.modelSelection = { score: 100, weight: 15, detail: '无模型选择请求' };
}

// 4. File Upload (weight: 15)
if (counters.uploadAttempts > 0) {
  const failRate = counters.uploadFailed / counters.uploadAttempts;
  dimensions.fileUpload = {
    score: Math.round((1 - failRate) * 100),
    weight: 15,
    detail: `${counters.uploadAttempts - counters.uploadFailed}/${counters.uploadAttempts} 文件上传成功`,
  };
} else {
  dimensions.fileUpload = { score: 100, weight: 15, detail: '无文件上传请求' };
}

// 5. Selector Health (weight: 10)
if (counters.selectorChecks.length > 0) {
  const avgScore = counters.selectorChecks.reduce((s, c) => s + c.healthScore, 0) / counters.selectorChecks.length;
  const allBroken = [...new Set(counters.selectorChecks.flatMap(c => c.brokenSelectors))];
  dimensions.selectorHealth = {
    score: Math.round(avgScore),
    weight: 10,
    detail: `平均健康分 ${avgScore.toFixed(0)}/100` + (allBroken.length ? `，失效: ${allBroken.join(', ')}` : ''),
  };
} else {
  dimensions.selectorHealth = { score: 100, weight: 10, detail: '无选择器健康检查' };
}

// 6. Infrastructure (weight: 5)
{
  let infra = 100;
  if (!counters.cdpConnected) infra -= 30;
  if (counters.certErrors > 0) infra -= Math.min(counters.certErrors * 5, 20);
  if (counters.electronErrors > 0) infra -= Math.min(counters.electronErrors * 5, 20);
  dimensions.infrastructure = {
    score: Math.max(0, infra),
    weight: 5,
    detail: [
      counters.cdpConnected ? 'CDP 已连接' : 'CDP 未连接',
      counters.certErrors > 0 ? `${counters.certErrors} 证书错误` : null,
      counters.electronErrors > 0 ? `${counters.electronErrors} Electron 警告` : null,
    ].filter(Boolean).join('，'),
  };
}

// Weighted total
let totalWeight = 0;
let weightedSum = 0;
for (const dim of Object.values(dimensions)) {
  weightedSum += dim.score * dim.weight;
  totalWeight += dim.weight;
}
const finalScore = Math.round(weightedSum / totalWeight);

// ── Fault Analysis ──────────────────────────────────────────────────
const faults = [];
const warnings = [];
const recommendations = [];

// Fault: Model selection broken
if (counters.modelSelectFailed > 0) {
  faults.push({
    severity: 'CRITICAL',
    title: '模型选择器失效',
    count: counters.modelSelectFailed,
    detail: `getByText('Pro') 匹配到多个元素 (strict mode violation)。` +
      `路由表配置的模型名 "Gemini 2.5 Pro" 与网页实际模型名不匹配，` +
      `导致 Playwright 无法定位正确的模型切换按钮。`,
    fix: '更新 qualityRouter.ts 中的模型名为 "Gemini 3.1 Pro"，并优化 workbench.ts 中的模型选择器逻辑，' +
      '使用更精确的 CSS 选择器而非 getByText。',
  });
}

// Fault: File upload trigger not found
if (counters.uploadFailed > 0) {
  faults.push({
    severity: 'CRITICAL',
    title: '文件上传触发器未找到',
    count: counters.uploadFailed,
    detail: 'Gemini 网页的附件上传按钮选择器失效，导致视频/图片无法上传。' +
      '所有需要多模态输入的阶段 (STYLE_EXTRACTION) 全部失败。',
    fix: '检查 Gemini 网页当前 DOM 结构，更新 fileUploadTrigger 选择器。' +
      '运行 debug:provider-dom 工具诊断当前页面元素。',
  });
}

// Fault: Stage failures
for (const f of counters.stageFailures) {
  faults.push({
    severity: 'HIGH',
    title: `阶段失败: ${f.stage}`,
    count: 1,
    detail: f.error,
    fix: f.error?.includes('timed out')
      ? '增加 aiControl.ts 中的超时时间，或检查 Gemini 网页响应是否被阻塞。'
      : '检查阶段执行上下文和输入数据。',
  });
}

// Fault: Task timeouts
if (counters.taskTimeout > 0) {
  faults.push({
    severity: 'HIGH',
    title: 'AI 请求超时',
    count: counters.taskTimeout,
    detail: `${counters.taskTimeout} 个任务在 120s 内未收到响应，可能原因：` +
      '1) 模型切换失败导致使用了错误模型；' +
      '2) 文件上传失败导致 Gemini 无视频可分析；' +
      '3) 网页 responseBlock 选择器失效无法检测到回复。',
    fix: '优先修复模型选择器和文件上传问题。检查 responseBlock 选择器兼容性。',
  });
}

// Fault: Empty responses
if (counters.emptyResponses > 0) {
  faults.push({
    severity: 'MEDIUM',
    title: '空响应',
    count: counters.emptyResponses,
    detail: `收到 ${counters.emptyResponses} 个空响应 (answerLength=0)，可能是 responseBlock 选择器未正确匹配回复内容。`,
    fix: '检查 Gemini 网页的 responseBlock CSS 选择器是否匹配最新 DOM 结构。',
  });
}

// Fault: Self-assessment failures
if (counters.selfAssessmentFailed > 0) {
  warnings.push({
    severity: 'LOW',
    title: '风格自评估失败',
    count: counters.selfAssessmentFailed,
    detail: 'STYLE_EXTRACTION 阶段的 self-assessment 预检失败 (非阻塞)，可能影响分析质量。',
  });
}

// Fault: Browser page crashes
if (counters.pageCrashes > 0) {
  faults.push({
    severity: counters.pageCrashes >= 3 ? 'CRITICAL' : 'HIGH',
    title: '浏览器页面崩溃',
    count: counters.pageCrashes,
    detail: `检测到 ${counters.pageCrashes} 次页面崩溃 (active_page_crashed)，` +
      `其中 ${counters.promptPageCrashes} 次发生在 sendPrompt 执行期间。` +
      (counters.browserReconnects > 0 ? ` 系统进行了 ${counters.browserReconnects} 次自动重连。` : ''),
    fix: '检查目标网站是否存在内存泄漏或 JavaScript 异常。' +
      '查看 Chrome 崩溃转储 (chrome://crashes) 确认崩溃原因。',
  });
}

// Warning: Selector health degradation
for (const check of counters.selectorChecks) {
  if (check.healthScore < 100) {
    warnings.push({
      severity: check.healthScore < 60 ? 'HIGH' : 'MEDIUM',
      title: `选择器健康度下降: ${check.provider}`,
      count: 1,
      detail: `健康分 ${check.healthScore}/100，失效选择器: ${check.brokenSelectors.join(', ')}`,
    });
    break; // Only report once
  }
}

// Warning: Certificate errors
if (counters.certErrors > 0) {
  warnings.push({
    severity: 'LOW',
    title: 'TLS 证书解析错误',
    count: counters.certErrors,
    detail: 'macOS 证书链解析错误，通常不影响功能，但可能导致部分 HTTPS 请求变慢。',
  });
}

// Recommendations based on fault chain
if (counters.modelSelectFailed > 0 && counters.uploadFailed > 0 && counters.taskTimeout > 0) {
  recommendations.push(
    '⛓️ 故障链检测: 模型选择失败 → 文件上传失败 → 任务超时 → 阶段失败。' +
    '这是一个级联故障——修复根因 (模型选择器) 可能解决所有下游问题。'
  );
}
if (counters.uploadFailed > 0) {
  recommendations.push(
    '🔧 紧急: 检查 Gemini 网页的文件上传按钮 DOM 结构是否已变更，更新 fileUploadTrigger 选择器。'
  );
}
if (counters.modelSelectFailed > 0) {
  recommendations.push(
    '🔧 紧急: 模型名已过时。将路由表中 "Gemini 2.5 Pro" 更新为 "Gemini 3.1 Pro"，' +
    '并修改模型选择逻辑使用精确定位而非 getByText 模糊匹配。'
  );
}

// ── Output ──────────────────────────────────────────────────────────
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function scoreColor(score) {
  if (score >= 80) return GREEN;
  if (score >= 50) return YELLOW;
  return RED;
}

function severityIcon(sev) {
  return { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵' }[sev] ?? '⚪';
}

const timeSpan = counters.firstTs && counters.lastTs
  ? `${counters.firstTs.slice(11, 19)} → ${counters.lastTs.slice(11, 19)} UTC`
  : '未知';

console.log();
console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}  AI Video 后端运行健康检查报告${RESET}`);
console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
console.log(`  ${DIM}日志行数: ${counters.totalLines} | 时间跨度: ${timeSpan}${RESET}`);
console.log();

// Final Score
const sc = scoreColor(finalScore);
console.log(`  ${BOLD}综合健康评分: ${sc}${finalScore}/100${RESET}`);
console.log();

// Dimension scores
console.log(`${BOLD}  ┌─ 维度评分 ─────────────────────────────────────────┐${RESET}`);
const dimLabels = {
  stageSuccess: '阶段成功率',
  taskReliability: '任务可靠性',
  modelSelection: '模型选择  ',
  fileUpload: '文件上传  ',
  selectorHealth: '选择器健康',
  infrastructure: '基础设施  ',
};
for (const [key, dim] of Object.entries(dimensions)) {
  const label = dimLabels[key] ?? key;
  const bar = '█'.repeat(Math.round(dim.score / 5)) + '░'.repeat(20 - Math.round(dim.score / 5));
  console.log(`  │ ${label} ${scoreColor(dim.score)}${bar} ${dim.score}${RESET}${DIM} (×${dim.weight}) ${dim.detail}${RESET}`);
}
console.log(`${BOLD}  └──────────────────────────────────────────────────────┘${RESET}`);
console.log();

// Faults
if (faults.length > 0) {
  console.log(`${BOLD}${RED}  ── 故障诊断 (${faults.length}) ──${RESET}`);
  for (const f of faults) {
    console.log(`  ${severityIcon(f.severity)} ${BOLD}[${f.severity}]${RESET} ${f.title} ${DIM}(×${f.count})${RESET}`);
    console.log(`     ${DIM}原因: ${f.detail}${RESET}`);
    if (f.fix) console.log(`     ${CYAN}修复: ${f.fix}${RESET}`);
    console.log();
  }
}

// Warnings
if (warnings.length > 0) {
  console.log(`${BOLD}${YELLOW}  ── 警告 (${warnings.length}) ──${RESET}`);
  for (const w of warnings) {
    console.log(`  ${severityIcon(w.severity)} ${BOLD}[${w.severity}]${RESET} ${w.title} ${DIM}(×${w.count})${RESET}`);
    console.log(`     ${DIM}${w.detail}${RESET}`);
    console.log();
  }
}

// Recommendations
if (recommendations.length > 0) {
  console.log(`${BOLD}${CYAN}  ── 修复建议 ──${RESET}`);
  for (const r of recommendations) {
    console.log(`  ${r}`);
  }
  console.log();
}

// Summary statistics
console.log(`${BOLD}  ── 统计概览 ──${RESET}`);
console.log(`  ${DIM}阶段: ${counters.stageStarted} 启动, ${counters.stageCompleted} 完成, ${counters.stageFailed} 失败${RESET}`);
console.log(`  ${DIM}任务: ${counters.taskStarted} 启动, ${counters.taskDone} 完成, ${counters.taskTimeout} 超时, ${counters.taskError} 错误${RESET}`);
console.log(`  ${DIM}模型: ${counters.modelSelectAttempts} 选择请求, ${counters.modelSelectFailed} 失败${RESET}`);
console.log(`  ${DIM}上传: ${counters.uploadAttempts} 次请求, ${counters.uploadFailed} 次失败${RESET}`);
console.log(`  ${DIM}响应: ${counters.responseReceived} 收到, ${counters.emptyResponses} 空, ${counters.responseTimeout} 超时${RESET}`);
console.log(`  ${DIM}SSE:  ${counters.sseConnected} 连接, ${counters.sseDisconnected} 断开, 峰值 ${counters.sseMaxConcurrent} 并发${RESET}`);
console.log(`  ${DIM}浏览器: ${counters.pageCrashes} 崩溃, ${counters.promptPageCrashes} prompt中崩溃, ${counters.browserReconnects} 重连, ${counters.contextCloseFailures} 关闭失败${RESET}`);
console.log(`  ${DIM}压缩: ${counters.compressionJobs} 任务, ${counters.compressionDone} 完成, ${counters.compressionCached} 缓存命中${RESET}`);
console.log(`  ${DIM}CDP:  ${counters.cdpConnected ? '✅ 已连接' : '❌ 未连接'} | 证书错误: ${counters.certErrors} | Electron 警告: ${counters.electronErrors}${RESET}`);
console.log();

// Exit code: 0=healthy, 1=degraded, 2=critical
const exitCode = finalScore >= 80 ? 0 : finalScore >= 40 ? 1 : 2;
const verdict = exitCode === 0 ? `${GREEN}HEALTHY${RESET}` : exitCode === 1 ? `${YELLOW}DEGRADED${RESET}` : `${RED}CRITICAL${RESET}`;
console.log(`${BOLD}  结论: ${verdict}${RESET}`);
console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
console.log();

process.exit(exitCode);
