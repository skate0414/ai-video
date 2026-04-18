#!/usr/bin/env node
/**
 * Endurance test — repeatedly submits prompts to verify long-running stability.
 *
 * Usage:
 *   node src/testing/scripts/endurance-test.mjs [--rounds=N] [--server-url=URL] [--topic=TOPIC]
 *
 * Defaults:
 *   --rounds   10
 *   --topic    "A cat sitting on a windowsill"
 *
 * Outputs a Markdown report to stdout when done.
 */

import { parseCliArgs, getServerUrl, getJson, postJson, formatElapsed } from '../lib/backendApi.mjs';

const { flags } = parseCliArgs();
const serverUrl = getServerUrl(flags);
const rounds = Number(flags.get('--rounds') || '10');
const topic = String(flags.get('--topic') || 'A cat sitting on a windowsill');

const results = [];
let passes = 0;
let failures = 0;

async function waitForIdle(timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await getJson(serverUrl, '/api/state');
    if (!state.currentTask) return state;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`Timed out waiting for idle after ${timeoutMs / 1000}s`);
}

async function runRound(index) {
  const roundStart = Date.now();
  const label = `round-${index + 1}`;
  try {
    // Wait for backend idle before submitting
    await waitForIdle();

    // Submit a task
    const body = { topic, qualityTier: 'draft' };
    await postJson(serverUrl, '/api/task', body);

    // Poll until task completes (or timeout)
    const result = await waitForIdle(600_000);

    const durationMs = Date.now() - roundStart;
    passes += 1;
    return {
      round: index + 1,
      status: 'pass',
      durationMs,
      detail: result.lastError || null,
    };
  } catch (error) {
    const durationMs = Date.now() - roundStart;
    failures += 1;
    return {
      round: index + 1,
      status: 'fail',
      durationMs,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── main ──
console.log(`=== Endurance Test ===`);
console.log(`server: ${serverUrl}  rounds: ${rounds}  topic: "${topic}"`);
console.log();

const overallStart = Date.now();
let memBaseline = null;

try {
  const health = await getJson(serverUrl, '/api/health');
  memBaseline = health?.memoryMB ?? null;
} catch { /* optional */ }

for (let i = 0; i < rounds; i++) {
  const r = await runRound(i);
  results.push(r);
  const icon = r.status === 'pass' ? '✓' : '✗';
  const sec = (r.durationMs / 1000).toFixed(1);
  console.log(`  ${icon} Round ${r.round}  ${sec}s  ${r.detail || ''}`);
}

let memFinal = null;
try {
  const health = await getJson(serverUrl, '/api/health');
  memFinal = health?.memoryMB ?? null;
} catch { /* optional */ }

const totalMs = Date.now() - overallStart;
const avgMs = results.length ? results.reduce((s, r) => s + r.durationMs, 0) / results.length : 0;
const maxMs = results.length ? Math.max(...results.map((r) => r.durationMs)) : 0;
const minMs = results.length ? Math.min(...results.map((r) => r.durationMs)) : 0;

// ── Markdown report ──
console.log();
console.log('## Endurance Test Report');
console.log();
console.log(`| Metric | Value |`);
console.log(`|--------|-------|`);
console.log(`| Rounds | ${rounds} |`);
console.log(`| Passed | ${passes} |`);
console.log(`| Failed | ${failures} |`);
console.log(`| Total time | ${formatElapsed(overallStart)} |`);
console.log(`| Avg round | ${(avgMs / 1000).toFixed(1)}s |`);
console.log(`| Min round | ${(minMs / 1000).toFixed(1)}s |`);
console.log(`| Max round | ${(maxMs / 1000).toFixed(1)}s |`);
if (memBaseline !== null) console.log(`| Memory (start) | ${memBaseline} MB |`);
if (memFinal !== null) console.log(`| Memory (end) | ${memFinal} MB |`);
if (memBaseline !== null && memFinal !== null) {
  const drift = (memFinal - memBaseline).toFixed(1);
  console.log(`| Memory drift | ${drift} MB |`);
}
console.log();

if (failures > 0) {
  console.log('### Failed rounds');
  console.log();
  for (const r of results.filter((r) => r.status === 'fail')) {
    console.log(`- Round ${r.round}: ${r.detail}`);
  }
  console.log();
}

const exitCode = failures > 0 ? 1 : 0;
console.log(`Result: ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
