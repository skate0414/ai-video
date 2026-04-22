# Deployment & Operations Guide

This document covers environment setup, Docker deployment, all configurable environment variables, startup and shutdown procedures, and common troubleshooting steps.

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Environment Variables](#environment-variables)
3. [Local Development Setup](#local-development-setup)
4. [Docker Deployment](#docker-deployment)
5. [Reverse Proxy (nginx / Caddy)](#reverse-proxy-nginx--caddy)
6. [Startup & Shutdown](#startup--shutdown)
7. [Data Directory Layout](#data-directory-layout)
8. [Logging](#logging)
9. [Monitoring](#monitoring)
10. [Upgrading](#upgrading)
11. [Troubleshooting](#troubleshooting)

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js | 20.9.0 | 22 LTS |
| RAM | 1 GB | 4 GB |
| Disk | 5 GB | 20 GB (project artifacts accumulate) |
| FFmpeg | 5.x | 6.x |
| Chromium | 120+ | latest |

FFmpeg and Chromium are **required at runtime** — the Docker image includes both. For bare-metal installs:

```bash
# Ubuntu/Debian
sudo apt-get install -y ffmpeg chromium-browser fonts-noto-cjk

# macOS (Homebrew)
brew install ffmpeg
# Chromium is managed by Playwright; run after npm install:
npx playwright install chromium
```

---

## Environment Variables

Copy `.env.example` to `.env` and edit as needed. All variables are optional unless marked **required**.

### Core server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3220` | HTTP server port |
| `DATA_DIR` | `./data` | Root directory for all runtime data |
| `NODE_ENV` | `development` | Set to `production` in deployed environments |
| `API_KEY` | *(empty)* | If set, all API requests must include `Authorization: Bearer <API_KEY>` |
| `ALLOWED_ORIGINS` | *(empty — allow all)* | Comma-separated CORS origins, e.g. `https://app.example.com` |
| `TRUST_PROXY` | `0` | Set `1` when behind a reverse proxy that sets `X-Forwarded-For` |

### AI providers

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | *(empty)* | Google Gemini API key — enables text, image, video, and TTS via API |
| `AIVIDEOMAKER_API_KEY` | *(empty)* | AIVideoMaker REST API key |

### Pipeline engine

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_TEXT_PROVIDER` | `gemini` | Default provider for text-generation stages |
| `DEFAULT_IMAGE_PROVIDER` | `chatgpt` | Default provider for image-generation stages |
| `CANDIDATE_COUNT` | `3` | Number of video candidates generated per scene (1–5) |
| `PROJECT_STORE_BACKEND` | `sqlite` | `sqlite` or `json` — project persistence backend |
| `GLOBAL_STORE_BACKEND` | `sqlite` | `sqlite` or `json` — global config persistence backend |

### Plugin system

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_PLUGINS` | `0` | Set `1` to load out-of-tree plugins at startup |
| `PLUGINS_DIR` | `<DATA_DIR>/plugins` | Directory scanned for plugin bundles |
| `PLUGIN_TRUST_FILE` | `<DATA_DIR>/trusted-plugins.json` | JSON file listing trusted plugin IDs |
| `PLUGIN_STRICT` | `0` | Set `1` to abort startup if any plugin fails to load |

### Timeouts (milliseconds)

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAT_RESPONSE_TIMEOUT_MS` | `1200000` | Max time to wait for a chat-automation response (20 min) |
| `SELECTOR_RESOLVE_TIMEOUT_MS` | `2000` | Per-selector resolution timeout |
| `CDP_READY_TIMEOUT_MS` | `60000` | Time to wait for Chrome DevTools Protocol to become reachable |
| `CDP_CONNECT_TIMEOUT_MS` | `60000` | Individual CDP connect attempt timeout |
| `CDP_STABILIZATION_DELAY_MS` | `1500` | Stabilization pause after CDP probe succeeds |
| `CDP_PROBE_REQUEST_TIMEOUT_MS` | `3000` | Timeout per CDP HTTP probe request |
| `CDP_PROBE_POLL_INTERVAL_MS` | `1000` | Polling interval between CDP readiness probes |
| `CDP_RETRY_BACKOFF_BASE_MS` | `2000` | Base backoff per CDP retry attempt |
| `POLLINATIONS_FETCH_TIMEOUT_MS` | `45000` | Pollinations image-fetch timeout |
| `BACKEND_RESTART_DELAY_MS` | `2000` | Electron backend-launcher restart delay after crash |
| `BACKEND_FORCE_KILL_MS` | `5000` | Electron backend-launcher force-kill timeout |
| `BACKEND_HEALTH_TIMEOUT_MS` | `30000` | Electron backend health-check wait |
| `SHUTDOWN_FORCE_EXIT_MS` | `10000` | Forced exit delay after graceful shutdown begins |

### Retry counts

| Variable | Default | Description |
|----------|---------|-------------|
| `API_MAX_RETRIES` | `3` | Max retries for API calls (Gemini, etc.) |
| `FILE_UPLOAD_MAX_RETRIES` | `3` | Max retries for file uploads |
| `POLLINATIONS_MAX_ATTEMPTS` | `5` | Max attempts for Pollinations image generation |
| `CDP_MAX_RETRIES` | `3` | Max CDP connection retries |
| `MAX_CONTINUATIONS` | `3` | Max continuation requests for truncated chat responses |

### Rate limiting & SSE

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MAX` | `120` | Max requests per `RATE_LIMIT_WINDOW_MS` per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms (1 minute) |
| `MAX_SSE_CLIENTS` | `50` | Max simultaneous SSE connections |

### Selector health monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `SELECTOR_HEALTH_CHECK_INTERVAL_MS` | `300000` | How often to probe CSS selectors (5 min) |
| `SELECTOR_HEALTH_WARN_THRESHOLD` | `80` | Health score below which an SSE warning is emitted |
| `SELECTOR_HEALTH_REDETECT_THRESHOLD` | `60` | Health score below which auto-detection is triggered |

### Playwright / Electron

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | *(auto)* | Override Chromium binary path |
| `ELECTRON_CDP_PORT` | `9222` | Chrome DevTools Protocol port used by Electron shell |
| `ELECTRON_CONTROL_PORT` | `3221` | Internal control port for the Electron backend launcher |
| `ELECTRON_SHELL` | *(empty)* | Set to `1` by the Electron main process |

### Network

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_PROXY` | *(empty)* | HTTP proxy URL for outbound requests |
| `http_proxy` | *(empty)* | Lowercase alias for `HTTP_PROXY` |

---

## Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browser
npx playwright install chromium

# 3. Configure
cp .env.example .env
# Edit .env — set GEMINI_API_KEY at minimum

# 4. Start backend (TypeScript executed directly via tsx)
npm run dev
# → http://localhost:3220

# 5. Start frontend in another terminal
npm run dev:ui
# → http://localhost:5173
```

For desktop (Electron) mode:

```bash
npm run dev:desktop   # starts both UI + Electron in parallel
```

---

## Docker Deployment

### Quick start

```bash
docker build -t ai-video .
docker run -d \
  --name ai-video \
  -p 3220:3220 \
  -v /your/data:/data \
  -e DATA_DIR=/data \
  -e NODE_ENV=production \
  -e GEMINI_API_KEY=your_api_key \
  -e API_KEY=your_secret_token \
  ai-video
```

### Docker Compose

```yaml
services:
  ai-video:
    build: .
    restart: unless-stopped
    ports:
      - "3220:3220"
    volumes:
      - ai_video_data:/data
    environment:
      DATA_DIR: /data
      NODE_ENV: production
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      API_KEY: ${API_KEY}
      ALLOWED_ORIGINS: https://app.example.com
      TRUST_PROXY: "1"

volumes:
  ai_video_data:
```

### Image notes

- Base image: `node:20-slim`
- System packages installed: `ffmpeg`, `chromium`, `fonts-noto-cjk`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` is pre-set
- Frontend static files are built in Stage 1 and served from `apps/ui-shell/dist/`
- Container runs as non-root user `node`
- Health check: `GET /health` every 30 s

---

## Reverse Proxy (nginx / Caddy)

When hosting behind a reverse proxy:

1. Set `TRUST_PROXY=1` to enable `X-Forwarded-For` parsing.
2. Configure `ALLOWED_ORIGINS` with your frontend domain.
3. The SSE endpoint (`/api/events`) requires `proxy_buffering off` / `flush_interval 0` in nginx.

**nginx snippet**

```nginx
location /api/events {
    proxy_pass         http://127.0.0.1:3220;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   Connection '';
    proxy_buffering    off;
    proxy_cache        off;
    chunked_transfer_encoding on;
}

location / {
    proxy_pass http://127.0.0.1:3220;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $host;
}
```

---

## Startup & Shutdown

### Startup sequence

1. `configurePipelineCorePorts()` — wire adapter ports
2. `freezePipelineCorePorts()` — lock port configuration
3. `bootstrapServerEnvironment()` — validate port number, resolve data directory, run SQLite auto-migrations, load plugins
4. `createServerWiring()` — instantiate Workbench, PipelineService, EventBridge
5. `startServerRuntime()` — start HTTP server, register signal handlers

### Graceful shutdown

The server listens for `SIGTERM` and `SIGINT`. On receipt:

1. `server.close()` is called — no new connections are accepted.
2. Active SSE clients remain open until they disconnect or the forced exit fires.
3. If shutdown takes longer than `SHUTDOWN_FORCE_EXIT_MS` (default 10 s), the process exits with code 1.

Send `SIGTERM` to the process (Docker `docker stop`, `systemctl stop`, `kill -15 <PID>`) for graceful shutdown.

---

## Data Directory Layout

```
<DATA_DIR>/
├── projects/
│   └── <projectId>/
│       ├── project.json           Project metadata
│       ├── capability-assessment.json
│       ├── style-profile.json
│       ├── research.json
│       ├── … (other stage artifacts)
│       └── assets/
│           ├── image_scene_1.png
│           ├── video_scene_1.mp4
│           ├── audio_scene_1.wav
│           └── final.mp4
├── uploads/                       User-uploaded files
├── profiles/                      Playwright browser profiles
│   └── <accountId>/
├── plugins/                       Out-of-tree plugin bundles
├── global.db                      SQLite global store (resources, selectors, models)
├── trusted-plugins.json           Plugin allowlist
└── prompts/                       (Read-only) AI prompt templates from repo
```

> **Backup**: Back up the entire `<DATA_DIR>` to preserve all projects and configuration. `global.db` contains account credentials and API keys — treat it as sensitive.

---

## Logging

All log output is structured JSON written to stdout:

```json
{"ts":"2026-04-22T05:00:00.000Z","level":"info","module":"StageRunner","action":"stage_completed","stage":"VIDEO_GEN"}
```

| Field | Description |
|-------|-------------|
| `ts` | ISO 8601 timestamp |
| `level` | `debug` / `info` / `warn` / `error` |
| `module` | Component name (e.g. `StageRunner`, `Workbench`, `GeminiAdapter`) |
| `action` | Event identifier (snake_case) |
| *other fields* | Context-specific key/value pairs |

To collect logs in production, pipe stdout to your log aggregator (Loki, CloudWatch, Datadog, etc.):

```bash
node --import tsx apps/server/src/main.ts 2>&1 | tee /var/log/ai-video.log
```

---

## Monitoring

### Prometheus metrics

`GET /metrics` returns Prometheus-format text (requires `API_KEY` if set).

Available metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `ai_video_retries_total` | Counter | AI API retries by label and reason |
| `ai_video_quota_errors_total` | Counter | Quota errors by provider |
| `ai_video_sse_connections` | Gauge | Active SSE connections |
| `ai_video_stage_duration_seconds` | Histogram | Stage execution time by stage + status |

### JSON snapshot

`GET /api/observability/snapshot` returns the same data as structured JSON — useful for ad-hoc debugging without a Prometheus scraper.

---

## Upgrading

1. Pull the latest code / image.
2. Run `npm install` (local) or rebuild the Docker image.
3. Restart the server — it auto-migrates SQLite schemas on startup.
4. No manual migration scripts are required.

---

## Troubleshooting

### Server won't start — `invalid port`

The `PORT` environment variable is set to a non-numeric or out-of-range value. Check your `.env` and remove the `PORT` line to use the default `3220`.

---

### `GEMINI_API_KEY not set` or `401 Unauthorized` from Gemini

Set `GEMINI_API_KEY` in your `.env`. The key must have the *Generative Language API* enabled in Google Cloud Console.

---

### Pipeline stalls at `VIDEO_GEN`

1. Check `GET /api/config/environment` — confirm `ffmpegAvailable: true`.
2. Check `GET /api/providers/video-health` for provider status.
3. Open the project in the UI and inspect the stage log for the specific error.
4. If using AIVideoMaker, verify `aivideomakerApiKey` via `POST /api/config`.
5. If using browser-automation, verify the account has a valid session — open the login browser via the UI.

---

### Chromium / Playwright errors in Docker

The `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is set to `/usr/bin/chromium` in the Docker image. If Chromium fails to launch:

```bash
# Check Chromium is installed
docker exec <container> which chromium

# Check launch error
docker logs <container> 2>&1 | grep -i "chrome\|chromium\|playwright"
```

Ensure the container has at least 1 GB RAM and `--shm-size=256m` for stable Chromium operation:

```bash
docker run --shm-size=256m ...
```

---

### SSE stream disconnects frequently

- Ensure the reverse proxy does not buffer SSE responses (see [Reverse Proxy](#reverse-proxy-nginx--caddy)).
- Increase `RATE_LIMIT_MAX` if the client is sending many rapid reconnects.
- Check `GET /api/observability/snapshot` for `sse.active` — if it equals `sse.max` (50) the limit has been reached; increase `MAX_SSE_CLIENTS`.

---

### High memory usage

Each open Playwright browser context consumes ~200–400 MB. Close unused accounts via the UI (Accounts tab → close browser). The pipeline's `TempFileTracker` cleans up intermediate files after each stage, but completed project assets remain on disk until manually deleted.

---

### `project_store_migration_failed` at startup

The SQLite migration failed to read a legacy JSON project file. The file may be corrupt. Check the log for the specific file path and inspect / delete it:

```bash
ls <DATA_DIR>/projects/
cat <DATA_DIR>/projects/<projectId>/project.json  # look for JSON syntax errors
```

---

### `plugin_skipped` — plugin not in trust file

Add the plugin's ID to `<DATA_DIR>/trusted-plugins.json`:

```json
["my-plugin-id", "another-plugin-id"]
```

Then restart the server.
