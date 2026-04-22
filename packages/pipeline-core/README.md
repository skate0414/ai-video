# @ai-video/pipeline-core

The **compilation engine** for the AI Video monorepo. This package orchestrates the 15-pass pipeline, manages the stage registry, exposes the `PipelineService` facade, and owns the capability-port system.

---

## Port Lifecycle Convention

`pipeline-core` external capability ports follow a strict three-phase lifecycle:

1. **Configure phase** (startup only): call `configurePipelineCorePorts(ports)`.
2. **Freeze phase** (once): call `freezePipelineCorePorts()`.
3. **Runtime phase**: any `set*Port` / `reset*Port` call throws by design.

This protects runtime stability by preventing accidental hot replacement after server bootstrap.

Ports configured at startup:

| Port | Responsibility |
|------|---------------|
| `adapterHostBindingsPort` | Maps AI resource entries to adapter instances |
| `chatAutomationPort` | Browser-automation engine (Playwright) |
| `ffmpegAssemblerPort` | FFmpeg-based video/audio assembly |
| `responseParserPort` | LLM response extraction and schema validation |
| `videoProviderPort` | Video-generation provider dispatcher |
| `voiceStylePort` | TTS voice selection and style mapping |

---

## Key Exports

| Export | Description |
|--------|-------------|
| `PipelineService` | Public service facade — use this from `apps/server` |
| `PipelineOrchestrator` | Low-level stage sequencer |
| `StageRegistry` / `registerStage` | Register custom stage definitions |
| `TaskQueue` | Bounded in-memory FIFO queue |
| `ProjectStore` | SQLite / JSON project persistence |
| `withRetry` (re-export) | Retry helper from `@ai-video/lib` |
| `ARTIFACT` | Centralized registry of all artifact filenames |
| `BACKEND_PORT`, `*_TIMEOUT_MS`, etc. | All tuneable constants (see `src/constants.ts`) |

---

## Pipeline Stages

Built-in stage definitions live in `@ai-video/pipeline-video` (imported as a side-effect in `apps/server/src/main.ts`). Use `registerStage` to add custom stages before creating `PipelineService`.

See [`docs/architecture.md`](../../docs/architecture.md) for the full stage reference.

---

## Testing

```bash
# From repo root
npm test

# This package only
npx vitest run --dir packages/pipeline-core/src
```

