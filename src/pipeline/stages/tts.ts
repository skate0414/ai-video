/* ------------------------------------------------------------------ */
/*  Stage 12: TTS – generate speech audio for each scene              */
/* ------------------------------------------------------------------ */

import type { Scene, LogEntry } from '../types.js';
import { generateSpeech as ttsGenerateSpeech, type TTSConfig } from '../../adapters/ttsProvider.js';
import { createStageLog } from './stageLog.js';

export interface TtsInput {
  scenes: Scene[];
  ttsConfig: TTSConfig;
  concurrency?: number;
}

const log = createStageLog('TTS');

/**
 * Generate TTS audio for each scene using edge-tts (free, no AI quota).
 * TTS is decoupled from AI adapter — runs directly via ttsProvider.
 */
export async function runTts(
  input: TtsInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, ttsConfig } = input;
  const concurrency = input.concurrency ?? 2;
  const results = scenes.map(s => ({ ...s }));

  emit(log(`Generating TTS for ${scenes.length} scenes (concurrency: ${concurrency})...`));

  let activeCount = 0;
  const promises: Promise<void>[] = [];

  for (let i = 0; i < results.length; i++) {
    const scene = results[i];
    const idx = i;

    const p = (async () => {
      while (activeCount >= concurrency) {
        await new Promise(r => setTimeout(r, 500));
      }
      activeCount++;
      try {
        const ttsResult = await ttsGenerateSpeech(scene.narrative, ttsConfig);
        if (ttsResult.audioUrl) {
          results[idx].audioUrl = ttsResult.audioUrl;
          results[idx].audioDuration = scene.estimatedDuration;
        }
        emit(log(`Scene ${scene.number} TTS generated`, 'success'));
      } catch {
        results[idx].logs.push('TTS generation failed — will use scene without voiceover');
        emit(log(`Scene ${scene.number} TTS failed (non-fatal)`, 'warning'));
      } finally {
        activeCount--;
      }
    })();
    promises.push(p);
  }

  await Promise.all(promises);

  const successCount = results.filter(s => s.audioUrl).length;
  emit(log(`TTS complete: ${successCount}/${scenes.length} scenes`, 'success'));
  return results;
}
