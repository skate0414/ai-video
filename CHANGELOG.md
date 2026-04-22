# Changelog

All notable changes to **AI Video** are documented here. The project follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- `ENOTFOUND` DNS resolution errors now treated as transient in `withRetry` — prevents spurious failures on momentary network blips.
- `uploadFile` in `GeminiAdapter` now accepts an `AbortSignal` via the `options` parameter and uses abort-aware polling (`throwIfAborted` + `waitWithAbort`).
- CDN download helper in `videoProviders/download.ts` now enforces a 60-second `node:https` timeout to prevent indefinite hangs on slow CDN servers.
- Structured JSON logging replaces all `console.log/warn` calls in the video-provider download module.
- New unit tests: `download.test.ts` (CDN download robustness), extended `retry.test.ts` (`ENOTFOUND` coverage), extended `geminiAdapter.test.ts` (poll-loop error propagation).

### Fixed
- Duplicate CDN download code paths in `download.ts` consolidated into a single `downloadFromHttpUrl` helper.

---

## [0.1.0] — Initial Release

This section describes the initial feature set as of the first tagged release.

### Core Pipeline

- **15-pass AI compilation pipeline**: Capability Assessment → Style Extraction → Research → Narrative Map → Script Generation → QA Review → Storyboard → Reference Image → Subject Isolation → Keyframe Generation → Video Generation → TTS → Assembly → Final Risk Gate → Refinement.
- **Compiler Intermediate Representation (CIR)**: Strongly-typed JSON schemas used for inter-stage communication; validation catches AI output errors early.
- **Stage retry wrapper**: Automatic exponential-backoff retry with configurable per-stage policies; transient browser and network errors always retried.
- **Multi-candidate video generation**: Generates N candidates per scene and picks the best using SSIM + PSNR + sharpness scoring.

### AI Provider Support

- **Google Gemini API** (`@google/genai`): text generation (Gemini 2.x), image generation (Gemini 3 native + Imagen 3), video generation (Veo 2), TTS (Gemini 2.5 Flash), file upload with polling.
- **Browser automation** via Playwright: ChatGPT, Gemini Web, DeepSeek, Kimi — free-tier quota-based access.
- **AIVideoMaker REST API**: text-to-video and image-to-video (v1, v2, v3 models with duration snapping).
- **KlingAI browser automation** (可灵): video generation via Playwright.
- **即梦 (Jimeng) browser automation**: video generation via Playwright.
- **FallbackAdapter**: chains primary → fallback adapters; quota errors automatically promote to the fallback.
- **Pollinations.AI**: free-tier image generation (no API key required).

### Quota & Resource Management

- Per-provider quota tracking with automatic rotation to the next available account.
- Multi-account round-robin for browser-automation providers.
- `withRetry` utility with configurable `isRetriable`, `maxRetries`, `delayMs`, and `signal` (abort) support.
- Quota error detection by HTTP status code, error message, and Chinese-language quota phrases.

### Workbench (Browser Automation Orchestrator)

- In-memory `TaskQueue` with FIFO ordering and capacity enforcement (default 10,000 tasks).
- Persistent task queue (JSON snapshot) — tasks survive server restarts.
- Unified `ResourceManager` supporting `api`, `video`, `image`, and `browser` resource types.
- `HealthMonitor` with periodic CSS-selector probing, automatic re-detection on degradation.

### REST API

- Full CRUD for projects, pipeline control (start / stop / pause / resume / retry), scene regeneration.
- Batch project creation and batch pipeline start with bounded concurrency.
- Artifact read/write endpoints for pipeline JSON files.
- Video streaming with `Range` request support.
- File upload (base64, 50 MB limit per file, extension allowlist).
- BGM library management.
- Style-template library.
- Cost tracking (per-project and global).
- Provider capabilities management.
- TTS voice listing.
- Environment diagnostics endpoint.
- Plugin preset system.

### Observability

- Prometheus-compatible `/metrics` endpoint with counters, gauges, and histograms.
- `/api/observability/snapshot` JSON endpoint for ad-hoc inspection.
- Per-stage pipeline trace (JSON trace file per project).
- Structured JSON logging throughout (zero `console.*` calls in production modules).
- Cost tracker with per-provider, per-stage billing estimates.

### Frontend (React Dashboard)

- Real-time SSE-driven project dashboard.
- Per-stage progress indicators with log tail.
- Scene editor (regenerate individual scenes with feedback).
- Workbench (task queue, account management, chat mode).
- Provider setup wizard.
- Style-template manager.
- Cost summary view.

### Desktop (Electron)

- Electron 35 shell with embedded Node.js backend.
- Playwright persistent browser profiles managed by the desktop shell.
- Tab manager, stealth preload, IPC handlers.
- Sidecar manifest for build tooling.

### Security

- Constant-time API key comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
- Per-IP rate limiting (default 120 req/min).
- Path traversal guards (`ensurePathWithinBase`) on all file-serving endpoints.
- Security response headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
- Upload extension allowlist + per-file size limit.
- CORS origin allowlist (dev mode allows all; production requires explicit `ALLOWED_ORIGINS`).
- `TRUST_PROXY` guard for `X-Forwarded-For` to prevent IP spoofing.
- Route error sanitisation — internal details never leak to API responses.

### Infrastructure

- npm workspaces monorepo (`packages/*`, `apps/*`).
- SQLite persistence for projects and global config with auto-migration from legacy JSON.
- Docker multi-stage build (FFmpeg + Chromium included, runs as non-root `node` user).
- Graceful shutdown with configurable forced-exit timeout.
- Plugin loader with trust-file gating and strict mode.
- Vitest test suite with 2600+ tests.
- TypeScript strict mode migration in progress (`@ts-nocheck` baseline, tracked by `scripts/check-strict-progress.mjs`).

[Unreleased]: https://github.com/skate0414/ai-video/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/skate0414/ai-video/releases/tag/v0.1.0
