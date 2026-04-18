/* ------------------------------------------------------------------ */
/*  Plugin auto-registration barrel – side-effect imports all plugin  */
/*  descriptors so they self-register in the PluginRegistry.          */
/*  Same pattern as stages/defs/index.ts.                             */
/* ------------------------------------------------------------------ */

import './gemini-api.js';
import './gemini-chat.js';
import './chatgpt-chat.js';
import './kling-chat.js';
import './edge-tts.js';
