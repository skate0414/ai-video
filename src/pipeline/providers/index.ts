/* ------------------------------------------------------------------ */
/*  Provider plugin system barrel export                              */
/* ------------------------------------------------------------------ */

export type {
  ProviderPlugin,
  PluginCapabilities,
  PluginRoutingRule,
  PluginDeps,
  PluginDecision,
  PluginState,
} from './types.js';

export {
  PluginRegistry,
  registerPlugin,
  getGlobalPluginRegistry,
} from './registry.js';

export { resolvePlugin } from './router.js';
