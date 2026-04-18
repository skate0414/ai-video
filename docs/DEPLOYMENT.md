# Deployment Guide

## Prerequisites

| Dependency | Version | Required | Install |
|-----------|---------|----------|---------|
| Node.js | ≥ 20.9.0 | Yes | [nodejs.org](https://nodejs.org/) |
| FFmpeg | any | Yes | `brew install ffmpeg` / `apt install ffmpeg` |
| Python 3 | ≥ 3.8 | Yes | System package manager |
| edge-tts | any | Recommended | `pip install edge-tts` |
| Chromium | any | Auto-installed | Via Playwright or system package |

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install
cd ui && npm install && cd ..
cd browser-shell && npm install && cd ..

# 2. Configure (optional)
cp .env.example .env
# Edit .env — set GEMINI_API_KEY for balanced/premium tiers

# 3. Start desktop app (Electron + UI + backend)
npm run dev:desktop
```

Or use the one-click script:

```bash
bash scripts/start.sh
```

This checks all dependencies, installs missing npm packages, and launches the Electron app.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3220` | HTTP server port |
| `GEMINI_API_KEY` | — | Google Gemini API key (enables balanced/premium tiers) |
| `DATA_DIR` | OS app data or `./data` | Persistent storage directory |
| `API_KEY` | — | Bearer token for endpoint auth (empty = no auth) |
| `ALLOWED_ORIGINS` | `*` (all) | CORS whitelist (comma-separated) |
| `MAX_SSE_CLIENTS` | `50` | Maximum concurrent SSE connections |
| `RATE_LIMIT_MAX` | `120` | Requests per rate-limit window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window (ms) |
| `NODE_ENV` | — | Set to `production` for Docker |
| `HTTP_PROXY` / `http_proxy` | — | Proxy for outbound requests |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | — | Override Chromium binary path |
| `CHAT_RESPONSE_TIMEOUT_MS` | `1200000` | Max wait for chat response (20 min) |

Full list of tunable constants: see `src/constants.ts`.

---

## Docker

### Build

```bash
docker build -t ai-video .
```

Two-stage build: frontend compiled in `node:20-slim`, then copied to runtime image with FFmpeg + Chromium + CJK fonts.

### Run

```bash
docker run -d \
  --name ai-video \
  -p 3220:3220 \
  -v ai-video-data:/data \
  -e GEMINI_API_KEY=your-key-here \
  ai-video
```

### Data Persistence

The `/data` volume stores:

| Path | Content |
|------|---------|
| `/data/projects/` | Pipeline projects (scripts, scenes, artifacts, videos) |
| `/data/profiles/` | Browser login profiles (persistent cookies) |
| `/data/config.json` | Runtime configuration |
| `/data/selector-cache.json` | Auto-detected DOM selectors |
| `/data/uploads/` | Uploaded media files |

**Always mount `/data` as a volume.** Losing this directory means losing all projects and login sessions.

### Health Check

Built-in Docker health check hits `GET /health` every 30 s:

```
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3
```

External monitoring: `curl -f http://localhost:3220/health`

### Security Notes

- Runs as non-root user `node`
- Set `API_KEY` in production to require Bearer auth
- Set `ALLOWED_ORIGINS` to restrict CORS
- No secrets baked into the image — pass via environment

---

## Electron Desktop App

For end-user distribution:

```bash
# Build sidecar (backend bundled into Electron)
npm run build:sidecar

# Package platform-specific installer
npm run package:electron
```

Output: `.dmg` (macOS), `.exe` (Windows), `.AppImage` (Linux) in `browser-shell/dist/`.

Config: `browser-shell/electron-builder.json`.

---

## NPM Scripts Reference

### Development

| Script | Purpose |
|--------|---------|
| `npm run dev:desktop` | Start Electron + UI + backend (main workflow) |
| `npm run dev` | Backend only (port 3220) |
| `npm run dev:ui` | UI dev server only (port 5173) |

### Build & Test

| Script | Purpose |
|--------|---------|
| `npm run build` | TypeScript type check (`tsc --noEmit`) |
| `npm run test` | Run all Vitest tests |
| `npm run test:backend` | Type check + tests |
| `npm run typecheck` | Full type check (backend + UI) |

### Acceptance & Debug

| Script | Purpose |
|--------|---------|
| `npm run accept:backend` | Full backend acceptance test |
| `npm run accept:preflight` | Pre-flight health check |
| `npm run accept:create-project` | Create test project via API |
| `npm run accept:auto-run` | Run project through pipeline |
| `npm run debug:config` | Dump current config |
| `npm run debug:provider-dom` | Inspect video provider DOM |
| `npm run auth:seedance` | Open 即梦 login browser |
| `npm run auth:kling` | Open 可灵 login browser |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ECONNREFUSED :3220` | Backend not running | `npm run dev` or check Docker logs |
| "Profile error" toast in browser | Chromium crash flag stuck | Auto-fixed by `fixCrashedProfile()` on next launch |
| 120 s chat timeout | Selectors stale or page crash | Check `/api/providers/video-health`; re-login account |
| `edge-tts` not found | Python package missing | `pip install edge-tts` |
| FFmpeg assembly fails | FFmpeg not installed | `brew install ffmpeg` / `apt install ffmpeg` |
| "INSUFFICIENT_CREDITS" | Free-tier video credits exhausted | Wait for daily reset or add another account |
| SingletonLock prevents browser launch | Stale lock file | Auto-cleaned on startup; manually delete `profiles/*/SingletonLock` |
