/* ------------------------------------------------------------------ */
/*  Gemini API plugin – paid SDK adapter via Google GenAI             */
/*  Capabilities: text, image gen, video gen, TTS, file upload        */
/* ------------------------------------------------------------------ */

import { registerPlugin } from '../registry.js';
import type { ProviderPlugin, PluginDeps } from '../types.js';

const plugin: ProviderPlugin = {
  id: 'gemini-api',
  name: 'Gemini API',
  adapterType: 'api',
  capabilities: {
    text: true,
    imageGeneration: true,
    videoGeneration: true,
    tts: true,
    fileUpload: true,
    webSearch: true,
  },
  costTier: 'paid',
  models: [
    'gemini-3.1-pro-preview',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-flash-image',
    'imagen-3-pro',
    'imagen-4.0-generate-001',
    'veo-3.1',
  ],
  routing: [
    // Premium tier: preferred for all text/structured tasks
    {
      taskTypes: ['safety_check', 'video_analysis', 'fact_research', 'claim_verification',
                  'calibration', 'narrative_map', 'script_generation', 'quality_review', 'visual_prompts'],
      priority: 10,
      defaultModel: 'gemini-3.1-pro-preview',
    },
    // Balanced: script generation needs API for reliable JSON output
    {
      stages: ['SCRIPT_GENERATION'],
      taskTypes: ['script_generation'],
      priority: 15,
      defaultModel: 'gemini-3.1-pro-preview',
    },
    // Balanced keyframe gen via API
    {
      stages: ['KEYFRAME_GEN'],
      taskTypes: ['image_generation'],
      priority: 10,
      defaultModel: 'gemini-2.5-flash-image',
    },
    // Premium image gen
    {
      stages: ['REFERENCE_IMAGE'],
      taskTypes: ['image_generation'],
      priority: 10,
      defaultModel: 'imagen-3-pro',
    },
    {
      stages: ['KEYFRAME_GEN'],
      taskTypes: ['image_generation'],
      priority: 10,
      defaultModel: 'imagen-4.0-generate-001',
    },
    // Video gen (most expensive resource — prefer API in balanced & premium)
    {
      taskTypes: ['video_generation'],
      priority: 20,
      defaultModel: 'veo-3.1',
    },
    // Premium TTS
    {
      taskTypes: ['tts'],
      priority: 10,
      defaultModel: 'gemini-2.5-flash-preview-tts',
    },
  ],
  createAdapter(deps: PluginDeps) {
    return deps.apiAdapter;
  },
};

registerPlugin(plugin);

export default plugin;
