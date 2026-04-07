/* ---- Shared log-entry factory for all pipeline stages ---- */

import type { LogEntry, PipelineStage } from '../types.js';

/**
 * Creates a stage-scoped log factory.
 * Usage: `const log = createStageLog('RESEARCH');`
 */
export function createStageLog(stage: PipelineStage) {
  return (message: string, type: LogEntry['type'] = 'info'): LogEntry => ({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    message,
    type,
    stage,
  });
}
