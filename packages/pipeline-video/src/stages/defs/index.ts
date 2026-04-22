/* ------------------------------------------------------------------ */
/*  pipeline-video stage registration bridge                          */
/*  Registers all built-in video pipeline stages with pipeline-core's */
/*  StageRegistry. Import this module (or @ai-video/pipeline-video)   */
/*  before using PipelineOrchestrator or PipelineService.             */
/* ------------------------------------------------------------------ */

import './analysisStages.js';
import './creationStages.js';
import './visualStages.js';
import './productionStages.js';

export {};
