# API Reference

> Base URL: `http://localhost:3220` (default)

## Authentication

| Header | Format | Required |
|--------|--------|----------|
| `Authorization` | `Bearer <API_KEY>` | Only when `API_KEY` env var is set |

If `API_KEY` is not configured, all endpoints are open. The `/health` endpoint never requires auth.

## Rate Limiting

All endpoints except `/health` are rate-limited.

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Max requests per window (default: 120) |
| `X-RateLimit-Remaining` | Requests remaining |
| `Retry-After` | Seconds to wait (on 429) |

Default: 120 requests per 60 s. Configure via `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`.

---

## System

### `GET /health`

Health check. No auth, no rate limit.

```json
{ "status": "ok", "uptime": 12345, "version": "0.1.0" }
```

### `GET /api/events`

SSE stream. Emits `WorkbenchEvent` and `PipelineEvent` objects. Max connections: `MAX_SSE_CLIENTS` (default 50).

See [SSE Events](#sse-events) below for all event types.

---

## Workbench — State & Control

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/state` | Current workbench state (accounts, tasks, selectors, active chat) |
| POST | `/api/start` | Start workbench task loop |
| POST | `/api/stop` | Stop workbench task loop |
| POST | `/api/chat-mode` | Set chat mode |

**`POST /api/chat-mode`** body:
```json
{ "mode": "new" | "continue" }
```

## Workbench — Tasks

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/tasks` | Create chat tasks |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/clear` | Clear all tasks |

**`POST /api/tasks`** body:
```json
{
  "questions": ["What is X?", "Explain Y"],
  "preferredProvider": "gemini",
  "preferredModel": "Gemini 2.5 Pro",
  "attachments": ["/data/uploads/file.png"]
}
```

Response: `TaskItem[]`

## Workbench — File Upload

### `POST /api/upload`

Upload files as base64. Max total: 800 MB encoded; max single file: 500 MB decoded.

```json
{
  "files": [
    { "name": "clip.mp4", "data": "base64..." }
  ]
}
```

Response: `{ "paths": ["/data/uploads/clip.mp4"] }`

Allowed extensions: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`, `.txt`, `.srt`, `.vtt`, `.json`

## Workbench — AI Resources

Unified resource management for chat, video, and image providers.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/resources` | List all resources |
| GET | `/api/resources/by-type/:type` | Filter by type (`chat`/`video`/`image`/`multi`) |
| POST | `/api/resources` | Create resource |
| DELETE | `/api/resources/:id` | Delete resource |
| POST | `/api/resources/:id/login` | Open login browser |
| POST | `/api/resources/:id/close-login` | Close login browser |
| POST | `/api/resources/reset-quotas` | Reset all quotas |

**`POST /api/resources`** body:
```json
{
  "type": "chat",
  "provider": "gemini",
  "label": "Gemini Account 1",
  "siteUrl": "https://gemini.google.com",
  "profileDir": "/data/profiles/gemini-1",
  "capabilities": { "text": true, "imageGeneration": false }
}
```

## Workbench — Accounts (deprecated → use Resources)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/accounts` | Create account |
| DELETE | `/api/accounts/:id` | Delete account |
| POST | `/api/accounts/reset-quotas` | Reset quotas |
| POST | `/api/accounts/:id/login` | Open login browser |
| POST | `/api/accounts/:id/close-login` | Close login browser |

## Workbench — Providers

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/providers` | List all providers (builtin + custom) |
| POST | `/api/providers` | Add custom provider |
| POST | `/api/providers/from-url` | Auto-detect provider from URL |
| DELETE | `/api/providers/:id` | Delete custom provider |
| GET | `/api/providers/capabilities` | All provider capabilities |
| PUT | `/api/providers/:id/capabilities` | Update capabilities |
| GET | `/api/providers/summary` | Dashboard summary |
| GET | `/api/providers/video-health` | Video provider health status |
| GET | `/api/providers/video-health/:id/recommendation` | Failover recommendation |

## Workbench — Models

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/models/:provider` | Static model list |
| POST | `/api/models/:provider` | Auto-detect models via browser |

---

## Pipeline — Projects

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/pipeline` | List all projects |
| POST | `/api/pipeline` | Create project |
| GET | `/api/pipeline/:id` | Get project |
| DELETE | `/api/pipeline/:id` | Delete project |

**`POST /api/pipeline`** body:
```json
{
  "topic": "The Science of Sleep",
  "title": "Optional custom title",
  "qualityTier": "balanced",
  "modelOverrides": {}
}
```

`qualityTier`: `"draft"` | `"balanced"` | `"premium"`

## Pipeline — Execution

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/pipeline/:id/start` | Start pipeline (optional `videoFilePath` for reference) |
| POST | `/api/pipeline/:id/stop` | Stop execution |
| POST | `/api/pipeline/:id/pause` | Pause at next checkpoint |
| POST | `/api/pipeline/:id/resume` | Resume paused pipeline |
| POST | `/api/pipeline/:id/retry/:stage` | Retry a failed stage |
| GET | `/api/pipeline/:id/eta` | ETA in ms |

15 pipeline stages: `CAPABILITY_ASSESSMENT` → `STYLE_EXTRACTION` → `RESEARCH` → `NARRATIVE_MAP` → `SCRIPT_GENERATION` → `QA_REVIEW` → `TEMPORAL_PLANNING` → `STORYBOARD` → `VIDEO_IR_COMPILE` → `REFERENCE_IMAGE` → `KEYFRAME_GEN` → `VIDEO_GEN` → `TTS` → `ASSEMBLY` → `REFINEMENT`

## Pipeline — Scenes

| Method | Path | Purpose |
|--------|------|---------|
| PUT | `/api/pipeline/:id/scenes` | Replace all scenes |
| POST | `/api/pipeline/:id/scenes/:sceneId/regenerate` | Regenerate scene (`{feedback?: string}`) |
| POST | `/api/pipeline/:id/scenes/:sceneId/approve` | Approve scene |
| POST | `/api/pipeline/:id/scenes/:sceneId/reject` | Reject scene |

## Pipeline — Script & Style

| Method | Path | Purpose |
|--------|------|---------|
| PUT | `/api/pipeline/:id/script` | Update script text (`{scriptText}`) |
| POST | `/api/pipeline/:id/style-profile` | Set style from text or object |
| POST | `/api/pipeline/:id/approve-reference` | Approve reference images |
| POST | `/api/pipeline/:id/qa-override` | Override QA review |
| PUT | `/api/pipeline/:id/overrides` | Set model overrides per stage |

## Pipeline — Assets & Export

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/pipeline/:id/video` | Download final video (`video/mp4`) |
| GET | `/api/pipeline/:id/artifacts/:filename` | Get artifact JSON |
| GET | `/api/pipeline/:id/assets/:filename` | Get project asset file |
| GET | `/api/assets/:relPath` | Get global asset |
| GET | `/api/pipeline/:id/export` | Export project as JSON bundle |
| POST | `/api/pipeline/import` | Import project from bundle |
| GET | `/api/pipeline/:id/resource-plan` | Resource plan |
| GET | `/api/pipeline/:id/costs` | Project cost summary |

Whitelisted artifacts: `research.json`, `narrative-map.json`, `calibration.json`, `style-profile.json`, `script.json`, `qa-review.json`, `scenes.json`, `capability-assessment.json`

---

## Configuration

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config` | Get pipeline config |
| POST | `/api/config` | Update config (`{geminiApiKey?, qualityTier?, productionConcurrency?}`) |
| GET | `/api/config/environment` | Environment diagnostics |
| GET | `/api/config/tts` | TTS settings |
| POST | `/api/config/tts` | Update TTS settings |
| GET | `/api/config/tts/voices` | Available voices (query: `?locale=zh-CN`) |
| GET | `/api/config/video-provider` | Video provider config |
| POST | `/api/config/video-provider` | Update video provider config |
| GET | `/api/config/route-table` | Quality router stage→backend table |

**`GET /api/config/environment`** response:
```json
{
  "ffmpegAvailable": true,
  "edgeTtsAvailable": true,
  "playwrightAvailable": true,
  "chromiumAvailable": true,
  "nodeVersion": "v20.18.0",
  "platform": "darwin",
  "dataDir": "/data"
}
```

## Presets & Templates

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/presets` | List presets |
| GET | `/api/presets/:id` | Get preset |
| GET | `/api/style-templates` | List style templates |
| POST | `/api/style-templates` | Create template (`{name, topic, styleProfile}`) |
| GET | `/api/style-templates/:id` | Get template |
| DELETE | `/api/style-templates/:id` | Delete template |

## Setup (first-run)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/setup/status` | Environment check + setup state |
| POST | `/api/setup/install-browser` | Install Playwright Chromium (SSE stream) |
| POST | `/api/setup/install-edge-tts` | Install edge-tts (SSE stream) |
| POST | `/api/setup/complete` | Finish setup (`{geminiApiKey?}`) |

## Utility

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/data-dir` | Data directory path |
| GET | `/api/sessions` | All chat sessions |
| GET | `/api/costs` | Global cost summary |

---

## SSE Events

Connect to `GET /api/events` for real-time updates. Each message is `data: <JSON>\n\n`.

### Workbench Events

| type | payload | When |
|------|---------|------|
| `state` | `WorkbenchState` | Full state snapshot (periodic) |
| `task_started` | `{taskId, accountId}` | Task execution begins |
| `task_done` | `{taskId, answer}` | Task completed |
| `task_failed` | `{taskId, error}` | Task failed |
| `quota_exhausted` | `{accountId}` | Provider quota hit |
| `account_switched` | `{fromAccountId, toAccountId}` | Account rotation |
| `login_browser_opened` | `{accountId}` | Login browser launched |
| `login_browser_closed` | `{accountId}` | Login browser closed |
| `models_detected` | `{provider, models}` | Browser model detection done |
| `stopped` | `{}` | Workbench loop stopped |
| `active_page_crashed` | `{accountId, reason}` | Browser page/context crash |
| `selector_health_warning` | `{provider, healthScore, brokenSelectors}` | Selector degradation |
| `selectors_updated` | `{provider, source, fields}` | Selectors auto-refreshed |

### Pipeline Events

| type | payload | When |
|------|---------|------|
| `pipeline_created` | `{projectId}` | New project created |
| `pipeline_stage` | `{projectId, stage, status, progress?}` | Stage status change |
| `pipeline_artifact` | `{projectId, stage, artifactType, summary?}` | Artifact produced |
| `pipeline_log` | `{projectId, entry}` | Log entry |
| `pipeline_error` | `{projectId, stage, error}` | Stage error |
| `pipeline_complete` | `{projectId}` | All stages done |
| `pipeline_paused` | `{projectId, stage}` | Paused at checkpoint |
| `pipeline_resumed` | `{projectId, stage}` | Resumed from pause |
| `pipeline_scene_review` | `{projectId, sceneId, status}` | Scene review update |
| `pipeline_assembly_progress` | `{projectId, percent, message}` | FFmpeg assembly progress |
