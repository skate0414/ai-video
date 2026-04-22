# AI Video

> **Multimodal Content Compiler** — turn a topic + style reference into a production-ready video through a 15-pass AI compilation pipeline.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Tech Stack](#tech-stack)
5. [Quick Start](#quick-start)
6. [Configuration](#configuration)
7. [Usage](#usage)
8. [API Reference](#api-reference)
9. [Development](#development)
10. [Deployment](#deployment)
11. [FAQ](#faq)

---

## Overview

AI Video is a monorepo application that automates video production end-to-end:

1. You supply a **topic** (e.g. *"The life cycle of a star"*) and an optional **style reference** image or video.
2. The 15-pass compilation pipeline researches the topic, writes a script, generates a storyboard, produces keyframe images, synthesises voice-over audio, renders per-scene video clips, and assembles the final MP4.
3. The entire process is driven by AI models (Google Gemini API, browser-automation via Playwright against free-tier AI chat sites, or third-party video APIs such as AIVideoMaker / KlingAI).

The result is a polished, narrated video with consistent visual style — ready for social media, education, or internal use.

---

## Features

| Category | Details |
|----------|---------|
| **15-pass pipeline** | Capability assessment → Style extraction → Research → Calibration → Narrative map → Script → QA review → Storyboard → Reference image → Keyframe gen → Video gen → TTS → Assembly → Risk gate → Refinement |
| **Multi-provider AI** | Google Gemini API (text + image + video + TTS), browser-automation fallback (ChatGPT / Gemini / DeepSeek / Kimi via Playwright), AIVideoMaker API, KlingAI browser automation |
| **Quota management** | Automatic retry with exponential backoff, per-provider quota tracking, multi-account round-robin rotation |
| **Real-time dashboard** | SSE event stream drives a React UI with per-stage progress, scene previews, and live log tail |
| **Style consistency** | Visual DNA extraction, reference-sheet anchoring, multi-candidate generation with automated quality scoring (SSIM + PSNR + sharpness) |
| **Observability** | Prometheus-compatible `/metrics` endpoint, per-stage histograms, cost tracking, pipeline trace |
| **Desktop mode** | Electron shell with embedded Node backend — no separate server needed |
| **Docker** | Single-image deployment; FFmpeg + Chromium included |
| **Plugin system** | Out-of-tree stage and provider plugins; trust-file based loading |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  apps/ui-shell  (React + Vite)                              │
│  apps/desktop   (Electron + Playwright browser shell)       │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / SSE  (port 3220)
┌────────────────────────▼────────────────────────────────────┐
│  apps/server            (Node.js HTTP server)               │
│  ├── routes/            REST API + SSE handlers             │
│  ├── workbench.ts       Browser-automation orchestrator     │
│  └── runtime.ts         Rate limiting, CORS, metrics        │
└──────┬──────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│  packages/pipeline-core  (15-pass compilation engine)       │
│  ├── orchestrator.ts     Stage sequencing + abort           │
│  ├── stageRunner.ts      Per-stage execute + trace          │
│  ├── stageRetryWrapper   Transient-error retry              │
│  ├── pipelineService.ts  Public service facade              │
│  ├── projectStore.ts     SQLite / JSON project persistence  │
│  └── taskQueue.ts        Bounded in-memory task queue       │
│                                                             │
│  packages/adapter-common  (AI provider adapters)            │
│  ├── geminiAdapter.ts    Google GenAI SDK                   │
│  ├── chatAdapter.ts      Playwright browser automation      │
│  ├── fallbackAdapter.ts  Primary → fallback chaining        │
│  └── aivideomakerAdapter Third-party video API              │
│                                                             │
│  packages/site-strategies  (Playwright site scripts)        │
│  ├── jimengStrategy      即梦 video generation              │
│  ├── klingStrategy        可灵 video generation              │
│  └── chatAutomation/     Generic chat-site automation       │
│                                                             │
│  packages/lib             (shared utilities)                │
│  ├── retry.ts            withRetry + quota detection        │
│  ├── logger.ts           Structured JSON logging            │
│  └── pathSafety.ts       Path traversal guards              │
│                                                             │
│  packages/shared          (cross-package types)             │
│  packages/pipeline-video  (built-in video stage defs)       │
└─────────────────────────────────────────────────────────────┘
```

See [`docs/architecture.md`](docs/architecture.md) for the full module map and pipeline-stage reference.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 20.9 (TypeScript via `tsx`, ESM) |
| Frontend | React 19, Vite, TypeScript |
| Desktop | Electron + Playwright (browser shell) |
| AI APIs | Google Gemini API (`@google/genai`) |
| Browser automation | Playwright |
| Video assembly | FFmpeg |
| Database | SQLite (`better-sqlite3`) |
| Testing | Vitest (2600+ tests) |
| Container | Docker (`node:20-slim`) |

---

## Quick Start

### Prerequisites

- **Node.js ≥ 20.9**
- **FFmpeg** installed and on `PATH`
- A **Google Gemini API key** (for the default AI provider)

### 1 — Clone and install

```bash
git clone https://github.com/skate0414/ai-video.git
cd ai-video
npm install
```

### 2 — Configure

```bash
cp .env.example .env
# Edit .env and set at least GEMINI_API_KEY
```

### 3 — Start the backend

```bash
npm run dev
# Server starts at http://localhost:3220
```

### 4 — Start the frontend (separate terminal)

```bash
npm run dev:ui
# UI available at http://localhost:5173
```

### 5 — (Optional) Desktop mode

```bash
npm run dev:desktop   # launches Electron with embedded UI + backend
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and edit as needed.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3220` | HTTP server port |
| `DATA_DIR` | `./data` | Root directory for projects, models, uploads |
| `GEMINI_API_KEY` | — | Google Gemini API key (required for API pipeline) |
| `API_KEY` | — | Bearer token required on all API requests (leave empty to disable auth in dev) |
| `ALLOWED_ORIGINS` | — | Comma-separated CORS origins; empty = allow all (dev mode) |
| `TRUST_PROXY` | `0` | Set to `1` when behind a reverse proxy (enables `X-Forwarded-For`) |
| `AIVIDEOMAKER_API_KEY` | — | AIVideoMaker API key for video generation |
| `ENABLE_PLUGINS` | `0` | Set to `1` to load out-of-tree stage/provider plugins |
| `PLUGINS_DIR` | `<DATA_DIR>/plugins` | Directory scanned for plugin bundles |
| `PLUGIN_TRUST_FILE` | `<DATA_DIR>/trusted-plugins.json` | JSON allowlist of trusted plugin IDs |
| `PLUGIN_STRICT` | `0` | Set to `1` to abort startup on plugin load failure |
| `NODE_ENV` | `development` | `production` disables dev-only features |

For the full list of tunable constants (timeouts, retry counts, etc.) see [`docs/deployment.md`](docs/deployment.md) and [`packages/pipeline-core/src/constants.ts`](packages/pipeline-core/src/constants.ts).

---

## Usage

### Creating a video

1. Open the UI at `http://localhost:5173`.
2. Click **New Project**, enter a topic (e.g. *"太阳系的起源"*).
3. Optionally upload a style-reference image or video clip.
4. Click **Start** — the pipeline runs in the background; real-time progress appears in the dashboard.
5. When the pipeline reaches the **ASSEMBLY** stage the final video is ready. Click **Download** to save the MP4.

### Using the REST API directly

```bash
# Create a project
curl -X POST http://localhost:3220/api/pipeline \
  -H "Content-Type: application/json" \
  -d '{"topic": "The water cycle"}'

# Start the pipeline
curl -X POST http://localhost:3220/api/pipeline/<projectId>/start

# Poll for status
curl http://localhost:3220/api/pipeline/<projectId>

# Stream events (SSE)
curl -N http://localhost:3220/api/events
```

See [API Reference](docs/api.md) for all endpoints.

---

## API Reference

A concise summary of the key endpoint groups:

| Group | Prefix | Summary |
|-------|--------|---------|
| Pipeline control | `/api/pipeline` | CRUD projects, start/stop/pause/resume/retry |
| Configuration | `/api/config` | AI keys, TTS, video provider, presets |
| Workbench | `/api/state`, `/api/tasks`, `/api/accounts` | Browser-automation task queue |
| Resources | `/api/resources` | Multi-type resource management (API + browser) |
| Artifacts | `/api/pipeline/:id/artifacts/:filename` | Read/write pipeline JSON artifacts |
| Assets | `/api/pipeline/:id/assets/:filename` | Serve keyframe images, reference sheets |
| Providers | `/api/providers` | List, add, detect models for AI providers |
| Observability | `/metrics`, `/api/observability/snapshot` | Prometheus metrics + snapshot |
| Health | `/health` | Liveness probe |

Full request/response documentation: [`docs/api.md`](docs/api.md)

---

## Development

### Running tests

```bash
npm test                  # all tests (Vitest)
npm run test:watch        # watch mode
```

### Type checking

```bash
npm run build             # runs tsc --noEmit across all workspaces
```

### Linting

```bash
npm run lint              # type check + UI lint
npm run lint:deps         # dependency graph checks
npm run ci:verify         # full CI gate
```

### Monorepo layout

```
ai-video/
├── apps/
│   ├── server/           Node.js backend (main entry: apps/server/src/main.ts)
│   ├── ui-shell/         React dashboard (Vite)
│   └── desktop/          Electron shell
├── packages/
│   ├── lib/              Shared utilities (logger, retry, path safety, …)
│   ├── shared/           Cross-package types
│   ├── pipeline-core/    15-pass pipeline engine
│   ├── pipeline-video/   Built-in video stage definitions
│   ├── adapter-common/   AI provider adapters (Gemini, AIVideoMaker, …)
│   └── site-strategies/  Playwright site automation scripts
├── data/                 Runtime data (prompts, plugins, default config)
├── scripts/              CI helpers, acceptance tests, debug tools
├── docs/                 Extended documentation
└── demo/                 Standalone chat-automation workbench demo
```

---

## Deployment

See [`docs/deployment.md`](docs/deployment.md) for full details. Quick reference:

### Docker

```bash
# Build and run
docker build -t ai-video .
docker run -d \
  -p 3220:3220 \
  -v /your/data:/data \
  -e GEMINI_API_KEY=your_key \
  -e API_KEY=your_secret \
  ai-video
```

### Health check

```
GET /health
```

Returns `{ "status": "ok", "uptime": <seconds>, "version": "0.1.0", "ready": true }`.

---

## FAQ

**Q: Do I need a paid Gemini API key?**
A: A free-tier key works for development and small projects. For production video generation (Veo models, Imagen 3) a paid key is required.

**Q: Can I use free AI chat sites instead of the API?**
A: Yes. Configure browser-automation accounts in the Workbench (Accounts tab) for ChatGPT, Gemini, DeepSeek, or Kimi. The pipeline will fall back to these automatically when no API key is configured.

**Q: Where are projects stored?**
A: Under `DATA_DIR/projects/` (default `./data/projects/`). Each project gets its own directory with JSON artifacts and an `assets/` sub-directory for images and video clips.

**Q: How do I add a new AI provider?**
A: See [`docs/architecture.md#extending-providers`](docs/architecture.md#extending-providers). Providers implement the `AIAdapter` interface from `packages/pipeline-core/src/types/adapter.ts`.

**Q: The pipeline fails at the VIDEO_GEN stage — what should I check?**
A: 1) Verify your `aivideomakerApiKey` is set in **Config → Video Provider**. 2) Check that you have browser accounts with video-generation capability. 3) Review the scene logs in the UI for the specific error message.

**Q: How do I run in production without Playwright/Chromium?**
A: Set `ENABLE_PLUGINS=0` and ensure only API-type resources are configured. Browser automation is only needed for the chat-workbench feature and browser-based video providers.
