# WARNING FIX REPORT — Phase-2 High-Risk Compiler Warning Convergence

**Date:** 2026-04-10  
**Baseline:** 569 tests / 40 files, tsc clean, 26/26 smoke  
**Post-fix:** 590 tests / 41 files, tsc clean, 26/26 smoke  

---

## Fixes Applied

### W8 — Safety fail-open → fail-closed ✅

| Item | Detail |
|------|--------|
| **File** | `src/pipeline/stages/capabilityAssessment.ts` L60 |
| **Root cause** | `extractAndValidateJSON(...) ?? { safe: true }` — null-coalesce defaults to safe when AI response is unparseable/ empty/ malformed |
| **Fix** | Changed fallback to `{ safe: false, reason: 'Failed to parse safety check response — defaulting to unsafe (fail-closed)' }` |
| **Impact** | Malformed AI safety responses now block the pipeline instead of silently passing |
| **Tests** | 3 unit tests in `warningFixes.test.ts` (null fallback, valid passthrough, unsafe passthrough) |

### W9 — Manual review unenforced ✅

| Item | Detail |
|------|--------|
| **File** | `src/pipeline/orchestrator.ts` `runPostStageHooks()` |
| **Root cause** | `requiresManualReview` flag computed in safety.ts was never checked by `runPostStageHooks` before production stages |
| **Fix** | Added post-stage gate after `SCRIPT_GENERATION`: when `project.scriptOutput.safetyMetadata.needsManualReview` is true, throws `SafetyBlockError` |
| **Impact** | High-risk scripts (suicide, medical claims) are now double-gated: once in the stage, once in the orchestrator hook |
| **Tests** | 4 unit tests (suicide detection, medical detection, safe content pass, contract test) |

### W17 — Path traversal guard ✅

| Item | Detail |
|------|--------|
| **Files** | `src/pipeline/orchestrator.ts` `run()` method |
| **Root cause** | `videoFilePath` joined with uploads dir without path traversal validation — attacker could supply `../../etc/passwd` |
| **Fix** | Added `ensurePathWithinBase(uploadsDir, resolved, 'videoFilePath')` using existing `src/lib/pathSafety.ts` utility |
| **Impact** | Path traversal attempts now throw with descriptive error instead of resolving to arbitrary filesystem locations |
| **Tests** | 4 unit tests (valid path, traversal attempt, absolute escape, base-dir itself) |

### W1 — Timeout no cancel ✅

| Item | Detail |
|------|--------|
| **Files** | `src/pipeline/stageRetryWrapper.ts`, `src/pipeline/stageRegistry.ts`, `src/pipeline/orchestrator.ts` |
| **Root cause** | Retry backoff used plain `setTimeout` via `delay()` — not interruptible by abort signals. Cancelled pipelines waited for full backoff duration before acknowledging cancellation |
| **Fix** | (1) Added `abortSignal?: AbortSignal` to `StageRunContext`, (2) wired it from `runState.abortController.signal` in orchestrator, (3) replaced `delay(backoff)` with `waitWithAbort(backoff, ctx.abortSignal)` in stageRetryWrapper |
| **Impact** | Pipeline abort/timeout now immediately cancels retry backoff waits instead of waiting for full exponential backoff |
| **Tests** | 4 unit tests (normal resolve, pre-aborted signal, mid-wait abort, abort-aware retry wrapper integration) |

### W10 — RunLock no timeout ✅

| Item | Detail |
|------|--------|
| **File** | `src/pipeline/runLock.ts` |
| **Root cause** | `startedAt` timestamp stored but never checked — no lease timeout, no stale lock recovery. Crashed run could permanently block its project |
| **Fix** | Added configurable `leaseTimeoutMs` (default 30min). `acquire()` auto-expires stale locks. `isRunning()` and `getRunning()` filter out expired entries |
| **Impact** | Crashed/orphaned pipeline runs auto-expire after lease timeout, allowing recovery without manual intervention |
| **Tests** | 6 unit tests (normal cycle, stale expiry, isRunning stale, getRunning filter, default lease, non-stale block) |

---

## Verification Summary

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ Clean (0 errors) |
| `npx vitest run` | ✅ 590 tests / 41 files — all pass |
| `npx tsx src/testing/smoke-verify-blockers.ts` | ✅ 26/26 checks passed |
| New tests added | 21 tests in `src/pipeline/__tests__/warningFixes.test.ts` |
| Tests gained | +21 (569 → 590) |
| Files gained | +1 test file (40 → 41) |
| Regressions | 0 |

---

## Conclusion

🟢 **可正式试运行**

All 5 high-risk warnings (W8, W9, W17, W1, W10) are now fail-closed with comprehensive test coverage. Zero regressions in existing 569 tests, 21 new tests added. tsc clean, full smoke verification passed.
