/**
 * Side-effect entry point: registers all built-in video pipeline stages with
 * `@ai-video/pipeline-core`'s StageRegistry.
 *
 * Usage (apps and tests that need stage registration without importing the
 * full pipeline-video public surface):
 *
 *   import '@ai-video/pipeline-video/stageDefinitions.js';
 */

import './stages/defs/index.js';

export {};
