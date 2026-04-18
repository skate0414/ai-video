/* ------------------------------------------------------------------ */
/*  ChatGPT Chat plugin – free browser-based ChatGPT automation       */
/*  Capabilities: text, image gen (DALL-E)                            */
/* ------------------------------------------------------------------ */

import { registerPlugin } from '../registry.js';
import type { ProviderPlugin, PluginDeps } from '../types.js';

const plugin: ProviderPlugin = {
  id: 'chatgpt-chat',
  name: 'ChatGPT Chat',
  adapterType: 'chat',
  capabilities: {
    text: true,
    imageGeneration: true,
    videoGeneration: false,
    tts: false,
    fileUpload: false,
    webSearch: false,
  },
  costTier: 'free',
  models: ['gpt-4o'],
  dailyLimits: {
    textQueries: 40,
    imageGenerations: 10,
  },
  routing: [
    // Free tier: preferred for image generation (ChatGPT DALL-E)
    {
      stages: ['REFERENCE_IMAGE', 'KEYFRAME_GEN'],
      taskTypes: ['image_generation'],
      priority: 15,
    },
    // Balanced: reference image free-first with fallback to API
    {
      stages: ['REFERENCE_IMAGE'],
      taskTypes: ['image_generation'],
      priority: 10,
    },
  ],
  createAdapter(deps: PluginDeps) {
    return deps.chatAdapter;
  },
};

registerPlugin(plugin);

export default plugin;
