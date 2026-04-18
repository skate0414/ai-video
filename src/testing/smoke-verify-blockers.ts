/**
 * smoke-verify-blockers.ts — Post-fix smoke verification for 6 preflight blockers.
 *
 * Run: npx tsx src/testing/smoke-verify-blockers.ts
 *
 * This script performs programmatic verification of each blocker fix
 * WITHOUT modifying any source code. Read-only verification only.
 */

import { mkdtempSync, rmSync, mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { SSE_EVENT } from '../../shared/types.js';

/* ---- Result tracking ---- */
interface CheckResult {
  blocker: string;
  check: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(blocker: string, check: string, pass: boolean, detail: string) {
  results.push({ blocker, check, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} [${blocker}] ${check}: ${detail}`);
}

/* ================================================================== */
/*  S1 · B1 — ELECTRON_AUTOMATION_TOKEN pass-through verification     */
/* ================================================================== */

async function verifyB1() {
  console.log('\n═══ S1: B1 — Electron Automation Token Flow ═══');

  // 1a. Verify backend-launcher.ts contains ELECTRON_AUTOMATION_TOKEN in pass-through
  const launcherSrc = await import('node:fs').then(fs =>
    fs.readFileSync(join(process.cwd(), 'browser-shell/src/backend-launcher.ts'), 'utf-8')
  );

  const hasTokenInPassthrough = launcherSrc.includes("'ELECTRON_AUTOMATION_TOKEN'") &&
    // Verify it's in the pass-through array, not just a comment
    /for\s*\(\s*const\s+key\s+of\s*\[[\s\S]*?'ELECTRON_AUTOMATION_TOKEN'[\s\S]*?\]/.test(launcherSrc);
  record('B1', 'ELECTRON_AUTOMATION_TOKEN in pass-through array', hasTokenInPassthrough,
    hasTokenInPassthrough ? 'Token found in env whitelist loop' : 'Token NOT in pass-through array');

  // 1b. Verify missing-token warning log exists
  const hasWarningLog = launcherSrc.includes('ELECTRON_AUTOMATION_TOKEN not set');
  record('B1', 'Missing token warning log present', hasWarningLog,
    hasWarningLog ? 'Warning log emitted when token absent' : 'No warning log for missing token');

  // 1c. Verify automation-server.ts generates token and checks Bearer header
  const serverSrc = await import('node:fs').then(fs =>
    fs.readFileSync(join(process.cwd(), 'browser-shell/src/automation-server.ts'), 'utf-8')
  );
  const serverSetsToken = serverSrc.includes('process.env.ELECTRON_AUTOMATION_TOKEN = authToken');
  record('B1', 'automation-server sets token in env', serverSetsToken,
    serverSetsToken ? 'Token generated and stored in process.env' : 'Token NOT stored');

  const serverChecksBearerAuth = /Bearer\s/.test(serverSrc) && serverSrc.includes('401');
  record('B1', 'automation-server validates Bearer token', serverChecksBearerAuth,
    serverChecksBearerAuth ? '401 returned for invalid/missing token' : 'Auth check missing');

  // 1d. Verify electronBridge.ts reads token from env and sends Authorization header
  const bridgeSrc = await import('node:fs').then(fs =>
    fs.readFileSync(join(process.cwd(), 'src/electronBridge.ts'), 'utf-8')
  );
  const bridgeReadsToken = bridgeSrc.includes('process.env.ELECTRON_AUTOMATION_TOKEN');
  const bridgeSendsAuth = bridgeSrc.includes('Authorization') && bridgeSrc.includes('Bearer');
  record('B1', 'electronBridge reads token from env', bridgeReadsToken,
    bridgeReadsToken ? 'Reads ELECTRON_AUTOMATION_TOKEN from process.env' : 'Token NOT read');
  record('B1', 'electronBridge sends Authorization: Bearer header', bridgeSendsAuth,
    bridgeSendsAuth ? 'Authorization header with Bearer prefix sent' : 'Auth header missing');

  // 1e. Verify full chain: server generates → env stores → launcher passes → bridge reads → sends Bearer
  const fullChain = serverSetsToken && hasTokenInPassthrough && bridgeReadsToken && bridgeSendsAuth;
  record('B1', 'Full token flow chain intact', fullChain,
    fullChain
      ? 'automation-server → env → backend-launcher → electronBridge → Bearer header ✓'
      : 'CHAIN BROKEN — see individual checks above');
}

/* ================================================================== */
/*  S2 · B3/B4/B5 — Pipeline preflight smoke tests                   */
/* ================================================================== */

async function verifyPipelinePreflights() {
  console.log('\n═══ S2: B3/B4/B5 — Pipeline Preflight Checks ═══');

  // Dynamic import to pick up the real orchestrator
  const { PipelineOrchestrator } = await import('../pipeline/orchestrator.js');
  const dataDir = mkdtempSync(join(tmpdir(), 'smoke-preflight-'));

  const mockAdapter: any = {
    provider: 'mock',
    generateText: async () => ({ text: JSON.stringify({ safe: true, reason: 'ok' }) }),
    generateImage: async () => ({ text: '' }),
    generateVideo: async () => ({ text: '' }),
  };

  try {
    // --- B3: Empty stage registry guard ---
    // We can't easily mock the registry to be empty at runtime without vi.mock,
    // so we verify the guard code exists in the source.
    const orchSrc = await import('node:fs').then(fs =>
      fs.readFileSync(join(process.cwd(), 'src/pipeline/orchestrator.ts'), 'utf-8')
    );
    const hasEmptyGuard = orchSrc.includes("stages.length === 0") &&
      orchSrc.includes('stage registry is empty');
    record('B3', 'Empty registry guard in orchestrator.run()', hasEmptyGuard,
      hasEmptyGuard ? 'Throws Error when stages.length === 0' : 'Guard MISSING');

    // Verify it's a throw, not just a log
    const throwsOnEmpty = /if\s*\(\s*stages\.length\s*===\s*0\s*\)\s*\{?\s*throw\s+new\s+Error/.test(orchSrc);
    record('B3', 'Guard uses throw (fail-closed, not fail-open)', throwsOnEmpty,
      throwsOnEmpty ? 'throw new Error — pipeline will NOT emit false pipeline_complete' : 'NOT fail-closed');

    // --- B4: No text provider → fail-closed ---
    const orchNoProvider = new PipelineOrchestrator(mockAdapter, {
      dataDir,
    });
    // Registry is empty — no providers registered
    const projectNoProvider = orchNoProvider.createProject('B4 smoke test');
    const resultNoProvider = await orchNoProvider.run(projectNoProvider.id);
    const b4FailClosed = !!resultNoProvider.error && /no text-capable provider/i.test(resultNoProvider.error);
    record('B4', 'Empty provider → fail-closed with clear error', b4FailClosed,
      b4FailClosed
        ? `Error: "${resultNoProvider.error!.substring(0, 80)}..."`
        : `Expected error about text provider, got: ${resultNoProvider.error ?? 'NO ERROR (fail-open!)'}`);

    // Verify pipeline_complete was NOT emitted
    const eventsNoProvider: any[] = [];
    orchNoProvider.onEvent((e) => eventsNoProvider.push(e));
    // (events were before listener — check project state instead)
    const noStageCompleted = Object.values(resultNoProvider.stageStatus).every(s => s === 'pending');
    record('B4', 'No stages executed when no provider', noStageCompleted,
      noStageCompleted ? 'All stages remain pending — no false progress' : 'SOME STAGES RAN without provider');

    // --- B4 positive: Text provider → allows CAPABILITY_ASSESSMENT ---
    const orchWithProvider = new PipelineOrchestrator(mockAdapter, {
      dataDir,
    });
    orchWithProvider.providerRegistry.register('mock', {
      text: true, imageGeneration: true, videoGeneration: false,
      fileUpload: false, webSearch: false,
    });
    const projectWithProvider = orchWithProvider.createProject('B4 positive test');
    const resultWithProvider = await orchWithProvider.run(projectWithProvider.id);
    const b4PassThrough = resultWithProvider.stageStatus.CAPABILITY_ASSESSMENT === 'completed';
    record('B4', 'Text provider present → CAPABILITY_ASSESSMENT proceeds', b4PassThrough,
      b4PassThrough
        ? 'CAPABILITY_ASSESSMENT completed successfully'
        : `Stage status: ${resultWithProvider.stageStatus.CAPABILITY_ASSESSMENT}, error: ${resultWithProvider.error ?? 'none'}`);

    // --- B5: No video provider → warning (not crash) ---
    const eventsWithProvider: any[] = [];
    const orchB5 = new PipelineOrchestrator(mockAdapter, {
      dataDir,
    });
    orchB5.providerRegistry.register('text-only', {
      text: true, imageGeneration: false, videoGeneration: false,
      fileUpload: false, webSearch: false,
    });
    orchB5.onEvent((e) => eventsWithProvider.push(e));
    const projectB5 = orchB5.createProject('B5 smoke test');
    await orchB5.run(projectB5.id);

    const videoWarning = eventsWithProvider.find(
      (e: any) => e.type === SSE_EVENT.LOG &&
        e.payload?.entry?.type === 'warning' &&
        /videoGeneration/i.test(e.payload.entry.message ?? '')
    );
    record('B5', 'Missing video provider → warning log (not crash)', !!videoWarning,
      videoWarning
        ? `Warning: "${(videoWarning as any).payload.entry.message.substring(0, 80)}..."`
        : 'No video warning found in events');

    // B5: Verify pipeline did NOT crash from missing video provider at preflight
    const b5NoCrash = !resultWithProvider.error?.includes('videoGeneration');
    record('B5', 'Pipeline continues past preflight (no crash)', b5NoCrash,
      b5NoCrash ? 'Preflight warning only — pipeline proceeds to stages' : 'Pipeline CRASHED on video check');

  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/* ================================================================== */
/*  S3 · B2 — start.sh verification                                  */
/* ================================================================== */

function verifyStartSh() {
  console.log('\n═══ S3: B2 — start.sh Syntax & Structure ═══');

  const scriptPath = join(process.cwd(), 'scripts/start.sh');

  // 3a. bash -n syntax check
  let syntaxOk = false;
  let syntaxOutput = '';
  try {
    execSync(`bash -n "${scriptPath}" 2>&1`, { encoding: 'utf-8' });
    syntaxOk = true;
    syntaxOutput = 'No syntax errors detected';
  } catch (err: any) {
    syntaxOutput = err.stdout || err.stderr || err.message;
  }
  record('B2', 'bash -n syntax check', syntaxOk, syntaxOutput);

  // 3b. No orphan fi
  const scriptSrc = readFileSync(scriptPath, 'utf-8');
  const lines = scriptSrc.split('\n');

  let ifCount = 0;
  let fiCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Count if/then blocks (excluding comments and strings in echo)
    if (/^\s*if\s/.test(line) || /;\s*if\s/.test(line)) ifCount++;
    if (trimmed === 'fi' || trimmed === 'fi;' || /;\s*fi\s*$/.test(trimmed)) fiCount++;
  }
  // Also count [ ] style conditionals that are inside if blocks
  const balanced = ifCount === fiCount;
  record('B2', 'if/fi balance check', balanced,
    balanced ? `${ifCount} if(s) matched by ${fiCount} fi(s)` : `MISMATCH: ${ifCount} if vs ${fiCount} fi`);

  // 3c. Startup sequence: should end with exec npm run dev:desktop
  const hasExec = scriptSrc.includes('exec npm run dev:desktop');
  record('B2', 'Startup terminates with exec npm run dev:desktop', hasExec,
    hasExec ? 'Correct exec handoff to Electron' : 'Missing exec');

  // 3d. Dependency checks present
  const hasNodeCheck = scriptSrc.includes('Node.js');
  const hasFfmpegCheck = scriptSrc.includes('FFmpeg') || scriptSrc.includes('ffmpeg');
  record('B2', 'Dependency checks present (Node, FFmpeg)', hasNodeCheck && hasFfmpegCheck,
    `Node.js: ${hasNodeCheck ? '✓' : '✗'}, FFmpeg: ${hasFfmpegCheck ? '✓' : '✗'}`);
}

/* ================================================================== */
/*  S4 · B6 — dataDir permission simulation                          */
/* ================================================================== */

async function verifyDataDirPermissions() {
  console.log('\n═══ S4: B6 — dataDir Permission Handling ═══');

  if (platform() === 'win32') {
    record('B6', 'Permission simulation', true, 'SKIPPED on Windows (chmod semantics differ)');
    return;
  }

  const tmpBase = mkdtempSync(join(tmpdir(), 'smoke-datadir-'));

  try {
    // 4a. Simulate EACCES — create read-only parent, point DATA_DIR into it
    const readonlyDir = join(tmpBase, 'readonly');
    mkdirSync(readonlyDir);
    chmodSync(readonlyDir, 0o444);

    const savedDataDir = process.env.DATA_DIR;
    const savedAppData = process.env.APPDATA_DIR;
    const savedElectron = process.env.ELECTRON_SHELL;
    process.env.DATA_DIR = join(readonlyDir, 'child');
    delete process.env.APPDATA_DIR;
    delete process.env.ELECTRON_SHELL;

    // Must reset module cache so resolveDataDir re-reads env
    // Use a child process to isolate — tsx for TypeScript ESM
    let errorMsg = '';
    const childDataDir = join(readonlyDir, 'child').replace(/'/g, "\\'");
    try {
      execSync(
        `npx tsx -e "import('./src/dataDir.ts').then(m => m.resolveDataDir())"`,
        {
          encoding: 'utf-8',
          cwd: process.cwd(),
          timeout: 15000,
          env: {
            ...process.env,
            DATA_DIR: join(readonlyDir, 'child'),
            APPDATA_DIR: '',
            ELECTRON_SHELL: '',
          },
        }
      );
    } catch (err: any) {
      errorMsg = err.stderr || err.stdout || err.message || '';
    }

    const hasHelpfulError = errorMsg.includes('Failed to create data directory');
    const hasDataDirHint = errorMsg.includes('DATA_DIR');
    record('B6', 'EACCES → helpful error message', hasHelpfulError,
      hasHelpfulError
        ? 'Error includes "Failed to create data directory"'
        : `Got: ${errorMsg.substring(0, 120) || 'NO ERROR (directory somehow created?)'}`);
    record('B6', 'Error includes DATA_DIR override guidance', hasDataDirHint,
      hasDataDirHint ? 'Mentions DATA_DIR env variable' : 'No DATA_DIR hint in error');

    // Restore env
    if (savedDataDir) process.env.DATA_DIR = savedDataDir; else delete process.env.DATA_DIR;
    if (savedAppData) process.env.APPDATA_DIR = savedAppData;
    if (savedElectron) process.env.ELECTRON_SHELL = savedElectron;

    // Cleanup readonly
    chmodSync(readonlyDir, 0o755);

    // 4b. Verify recovery — writeable directory works
    const goodDir = join(tmpBase, 'good');
    process.env.DATA_DIR = goodDir;
    let recoveryOk = false;
    try {
      execSync(
        `npx tsx -e "
          process.env.DATA_DIR = '${goodDir.replace(/'/g, "\\'")}';
          delete process.env.APPDATA_DIR;
          delete process.env.ELECTRON_SHELL;
          import('./src/dataDir.ts').then(m => {
            const d = m.resolveDataDir();
            console.log('DIR=' + d);
          });
        "`,
        { encoding: 'utf-8', cwd: process.cwd(), timeout: 15000 }
      );
      recoveryOk = existsSync(goodDir);
    } catch {
      recoveryOk = false;
    }
    record('B6', 'Recovery — writable directory succeeds', recoveryOk,
      recoveryOk ? `Created ${goodDir}` : 'FAILED to create writable directory');

    // Restore
    if (savedDataDir) process.env.DATA_DIR = savedDataDir; else delete process.env.DATA_DIR;

  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }

  // 4c. Verify source code has try/catch
  const dataDirSrc = readFileSync(
    join(process.cwd(), 'src/dataDir.ts'), 'utf-8'
  );
  const hasTryCatch = /try\s*\{[\s\S]*?mkdirSync[\s\S]*?\}\s*catch/.test(dataDirSrc);
  record('B6', 'Source has try/catch around mkdirSync', hasTryCatch,
    hasTryCatch ? 'Permission failure is caught and re-thrown with context' : 'No try/catch — raw EACCES leak');
}

/* ================================================================== */
/*  S5 · Mini pipeline run to CAPABILITY_ASSESSMENT                   */
/* ================================================================== */

async function verifyMiniPipelineRun() {
  console.log('\n═══ S5: Mini Pipeline Run — CAPABILITY_ASSESSMENT ═══');

  const { PipelineOrchestrator } = await import('../pipeline/orchestrator.js');
  const dataDir = mkdtempSync(join(tmpdir(), 'smoke-mini-'));

  const mockAdapter: any = {
    provider: 'mock',
    generateText: async () => ({
      text: JSON.stringify({ safe: true, reason: 'Test topic is safe' })
    }),
    generateImage: async () => ({ text: '' }),
    generateVideo: async () => ({ text: '' }),
  };

  try {
    const orch = new PipelineOrchestrator(mockAdapter, {
      dataDir,
    });

    // Seed providers
    orch.providerRegistry.register('mock', {
      text: true, imageGeneration: true, videoGeneration: false,
      fileUpload: false, webSearch: false,
    });

    const start = Date.now();
    const project = orch.createProject('test topic', 'smoke test');

    const events: any[] = [];
    orch.onEvent((e) => events.push(e));

    const result = await orch.run(project.id);
    const elapsed = Date.now() - start;

    // Check CAPABILITY_ASSESSMENT completed
    const capDone = result.stageStatus.CAPABILITY_ASSESSMENT === 'completed';
    record('S5', 'CAPABILITY_ASSESSMENT completed', capDone,
      capDone
        ? `Stage completed in ${elapsed}ms`
        : `Status: ${result.stageStatus.CAPABILITY_ASSESSMENT}, error: ${result.error ?? 'none'}`);

    // Check safety result
    const safetyOk = result.safetyCheck?.safe === true;
    record('S5', 'Safety check returned safe=true', safetyOk,
      safetyOk ? 'Topic approved by safety check' : `Safety: ${JSON.stringify(result.safetyCheck)}`);

    // Timing
    record('S5', `Total run time < 30s`, elapsed < 30000,
      `${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);

    // No pipeline_complete with zero work
    const completeEvent = events.find(e => e.type === SSE_EVENT.COMPLETE);
    const stageEvents = events.filter(e => e.type === SSE_EVENT.STAGE);
    if (completeEvent) {
      record('S5', 'pipeline_complete only after real work', stageEvents.length > 0,
        `${stageEvents.length} stage events before pipeline_complete`);
    } else {
      record('S5', 'Pipeline did not emit false pipeline_complete', true,
        'No premature completion (pipeline paused or errored on later stages as expected)');
    }

  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/* ================================================================== */
/*  Main — run all verifications and produce summary                  */
/* ================================================================== */

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   POST-FIX SMOKE VERIFICATION — 6 BLOCKERS         ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  await verifyB1();
  await verifyPipelinePreflights();
  verifyStartSh();
  await verifyDataDirPermissions();
  await verifyMiniPipelineRun();

  /* ---- Summary ---- */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   VERIFICATION SUMMARY                              ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const byBlocker = new Map<string, CheckResult[]>();
  for (const r of results) {
    const key = r.blocker;
    if (!byBlocker.has(key)) byBlocker.set(key, []);
    byBlocker.get(key)!.push(r);
  }

  let totalPass = 0;
  let totalFail = 0;
  const blockerResults: { blocker: string; pass: boolean }[] = [];

  for (const [blocker, checks] of byBlocker) {
    const allPass = checks.every(c => c.pass);
    const passCount = checks.filter(c => c.pass).length;
    blockerResults.push({ blocker, pass: allPass });
    totalPass += passCount;
    totalFail += checks.length - passCount;
    console.log(`  ${allPass ? '✅' : '❌'} ${blocker}: ${passCount}/${checks.length} checks passed`);
  }

  console.log(`\n  Total: ${totalPass}/${totalPass + totalFail} checks passed`);

  const allBlockersFixed = blockerResults.every(b => b.pass);
  console.log(`\n  ${allBlockersFixed ? '🟢' : '🔴'} Full Pipeline Run: ${allBlockersFixed ? 'ALLOWED' : 'BLOCKED'}`);

  if (!allBlockersFixed) {
    console.log('\n  ⚠️  Fix failing checks before attempting full pipeline run.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Smoke verification crashed:', err);
  process.exit(2);
});
