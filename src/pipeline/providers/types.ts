/* ------------------------------------------------------------------ */
/*  Provider Plugin types — self-describing provider descriptors      */
/*  that declare capabilities, routing preferences, and an adapter    */
/*  factory. Adding a new provider = one plugin file, zero core edits */
/* ------------------------------------------------------------------ */

import type { AIAdapter } from '../types.js';
import type { PipelineStage } from '../types.js';
import type { AdapterType, QualityDecision } from '../qualityRouter.js';

/* ---- Capability flags ---- */

export interface PluginCapabilities {
  text: boolean;
  imageGeneration: boolean;
  videoGeneration: boolean;
  tts: boolean;
  fileUpload: boolean;
  webSearch: boolean;
}

/* ---- Routing preferences ---- */

export interface PluginRoutingRule {
  /** Pipeline stages this rule applies to (empty = all stages). */
  stages?: PipelineStage[];
  /** Task types this rule applies to (empty = all task types). */
  taskTypes?: string[];
  /** Priority score (higher = more preferred). Default: 0. */
  priority?: number;
  /** Default model to use when this rule matches. */
  defaultModel?: string;
}

/* ---- Dependencies bag passed to adapter factory ---- */

export interface PluginDeps {
  /** API keys indexed by provider name (e.g. { gemini: 'key...' }). */
  apiKeys?: Record<string, string>;
  /** Pre-constructed chat adapter (for browser-based plugins). */
  chatAdapter?: AIAdapter;
  /** Pre-constructed API adapter (for SDK-based plugins that share one). */
  apiAdapter?: AIAdapter;
}

/* ---- The plugin descriptor ---- */

export interface ProviderPlugin {
  /** Unique plugin identifier (e.g. 'gemini-api', 'chatgpt-chat'). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Whether this plugin uses a paid SDK or free browser automation. */
  adapterType: AdapterType;
  /** What this provider can generate. */
  capabilities: PluginCapabilities;
  /** Cost tier: free (browser) or paid (API key). */
  costTier: 'free' | 'paid';
  /** Supported model identifiers. */
  models?: string[];
  /** Routing preferences — when should this plugin be chosen? */
  routing?: PluginRoutingRule[];
  /** Free-tier daily limits (if applicable). */
  dailyLimits?: Record<string, number>;
  /** Create the AIAdapter instance this plugin provides. */
  createAdapter(deps: PluginDeps): AIAdapter | undefined;
  /** Optional runtime health check. */
  isAvailable?: () => boolean;
}

/* ---- Plugin decision (extends QualityDecision with plugin info) ---- */

export interface PluginDecision extends QualityDecision {
  /** ID of the plugin that was selected. */
  pluginId: string;
  /** ID of the fallback plugin (if any). */
  fallbackPluginId?: string;
}

/* ---- Runtime state tracked per plugin in the registry ---- */

export interface PluginState {
  plugin: ProviderPlugin;
  quotaExhausted: boolean;
}
