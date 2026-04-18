/* ------------------------------------------------------------------ */
/*  Edge TTS plugin – free local text-to-speech via edge-tts CLI      */
/*  Capabilities: TTS only                                            */
/* ------------------------------------------------------------------ */

import { registerPlugin } from '../registry.js';
import type { ProviderPlugin, PluginDeps } from '../types.js';

const plugin: ProviderPlugin = {
  id: 'edge-tts',
  name: 'Edge TTS',
  adapterType: 'chat',
  capabilities: {
    text: false,
    imageGeneration: false,
    videoGeneration: false,
    tts: true,
    fileUpload: false,
    webSearch: false,
  },
  costTier: 'free',
  models: [],
  routing: [
    // Free & balanced: edge-tts is free & unlimited
    {
      stages: ['TTS'],
      taskTypes: ['tts'],
      priority: 20,
    },
  ],
  createAdapter(deps: PluginDeps) {
    // Edge TTS doesn't need a pre-constructed adapter — the TTS stage
    // calls ttsProvider directly. Return chatAdapter as a placeholder
    // so routing decisions work; the stage implementation handles TTS
    // independently.
    return deps.chatAdapter;
  },
};

registerPlugin(plugin);

export default plugin;
