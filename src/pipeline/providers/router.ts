/* ------------------------------------------------------------------ */
/*  Plugin-based routing – capability-scored provider selection       */
/*  Replaces the hardcoded ROUTE_TABLE with dynamic scoring against   */
/*  registered plugins. Falls back to legacy routeTask() if no       */
/*  plugin matches.                                                   */
/* ------------------------------------------------------------------ */

import type { PipelineStage, ModelOverrides } from '../types.js';
import type { PluginDecision } from './types.js';
import type { PluginRegistry } from './registry.js';
import { routeTask, type AdapterType } from '../qualityRouter.js';

/**
 * Resolve the best plugin for a pipeline task.
 *
 * Steps:
 *  1. Check for user overrides (pass-through, same as legacy).
 *  2. Query PluginRegistry.findForTask() for scored candidates.
 *  3. Pick top candidate as primary, second (different costTier) as fallback.
 *  4. If no plugin matches, fall back to legacy routeTask().
 */
export function resolvePlugin(
  stage: PipelineStage,
  taskType: string,
  registry: PluginRegistry,
  overrides?: ModelOverrides,
): PluginDecision {
  // User override — pass through with a synthetic pluginId
  if (overrides?.[taskType]) {
    const ov = overrides[taskType]!;
    return {
      pluginId: '__override__',
      adapter: ov.adapter,
      model: ov.model,
      provider: ov.provider,
      reason: `User override for ${taskType}`,
    };
  }

  const candidates = registry.findForTask(stage, taskType);

  if (candidates.length === 0) {
    // No plugin can handle this — fall back to legacy routing
    const legacy = routeTask(stage, taskType);
    return { ...legacy, pluginId: '__legacy__' };
  }

  const primary = candidates[0];
  const p = primary.plugin;

  // Find the best routing rule model for this specific stage/taskType
  let model: string | undefined;
  if (p.routing) {
    for (const rule of p.routing) {
      const stageMatch = !rule.stages?.length || rule.stages.includes(stage);
      const taskMatch = !rule.taskTypes?.length || rule.taskTypes.includes(taskType);
      if (stageMatch && taskMatch && rule.defaultModel) {
        model = rule.defaultModel;
        break;
      }
    }
  }

  // Find fallback: no fallback needed in pure free mode
  const fallbackPluginId: string | undefined = undefined;

  const decision: PluginDecision = {
    pluginId: p.id,
    adapter: p.adapterType,
    provider: p.id,
    model,
    reason: `Plugin ${p.name} (score-based selection)`,
  };
  if (fallbackPluginId) decision.fallbackPluginId = fallbackPluginId;

  // If primary is quota-exhausted and fallback exists, swap
  if (primary.quotaExhausted && fallbackPluginId) {
    const fb = registry.get(fallbackPluginId)!;
    decision.pluginId = fallbackPluginId;
    decision.fallbackPluginId = p.id;
    decision.adapter = fb.adapterType;
    decision.provider = fb.id;
    decision.reason = `${p.name} 配额已用完，切换到 ${fb.name}`;
    // Re-resolve model from fallback plugin
    decision.model = undefined;
    if (fb.routing) {
      for (const rule of fb.routing) {
        const stageMatch = !rule.stages?.length || rule.stages.includes(stage);
        const taskMatch = !rule.taskTypes?.length || rule.taskTypes.includes(taskType);
        if (stageMatch && taskMatch && rule.defaultModel) {
          decision.model = rule.defaultModel;
          break;
        }
      }
    }
  }

  return decision;
}
