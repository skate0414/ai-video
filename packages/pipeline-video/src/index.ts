/**
 * @ai-video/pipeline-video — public surface.
 *
 * Façade for the video-specific stage modules and the assembler
 * built on top of `@ai-video/pipeline-core`.
 *
 * **CIR** canonical implementation: `packages/pipeline-video/src/cir/`.
 * **Stage definitions** live in `packages/pipeline-video/src/stages/defs/`
 * and are registered here as a side-effect.
 */

export const PACKAGE_VERSION = '0.0.0';

/**
 * Side-effect import that registers every built-in video stage
 * with `@ai-video/pipeline-core`'s StageRegistry.  Apps can simply
 * `import '@ai-video/pipeline-video'` to opt into the full video
 * compilation pipeline.
 */
import './stages/defs/index.js';

/* ---- Stage entry-point modules (re-exported for direct use) ---- */
export * as capabilityAssessment from '@ai-video/pipeline-core/stages/capabilityAssessment.js';
export * as styleExtraction from '@ai-video/pipeline-core/stages/styleExtraction.js';
export * as research from '@ai-video/pipeline-core/stages/research.js';
export * as narrativeMap from '@ai-video/pipeline-core/stages/narrativeMap.js';
export * as scriptGeneration from '@ai-video/pipeline-core/stages/scriptGeneration.js';
export * as qaReview from '@ai-video/pipeline-core/stages/qaReview.js';
export * as storyboard from '@ai-video/pipeline-core/stages/storyboard.js';
export * as videoIRCompile from '@ai-video/pipeline-core/stages/videoIRCompile.js';
export * as referenceImage from '@ai-video/pipeline-core/stages/referenceImage.js';
export * as keyframeGen from '@ai-video/pipeline-core/stages/keyframeGen.js';
export * as videoGen from '@ai-video/pipeline-core/stages/videoGen.js';
export * as tts from '@ai-video/pipeline-core/stages/tts.js';
export * as refinement from '@ai-video/pipeline-core/stages/refinement.js';
export * as finalRiskGate from '@ai-video/pipeline-core/stages/finalRiskGate.js';

/* ---- Assembler ---- */
export * from './render/index.js';
