/* ------------------------------------------------------------------ */
/*  Centralized constants — all configurable values in one place.      */
/*  Every constant reads from an environment variable first, falling   */
/*  back to a sensible default.  No magic numbers elsewhere.           */
/* ------------------------------------------------------------------ */

import { tmpdir } from 'node:os';

/* ---- Network ---- */

export const BACKEND_PORT          = Number(process.env.PORT ?? 3220);
export const CDP_PORT              = Number(process.env.ELECTRON_CDP_PORT ?? 9222);
export const AUTOMATION_CTRL_PORT  = Number(process.env.ELECTRON_CONTROL_PORT ?? 3221);

/* ---- Timeouts (ms) ---- */

/** Max time to wait for a single chat response. */
export const CHAT_RESPONSE_TIMEOUT_MS    = Number(process.env.CHAT_RESPONSE_TIMEOUT_MS ?? 1_200_000);

/** Per-selector wait when resolving a SelectorChain. */
export const SELECTOR_RESOLVE_TIMEOUT_MS = Number(process.env.SELECTOR_RESOLVE_TIMEOUT_MS ?? 2_000);

/** How long to wait for the CDP debugger to become reachable. */
export const CDP_READY_TIMEOUT_MS        = Number(process.env.ELECTRON_CDP_READY_TIMEOUT ?? 60_000);

/** Timeout for each individual connectOverCDP attempt. */
export const CDP_CONNECT_TIMEOUT_MS      = Number(process.env.ELECTRON_CDP_CONNECT_TIMEOUT ?? 60_000);

/** Brief stabilization delay after CDP HTTP probe succeeds. */
export const CDP_STABILIZATION_DELAY_MS  = Number(process.env.CDP_STABILIZATION_DELAY_MS ?? 1_500);

/** Timeout per CDP readiness probe request. */
export const CDP_PROBE_REQUEST_TIMEOUT_MS = Number(process.env.CDP_PROBE_REQUEST_TIMEOUT_MS ?? 3_000);

/** Polling interval between CDP readiness probes. */
export const CDP_PROBE_POLL_INTERVAL_MS  = Number(process.env.CDP_PROBE_POLL_INTERVAL_MS ?? 1_000);

/** Base backoff between connectOverCDP retries (multiplied by attempt #). */
export const CDP_RETRY_BACKOFF_BASE_MS   = Number(process.env.CDP_RETRY_BACKOFF_BASE_MS ?? 2_000);

/** Pollinations image-fetch timeout per request. */
export const POLLINATIONS_FETCH_TIMEOUT_MS = Number(process.env.POLLINATIONS_FETCH_TIMEOUT_MS ?? 45_000);

/** Backend-launcher restart delay after crash. */
export const BACKEND_RESTART_DELAY_MS    = Number(process.env.BACKEND_RESTART_DELAY_MS ?? 2_000);

/** Backend-launcher force-kill timeout. */
export const BACKEND_FORCE_KILL_MS       = Number(process.env.BACKEND_FORCE_KILL_MS ?? 5_000);

/** Backend health-check wait timeout. */
export const BACKEND_HEALTH_TIMEOUT_MS   = Number(process.env.BACKEND_HEALTH_TIMEOUT_MS ?? 30_000);

/** Graceful shutdown forced exit delay. */
export const SHUTDOWN_FORCE_EXIT_MS      = Number(process.env.SHUTDOWN_FORCE_EXIT_MS ?? 10_000);

/* ---- Retry counts ---- */

/** Maximum connectOverCDP retry attempts. */
export const CDP_MAX_RETRIES             = Number(process.env.CDP_MAX_RETRIES ?? 3);

/** Max retry attempts for file upload. */
export const FILE_UPLOAD_MAX_RETRIES     = Number(process.env.FILE_UPLOAD_MAX_RETRIES ?? 3);

/** Max retry attempts for Pollinations image generation. */
export const POLLINATIONS_MAX_ATTEMPTS   = Number(process.env.POLLINATIONS_MAX_ATTEMPTS ?? 5);

/** Max retry attempts for API calls (Gemini, etc). */
export const API_MAX_RETRIES             = Number(process.env.API_MAX_RETRIES ?? 3);

/** Max continuation attempts for truncated chat responses. */
export const MAX_CONTINUATIONS           = Number(process.env.MAX_CONTINUATIONS ?? 3);

/** Multi-candidate generation: generate N candidates per scene and pick best (default 3, max 5). */
export const CANDIDATE_COUNT             = Math.max(1, Math.min(Number(process.env.CANDIDATE_COUNT ?? 3), 5));

/* ---- Limits ---- */

/** Maximum concurrent SSE client connections. */
export const MAX_SSE_CLIENTS             = Number(process.env.MAX_SSE_CLIENTS ?? 50);

/** Rate limiter: max requests per window. */
export const RATE_LIMIT_MAX              = Number(process.env.RATE_LIMIT_MAX ?? 120);

/** Rate limiter: window duration in ms. */
export const RATE_LIMIT_WINDOW_MS        = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);

/* ---- Default providers ---- */

/** Default provider for text generation (used by ChatAdapter). */
export const DEFAULT_TEXT_PROVIDER       = (process.env.DEFAULT_TEXT_PROVIDER ?? 'gemini') as string;

/** Default provider for image generation (used by ChatAdapter). */
export const DEFAULT_IMAGE_PROVIDER      = (process.env.DEFAULT_IMAGE_PROVIDER ?? 'chatgpt') as string;

/* ---- Proxy ---- */

/** HTTP proxy URL for outbound requests (Pollinations, etc). Empty = no proxy. */
export const HTTP_PROXY                  = process.env.HTTP_PROXY || process.env.http_proxy || '';

/* ---- Paths ---- */

/** OS temp directory (never hardcode /tmp). */
export const TEMP_DIR                    = tmpdir();

/* ---- Selector health monitoring ---- */

/** How often to run selector health checks (ms). */
export const SELECTOR_HEALTH_CHECK_INTERVAL_MS = Number(process.env.SELECTOR_HEALTH_CHECK_INTERVAL_MS ?? 300_000);

/** Health score below which automatic re-detection is triggered. */
export const SELECTOR_HEALTH_REDETECT_THRESHOLD = Number(process.env.SELECTOR_HEALTH_REDETECT_THRESHOLD ?? 60);

/** Health score below which an SSE warning is emitted. */
export const SELECTOR_HEALTH_WARN_THRESHOLD = Number(process.env.SELECTOR_HEALTH_WARN_THRESHOLD ?? 80);

/* ---- Pipeline artifact filenames ---- */

/**
 * Centralized registry of all pipeline artifact filenames.
 * Every stage / route / CIR loader uses these constants — never raw strings.
 */
export const ARTIFACT = {
  // ── Analysis group (stages 1-3) ──
  CAPABILITY_ASSESSMENT: 'capability-assessment.json',
  STYLE_PROFILE:         'style-profile.json',
  STYLE_CONTRACT:        'style-contract-result.json',
  STYLE_ANALYSIS_CIR:    'style-analysis.cir.json',
  FORMAT_SIGNATURE:      'format-signature.json',
  SHOT_CIR:              'shot-analysis.cir.json',
  FACT_VERIFICATION:     'fact-verification.json',
  RESEARCH:              'research.json',
  RESEARCH_CIR:          'research.cir.json',

  // ── Creation group (stages 4-7) ──
  CALIBRATION:           'calibration.json',
  NARRATIVE_MAP:         'narrative-map.json',
  SCRIPT:                'script.json',
  SCRIPT_CIR:            'script.cir.json',
  SCRIPT_VALIDATION:     'script-validation-post-audit.json',
  QA_REVIEW:             'qa-review.json',
  CONTAMINATION_CHECK:   'contamination-check.json',
  TEMPORAL_PLAN_CIR:     'temporal-plan.cir.json',

  // ── Visual group (stages 8-11) ──
  SCENES:                'scenes.json',
  SUBJECT_ISOLATION:     'subject-isolation.json',
  REFERENCE_SHEET:       'reference_sheet.png',
  STORYBOARD_CIR:        'storyboard.cir.json',
  VIDEO_IR_CIR:          'video-ir.cir.json',

  // ── Production group (stages 12-15) ──
  ASSEMBLY_VALIDATION:   'assembly-validation.json',
  FINAL_RISK_GATE:       'final-risk-gate.json',
  REFINEMENT:            'refinement.json',

  // ── Infrastructure ──
  PROJECT:               'project.json',
  GLOBAL_AUDIT:          'global-audit.json',
  OBSERVABILITY:         'observability.json',
  PIPELINE_METRICS:      'pipeline-metrics.json',
  SCRIPT_HISTORY:        'script-history.json',
} as const;

/**
 * Artifacts included in project export / import bundles.
 * Single source of truth — used by pipelineService.exportProject / importProject.
 */
export const EXPORTABLE_ARTIFACTS: readonly string[] = [
  ARTIFACT.CAPABILITY_ASSESSMENT,
  ARTIFACT.STYLE_PROFILE,
  ARTIFACT.RESEARCH,
  ARTIFACT.CALIBRATION,
  ARTIFACT.NARRATIVE_MAP,
  ARTIFACT.SCRIPT,
  ARTIFACT.QA_REVIEW,
  ARTIFACT.SCENES,
  ARTIFACT.REFINEMENT,
];

/**
 * Artifacts that can be edited via PUT /api/pipeline/:id/artifacts/:filename.
 * Single source of truth — used by the PUT route handler.
 */
export const EDITABLE_ARTIFACTS: readonly string[] = [
  ARTIFACT.RESEARCH,
  ARTIFACT.NARRATIVE_MAP,
];

/**
 * Mapping from artifact filename → PipelineProject field cached via ??= pattern.
 * When an artifact is externally edited (PUT API / import), clearing the
 * corresponding project field forces ??= to re-read from disk on next run.
 */
export const ARTIFACT_CACHE_FIELDS: ReadonlyMap<string, string> = new Map<string, string>([
  [ARTIFACT.STYLE_PROFILE, 'styleProfile'],
  [ARTIFACT.RESEARCH, 'researchData'],
  [ARTIFACT.CALIBRATION, 'calibrationData'],
  [ARTIFACT.NARRATIVE_MAP, 'narrativeMap'],
  [ARTIFACT.SCRIPT, 'scriptOutput'],
  [ARTIFACT.SCENES, 'scenes'],
]);
