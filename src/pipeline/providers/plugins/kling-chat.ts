/* ------------------------------------------------------------------ */
/*  Kling Chat plugin – free browser-based video generation           */
/*  Capabilities: video gen via 可灵 web interface                    */
/* ------------------------------------------------------------------ */

import { registerPlugin } from '../registry.js';
import type { ProviderPlugin, PluginDeps } from '../types.js';

const plugin: ProviderPlugin = {
  id: 'kling-chat',
  name: 'Kling Chat (可灵)',
  adapterType: 'chat',
  capabilities: {
    text: false,
    imageGeneration: false,
    videoGeneration: true,
    tts: false,
    fileUpload: false,
    webSearch: false,
  },
  costTier: 'free',
  models: ['可灵 2.0'],
  dailyLimits: {
    videoGenerations: 10,
  },
  routing: [
    // Free tier: only option for video gen
    {
      stages: ['VIDEO_GEN'],
      taskTypes: ['video_generation'],
      priority: 20,
    },
  ],
  createAdapter(deps: PluginDeps) {
    return deps.chatAdapter;
  },
};

registerPlugin(plugin);

export default plugin;
