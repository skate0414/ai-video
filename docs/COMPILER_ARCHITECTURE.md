# How We Rebuilt an LLM Video Workflow into a Deterministic Compiler

> A 15-stage pipeline that treats LLMs as untrusted parser frontends, typed
> intermediate representations as the source of truth, and FFmpeg as the final
> linker — producing deterministic, auditable video output from natural-language
> input.

---

## 1. The Problem: "It Usually Works"

Our AI video generator started the way most LLM applications do: a chain of
prompts, each feeding its output into the next. Style analysis → script →
storyboard → images → video clips → TTS → assembly.

It worked — until it didn't. The failure modes were subtle and
non-deterministic:

| Symptom | Root Cause |
|---------|------------|
| Scene durations randomly changed between runs | Three different stages independently computed timing |
| Color palette drifted across scenes | Each stage re-read style data from a different source |
| "Video" scenes silently downgraded to images | LLM storyboard output overrode algorithmic decisions |
| TTS voice style inconsistent | Voice resolution happened at runtime with ad-hoc fallbacks |
| 60-second video came out as 45 seconds | Duration "authority" was split across 4 places |

The fundamental issue: **there was no single source of truth**. Every stage
read from a grab-bag of partially overlapping data — raw LLM output,
`styleProfile` objects, intermediate artifacts — and applied its own
interpretation. We had built an eventually-consistent distributed system where
we needed a compiler.

## 2. The Insight: LLMs Are Parsers, Not Compilers

The architectural leap came from a simple analogy:

```
Traditional Compiler          Our Pipeline
─────────────────────         ─────────────────────
Source code            →      Reference video + topic
Lexer / Parser         →      LLM stages (untrusted)
AST / IR               →      CIR (typed representations)
Optimization passes    →      Temporal planning, QA review
Code generation        →      Image / Video / TTS generation
Linker                 →      FFmpeg assembly
Binary (.exe)          →      Output video (.mp4)
```

LLMs produce useful structure from unstructured input — that's exactly what a
parser does. But parsers are **untrusted**: their output must be validated,
typed, and frozen before downstream passes can depend on it. You would never
let your parser rewrite your code generator's output.

Once we internalized this, the architecture became clear:

1. **LLMs are compiler frontends** — they parse unstructured input into typed IR
2. **CIRs are the IR** — strictly typed, validated, immutable after production
3. **Codegen stages are pure projections** — they read from the IR, never from raw LLM output
4. **FFmpeg is the linker** — it assembles generated assets into the output binary

## 3. The IR Hierarchy

We designed a three-level intermediate representation hierarchy, mirroring
real compilers:

```
HIR (High-level IR)     — Close to LLM output, partially structured
  │  StyleAnalysisCIR    visual style, pacing, tone, color palette
  │  ResearchCIR         verified facts, myths, glossary
  │  ScriptCIR           sentence-level script with beat/fact annotations
  │
  ▼
MIR (Mid-level IR)      — Fully resolved, provider-independent
  │  StoryboardCIR       per-scene visual/narrative structure
  │  TemporalPlanCIR     per-scene timing with API quantization
  │
  ▼
VideoIR (Codegen IR)    — Frozen production plan, sole downstream authority
     scenes[]            each scene: prompt, timing, voice, style, asset type
     resolution          output dimensions
     avSyncPolicy        audio–video sync strategy
     bgmRelativeVolume   background music level
```

Every CIR carries a discriminated union tag (`_cir: 'StyleAnalysis'`) and a
version number. Validators enforce structural contracts at every boundary.

### The key data structure: `VideoIRScene`

```typescript
interface VideoIRScene {
  readonly index: number;
  readonly narrative: string;          // what is spoken
  readonly visualPrompt: string;       // what is shown
  readonly colorPalette: readonly string[];  // projected from StyleCIR
  readonly lightingStyle: string;      // projected from StyleCIR
  readonly visualStyle: string;        // projected from StyleCIR
  readonly assetType: 'image' | 'video';    // compiler-decided

  // Timing (pre-resolved, not computed at runtime)
  readonly rawDurationSec: number;
  readonly apiDurationSec: number;     // quantized to [5, 8, 10, 15, 20]
  readonly ttsBudgetSec: number;

  // Audio (pre-resolved, not computed at runtime)
  readonly ttsVoice: string;           // e.g. 'zh-CN-XiaoxiaoNeural'
  readonly ttsRate: string | undefined;

  readonly emphasis: 'slow' | 'normal' | 'fast';
  readonly narrativePhase: 'hook' | 'build' | 'climax' | 'resolution' | 'cta';
}
```

Every field is `readonly`. After `VIDEO_IR_COMPILE`, the entire tree is
`deepFreeze()`'d — any mutation attempt throws at runtime.

## 4. The Compiler Barrier

The most important concept in the architecture is the **compiler barrier** at
stage 9 (`VIDEO_IR_COMPILE`):

```
   Stages 1–8                    Stage 9                    Stages 10–15
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  LLM frontends  │     │  VIDEO_IR_COMPILE    │     │  Codegen + Linker   │
│  (untrusted     │────▶│  ═══════════════     │────▶│  (pure projections  │
│   parsers)      │     │  Merge + Validate    │     │   from VideoIR)     │
│                 │     │  + deepFreeze()      │     │                     │
└─────────────────┘     └──────────────────────┘     └─────────────────────┘
  Can read: anything      Reads: ALL upstream CIRs     Can read: VideoIR ONLY
  Produces: CIR(s)        Produces: VideoIR (frozen)   Forbidden: StyleCIR,
                                                                  ScriptCIR,
                                                                  StyleProfile
```

`compileVideoIR()` performs five operations:

1. **Assert alignment** — script, storyboard, and temporal plan must have
   matching scene counts (fail-closed)
2. **Resolve voice** — `resolveVoiceFromStyle()` collapses voice preferences
   into a concrete TTS voice name
3. **Resolve rate** — `resolveRateFromPacing()` plus per-scene emphasis
   overrides produce a single rate value
4. **Promote scenes** — `ensureMinVideoScenes()` upgrades the longest
   image-only scenes to video (deterministic, not LLM-decided)
5. **Project style** — color palette, lighting, visual style are copied from
   StyleAnalysisCIR into every scene

The result is a single, frozen, self-contained production plan. Downstream
stages need nothing else.

## 5. The Pipeline

```
ANALYSIS GROUP — HIR producers (LLM frontends)
  1. CAPABILITY_ASSESSMENT    Self-assessment of available models
  2. STYLE_EXTRACTION         Reference video → StyleAnalysisCIR
  3. RESEARCH                 Topic → ResearchCIR (verified facts)

CREATION GROUP — HIR → CIR compilation
  4. SCRIPT_GENERATION        StyleCIR + ResearchCIR → ScriptCIR
  5. NARRATIVE_MAP            Outline structure planning
  6. QA_REVIEW                Cross-validation of script vs. style
  7. TEMPORAL_PLANNING        ScriptCIR + StyleCIR → TemporalPlanCIR

VISUAL GROUP — CIR → MIR → Codegen IR
  8. STORYBOARD               ScriptCIR + StyleCIR → StoryboardCIR
     └─ Subject Isolation     Last allowed mutation (pre-compile)
  9. VIDEO_IR_COMPILE         ═══ COMPILER BARRIER ═══
 10. REFERENCE_IMAGE          VideoIR → reference images
 11. KEYFRAME_GEN             VideoIR → keyframe images

PRODUCTION GROUP — codegen + linker
 12. VIDEO_GEN                VideoIR → video clips
 13. TTS                      VideoIR → speech audio
 14. ASSEMBLY                 VideoIR + assets → .mp4 (FFmpeg linker)
 15. REFINEMENT               Post-link validation
```

### Stage group boundaries are access-control boundaries

| Stage Group | Can Read | Cannot Read |
|-------------|----------|-------------|
| Analysis (1–3) | Raw input, external APIs | — |
| Creation (4–7) | StyleAnalysisCIR, ScriptCIR, ResearchCIR | — |
| Visual (8–9) | All HIR CIRs | — |
| **Production (10–15)** | **VideoIR only** | **StyleCIR, ScriptCIR, StoryboardCIR, StyleProfile** |

This access control is enforced structurally: production stages receive only a
`VideoIR` object. The typed loader gateway (`loadVideoIR()`) returns a frozen
object, and no function to load upstream CIRs is imported.

## 6. Prompt Semantic Authority

A subtle discovery during the refactor: **prompt templates are an authority
boundary**, not just string formatting.

Before the refactor, each codegen stage independently read style data to build
its prompt:

```
// Before: three different stages, three different data sources
// VIDEO_GEN read styleCIR.colorPalette directly
// REFERENCE_IMAGE read raw styleProfile
// KEYFRAME_GEN read styleProfile.visualTrack
```

This meant the same visual style could be described differently to different
generation APIs, causing visual inconsistency.

After the refactor, all generation prompts flow through a single module:

```typescript
// videoIRPromptSemantics.ts — sole prompt authority

export function buildImagePromptFromVideoIRScene(
  irScene: VideoIRScene, aspectRatio: string
): string {
  return fillTemplate(IMAGE_GEN_PROMPT, {
    visual_prompt: irScene.visualPrompt,
    color_palette: irScene.colorPalette.join(', '),
    lighting_style: irScene.lightingStyle,
    visual_style: irScene.visualStyle,
    aspect_ratio: aspectRatio,
  });
}

export function buildVideoPromptFromVideoIRScene(
  irScene: VideoIRScene, aspectRatio: string,
  durationSec: number, styleAnchor?: string
): string { /* same pattern */ }
```

Three stages (REFERENCE_IMAGE, KEYFRAME_GEN, VIDEO_GEN) call these two
functions. Nobody else builds generation prompts.

## 7. Fail-Closed Contracts

Every CIR boundary is guarded by a fail-closed validator. The contract system
uses typed error classes — never silent fallbacks:

```typescript
class CIRValidationError extends Error {
  constructor(
    public readonly stage: PipelineStage,
    public readonly cirType: string,
    public readonly violations: string[],
  ) { /* ... */ }
}
```

If `STYLE_EXTRACTION` produces a `StyleAnalysisCIR` with an empty
`colorPalette`, `validateStyleAnalysisCIR()` returns a violation.
`loadStyleCIR()` in the next stage throws a `CIRValidationError`. The
pipeline halts with a precise diagnostic — no silent degradation.

The `deepFreeze()` authority lock adds a second barrier: even if a bug
bypasses the type system, any runtime mutation of VideoIR throws a
`TypeError` in strict mode.

```typescript
export function loadVideoIR(ctx, stage): VideoIR {
  return deepFreeze(loadCIR(ctx, stage, VIDEOIR_SPEC));
}
```

## 8. What We Killed

The refactor eliminated five categories of "hidden authority":

| Eliminated Pattern | What It Was | Replaced By |
|---|---|---|
| `ensureMinVideoScenes()` in STORYBOARD | Runtime re-promotion of scene asset types | Single call in VIDEO_IR_COMPILE |
| Duration overrides in STORYBOARD | LLM `estimatedDuration` overriding temporal plan | TemporalPlanCIR as sole timing authority |
| `styleCIR` reads in VIDEO_GEN | Direct style data access bypassing IR | VideoIR-projected fields |
| `styleProfile` reads in REFERENCE_IMAGE, KEYFRAME_GEN | Raw LLM output used for prompts | `buildImagePromptFromVideoIRScene()` |
| `assetType` in STORYBOARD_PROMPT | LLM choosing image vs. video per scene | Compiler decision in VIDEO_IR_COMPILE |

## 9. Results

### Before

- Duration authority split across **4 locations**
- Style semantics read from **3 different sources** per codegen stage
- Scene `assetType` decided by LLM at storyboard time (non-deterministic)
- No way to audit "what parameters drove this scene's generation"

### After

- **1 authority** for all timing, style, and structure: VideoIR
- **1 module** for all generation prompts: `videoIRPromptSemantics.ts`
- **0 LLM-decided** runtime parameters after compilation
- Full auditability: `video-ir.cir.json` is a complete record of every
  decision that produced the output

### By the numbers

| Metric | Value |
|--------|-------|
| Pipeline stages | 15 (was 14; added VIDEO_IR_COMPILE) |
| CIR types | 7 typed intermediate representations |
| Test suite | 916 tests across 62 files, all passing |
| VideoIR fields per scene | 16 readonly fields |
| Downstream stages reading upstream CIRs | **0** |
| Lines of code: compiler core (`src/cir/`) | ~2,700 |
| Lines of code: compiler barrier + prompt hub | ~170 |

## 10. Lessons Learned

**1. "Almost deterministic" is non-deterministic.**
When three stages each compute a "reasonable" duration, the
output is non-deterministic in ways that are impossible to debug. One central
computation, frozen and passed downstream, eliminates the entire class of bugs.

**2. LLM output is untrusted input — always.**
Treating AI responses as parsed-but-unvalidated data (like user input in a web
app) gave us the right mental model. Validate at the boundary, type the
output, freeze it, and never trust it again.

**3. Prompt parameters are a semantic authority boundary.**
It's not enough to centralize runtime values. If each stage independently
builds its own prompt string from scattered data, you still get semantic
drift. The prompt builder module must be the sole entry point.

**4. `deepFreeze()` catches bugs your type system can't.**
TypeScript's `readonly` is compile-time only. In a codebase with `any` casts
and dynamic artifact loading, runtime immutability enforcement catches real
mutation bugs that types miss.

**5. The compiler metaphor is not just an analogy.**
Once we committed to "LLMs are parsers, CIRs are IR, FFmpeg is the linker,"
every design decision became obvious. Where does this logic go? Is it parsing
(frontend), optimization (middle-end), or code generation (backend)?
The answer is always clear.

---

## Appendix: Authority Map

```
Writer (sole)            CIR                  Readers (allowed)
─────────────            ───                  ─────────────────
STYLE_EXTRACTION    →    StyleAnalysisCIR     SCRIPT_GEN, QA, TEMPORAL, STORYBOARD, VIDEO_IR_COMPILE
RESEARCH            →    ResearchCIR          SCRIPT_GEN
SCRIPT_GENERATION   →    ScriptCIR            QA, TEMPORAL, STORYBOARD, VIDEO_IR_COMPILE
TEMPORAL_PLANNING   →    TemporalPlanCIR      VIDEO_IR_COMPILE
STORYBOARD          →    StoryboardCIR        VIDEO_IR_COMPILE
VIDEO_IR_COMPILE    →    VideoIR (frozen)     REF_IMAGE, KEYFRAME, VIDEO_GEN, TTS, ASSEMBLY
```

No stage downstream of `VIDEO_IR_COMPILE` may read any CIR other than
`VideoIR`. This invariant is enforced by import structure, typed loaders, and
`deepFreeze()`.
