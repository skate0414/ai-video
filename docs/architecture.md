# Architecture

This document explains the monorepo structure, the 15-pass pipeline, how AI providers are wired together, and how to extend the system.

---

## Table of Contents

1. [Monorepo Overview](#monorepo-overview)
2. [Package Dependency Graph](#package-dependency-graph)
3. [The 15-Pass Compilation Pipeline](#the-15-pass-compilation-pipeline)
4. [AI Provider Model](#ai-provider-model)
5. [Browser Automation Subsystem](#browser-automation-subsystem)
6. [Data Flow & Artifacts](#data-flow--artifacts)
7. [Event Bus & SSE](#event-bus--sse)
8. [Persistence Model](#persistence-model)
9. [Extending the System](#extending-the-system)

---

## Monorepo Overview

```
ai-video/
├── apps/
│   ├── server/           Main HTTP/SSE backend (Node.js, port 3220)
│   ├── ui-shell/         React 19 dashboard (Vite, port 5173 in dev)
│   └── desktop/          Electron 35 shell (embeds server + UI)
│
├── packages/
│   ├── lib/              Shared utilities
│   ├── shared/           Cross-package TypeScript types
│   ├── pipeline-core/    Engine, service facade, stage registry
│   ├── pipeline-video/   Built-in 15 video-pipeline stage definitions
│   ├── adapter-common/   AI adapter implementations
│   └── site-strategies/  Playwright site-automation scripts
│
├── data/                 Prompt templates, plugin bundles, static defaults
├── scripts/              CI verification, acceptance tests, debug tools
├── docs/                 Extended documentation (this directory)
└── demo/                 Standalone chat-automation workbench (legacy POC)
```

### Workspace resolution

`package.json` at the repo root declares `"workspaces": ["packages/*", "apps/*"]`.
`npm install` hoists all dependencies and symlinks `@ai-video/*` packages so imports resolve directly to their TypeScript source — no build step is required for development.

---

## Package Dependency Graph

```
@ai-video/app-server
  ├── @ai-video/pipeline-core
  ├── @ai-video/pipeline-video
  ├── @ai-video/adapter-common
  ├── @ai-video/site-strategies
  └── @ai-video/lib

@ai-video/pipeline-core
  ├── @ai-video/lib
  ├── @ai-video/shared
  └── @ai-video/pipeline-video  (via side-effect import at startup)

@ai-video/pipeline-video
  ├── @ai-video/pipeline-core
  └── @ai-video/shared

@ai-video/adapter-common
  ├── @ai-video/pipeline-core
  └── @ai-video/lib

@ai-video/site-strategies
  ├── @ai-video/pipeline-core
  ├── @ai-video/adapter-common
  └── @ai-video/shared

@ai-video/lib
  └── (no internal deps)

@ai-video/shared
  └── (no internal deps)
```

---

## The 15-Pass Compilation Pipeline

Each "pass" is a `PipelineStage`. Stages run sequentially. A stage's output artifact is stored as JSON in `<DATA_DIR>/projects/<projectId>/`.

| # | Stage | Group | Key output artifact |
|---|-------|-------|---------------------|
| 1 | `CAPABILITY_ASSESSMENT` | Analysis | `capability-assessment.json` |
| 2 | `STYLE_EXTRACTION` | Analysis | `style-profile.json`, `format-signature.json` |
| 3 | `RESEARCH` | Analysis | `research.json`, `research.cir.json` |
| 4 | `NARRATIVE_MAP` | Creation | `narrative-map.json` |
| 5 | `SCRIPT_GENERATION` | Creation | `script.json`, `script.cir.json` |
| 6 | `QA_REVIEW` | Creation | `qa-review.json` |
| 7 | `STORYBOARD` | Visual | `storyboard.cir.json`, `scenes.json` |
| 8 | `REFERENCE_IMAGE` | Visual | `reference_sheet.png` |
| 9 | `SUBJECT_ISOLATION` | Visual | `subject-isolation.json` |
| 10 | `KEYFRAME_GEN` | Visual | `assets/image_scene_N.png` |
| 11 | `VIDEO_GEN` | Visual | `assets/video_scene_N.mp4` |
| 12 | `TTS` | Production | `assets/audio_scene_N.wav` |
| 13 | `ASSEMBLY` | Production | `assets/final.mp4` |
| 14 | `FINAL_RISK_GATE` | Production | `final-risk-gate.json` |
| 15 | `REFINEMENT` | Production | `refinement.json` |

### Stage execution model

```
PipelineService.startPipeline(projectId)
  └── PipelineOrchestrator.run()
        └── for each StageDefinition (in order)
              └── StageRunner.run(project, stage, fn)
                    ├── transitionStage(stageStatus, stage, 'processing')
                    ├── observability.startStage()
                    ├── trace span created
                    ├── await fn()   ← stage-specific logic
                    ├── on success: transitionStage(..., 'completed')
                    └── on error:   transitionStage(..., 'error'), rethrow
```

Each `StageDefinition` is wrapped in `withRetry` (see `stageRetryWrapper.ts`) providing automatic retry with exponential backoff for transient browser and network errors.

### Intermediate Representation (CIR)

Many stages produce a CIR (Compiler Intermediate Representation) file in addition to their human-readable output. The CIR files (e.g. `script.cir.json`, `storyboard.cir.json`) carry a strict schema validated by `CIRValidationError`. Downstream stages read the CIR to ensure machine-readable structured access to the upstream output.

---

## AI Provider Model

All AI interactions go through the `AIAdapter` interface (`packages/pipeline-core/src/types/adapter.ts`):

```typescript
interface AIAdapter {
  provider: string;
  generateText(model, prompt, options?): Promise<GenerationResult>;
  generateImage?(model, prompt, aspectRatio?, negativePrompt?, options?): Promise<GenerationResult>;
  generateVideo?(model, prompt, options?): Promise<GenerationResult>;
  generateSpeech?(text, voice?, options?): Promise<GenerationResult>;
  uploadFile?(file, options?): Promise<{ uri: string; mimeType: string }>;
}
```

### Adapter implementations

| Adapter | Package | Description |
|---------|---------|-------------|
| `GeminiAdapter` | `adapter-common` | Google GenAI SDK — text, image (Gemini native + Imagen 3), video (Veo 2), TTS, file upload |
| `ChatAdapter` | `adapter-common` | Playwright browser automation — drives any chat site |
| `AIVideoMakerAdapter` | `adapter-common` | REST API for text-to-video and image-to-video |
| `FallbackAdapter` | `adapter-common` | Chains primary → fallback; promotes quota errors to switch providers |

### Adapter resolver

`AdapterResolver` (`packages/pipeline-core/src/adapterResolver.ts`) selects the correct adapter per stage and task type using a priority-ordered list of configured resources. The resolver honours per-stage model overrides and respects provider capability flags.

### Port system

`pipeline-core` exposes six **capability ports** that are configured once at startup and then frozen to prevent hot-swap:

```typescript
type PipelineCorePorts = {
  adapterHostBindingsPort: AdapterHostBindingsPort;
  chatAutomationPort:      ChatAutomationPort;
  ffmpegAssemblerPort:     FFmpegAssemblerPort;
  responseParserPort:      ResponseParserPort;
  videoProviderPort:       VideoProviderPort;
  voiceStylePort:          VoiceStylePort;
};
```

Configure in `apps/server/src/main.ts` via `configurePipelineCorePorts()` then `freezePipelineCorePorts()`.

---

## Browser Automation Subsystem

The workbench (`apps/server/src/workbench.ts`) maintains a pool of Playwright browser contexts — one per AI account — and a `TaskQueue`. The main loop picks the next pending task, assigns it to an available account, navigates to the provider's chat URL, types the prompt, waits for the response, and returns the text.

### Site strategies

Each supported AI site has a `SiteStrategy` (`packages/site-strategies/src/`) implementing:

- `navigate(page)` — load the correct URL and wait for readiness
- `submitPrompt(page, prompt, attachments?)` — type and send the prompt
- `waitForResponse(page)` — detect completion
- `extractResponse(page)` — scrape the reply text
- `extractVideoUrl(page)` — (video sites) locate the generated video URL

### Selector health monitoring

`HealthMonitor` (`packages/pipeline-core/src/healthMonitor.ts`) periodically probes CSS selectors. When the health score drops below `SELECTOR_HEALTH_REDETECT_THRESHOLD` (default 60) the monitor triggers automatic re-detection via the `chatAutomationPort`.

---

## Data Flow & Artifacts

```
[User submits topic]
        │
        ▼
[PipelineService.createProject()]  →  project.json written to disk
        │
        ▼
[PipelineService.startPipeline()]
        │ enqueues in RunQueue
        ▼
[PipelineOrchestrator.run()]
  Stage 1: CAPABILITY_ASSESSMENT
    ├─ reads: project.topic
    └─ writes: capability-assessment.json
  Stage 2: STYLE_EXTRACTION
    ├─ reads: project.styleReference (if any)
    └─ writes: style-profile.json, format-signature.json
  …
  Stage 13: ASSEMBLY
    ├─ reads: assets/video_scene_N.mp4, assets/audio_scene_N.wav
    └─ writes: assets/final.mp4
        │
        ▼
[PipelineService emits SSE events]  →  React UI updates
```

All artifact filenames are centralised in the `ARTIFACT` constant map (`packages/pipeline-core/src/constants.ts`).

---

## Event Bus & SSE

`WorkbenchEvent` objects flow through an internal `EventBridge` (`apps/server/src/workbench.events.ts`) to the SSE broadcaster in `runtime.ts`. Clients subscribe via `GET /api/events`.

Event types (`WB_EVENT`):
- `state` — full workbench state snapshot (sent immediately on connect)
- `task_updated` — single task status change
- `log` — structured log entry
- `selector_health_warning` — selector degradation detected

Pipeline events (`SSE_EVENT` from `pipeline-core`):
- `stage` — stage status transitions (`processing` / `completed` / `error`)
- `artifact` — artifact produced
- `error` — stage failure details
- `log` — pipeline log entry

---

## Persistence Model

| Store | Backend | Location |
|-------|---------|----------|
| Projects | SQLite (default) or JSON files | `<DATA_DIR>/projects/` |
| Global config (resources, selectors, models) | SQLite or JSON | `<DATA_DIR>/global.db` or individual JSON files |
| Task queue | In-memory + JSON snapshot | `<DATA_DIR>/tasks.json` |
| Pipeline artifacts | JSON files | `<DATA_DIR>/projects/<id>/` |
| Video/audio assets | Binary files | `<DATA_DIR>/projects/<id>/assets/` |
| Playwright profiles | Directory tree | `<DATA_DIR>/profiles/<accountId>/` |

Set `PROJECT_STORE_BACKEND=sqlite` and `GLOBAL_STORE_BACKEND=sqlite` (enabled by default) to use SQLite. The server auto-migrates legacy JSON files on startup.

---

## Extending the System

### Adding a new AI adapter

1. Implement `AIAdapter` in `packages/adapter-common/src/yourAdapter.ts`.
2. Export it from `packages/adapter-common/src/index.ts`.
3. Register the adapter in `AdapterResolver` or via the plugin system.

### Adding a new pipeline stage

1. Create a `StageDefinition` in `packages/pipeline-video/src/stages/yourStage.ts`:
   ```typescript
   import { registerStage } from '@ai-video/pipeline-core/index.js';
   registerStage({
     stage: 'YOUR_STAGE',
     execute: async (ctx: StageRunContext) => { … },
   });
   ```
2. Add `'YOUR_STAGE'` to the `PipelineStage` union in `packages/pipeline-core/src/pipelineTypes.ts`.
3. Import your file in `packages/pipeline-video/src/stageDefinitions.ts`.

### Adding a new site strategy

1. Create `packages/site-strategies/src/videoProviders/yourSite.ts` implementing the `VideoGenerationStrategy` interface.
2. Register it in `packages/site-strategies/src/videoSites.ts`.

### Plugins (out-of-tree)

Set `ENABLE_PLUGINS=1` and place your plugin bundle in `PLUGINS_DIR`. The plugin bundle must export a `PluginManifest` and its ID must appear in the trust file (`PLUGIN_TRUST_FILE`). See `packages/pipeline-core/src/pluginLoader.ts` for the full API.
