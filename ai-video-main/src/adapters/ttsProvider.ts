/* ------------------------------------------------------------------ */
/*  TTS Provider – dual strategy: edge-tts local CLI + web fallback   */
/* ------------------------------------------------------------------ */

import { exec } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { GenerationResult } from '../pipeline/types.js';

const execAsync = promisify(exec);

export interface TTSConfig {
  /** Directory to save audio files */
  assetsDir: string;
  /** Voice for edge-tts (default: zh-CN-XiaoxiaoNeural) */
  voice?: string;
  /** Rate adjustment (e.g. '+10%', '-5%') */
  rate?: string;
  /** Pitch adjustment (e.g. '+0Hz') */
  pitch?: string;
  /** Whether to try edge-tts first (default: true) */
  preferLocal?: boolean;
}

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

/**
 * Auto-select an edge-tts voice based on a natural-language voice_style description.
 * Maps keywords like "male", "female", "deep", "calm", "professional" to appropriate voices.
 */
export function resolveVoiceFromStyle(voiceStyle?: string, language?: string): string {
  if (!voiceStyle) return DEFAULT_VOICE;
  const s = voiceStyle.toLowerCase();
  const isEnglish = language?.toLowerCase().includes('english');

  if (isEnglish) {
    if (s.includes('male') || s.includes('man')) {
      if (s.includes('deep') || s.includes('calm')) return 'en-US-GuyNeural';
      return 'en-US-ChristopherNeural';
    }
    return 'en-US-JennyNeural';
  }

  // Chinese voices
  if (s.includes('male') || s.includes('man') || s.includes('男')) {
    if (s.includes('deep') || s.includes('calm') || s.includes('低沉') || s.includes('沉稳')) {
      return 'zh-CN-YunjianNeural'; // deep, authoritative male
    }
    return 'zh-CN-YunxiNeural'; // warm, narrative male
  }
  if (s.includes('female') || s.includes('woman') || s.includes('女')) {
    if (s.includes('warm') || s.includes('gentle') || s.includes('温暖')) return 'zh-CN-XiaoyiNeural';
    return 'zh-CN-XiaoxiaoNeural';
  }
  return DEFAULT_VOICE;
}

/**
 * Derive a rate adjustment string from a pacing description.
 */
export function resolveRateFromPacing(pacing?: string): string | undefined {
  if (!pacing) return undefined;
  const p = pacing.toLowerCase();
  if (p.includes('fast') || p.includes('快')) return '+10%';
  if (p.includes('medium-fast') || p.includes('较快')) return '+5%';
  if (p.includes('slow') || p.includes('慢')) return '-10%';
  if (p.includes('medium-slow') || p.includes('较慢')) return '-5%';
  return undefined; // medium = default rate
}

/**
 * Generate speech using edge-tts CLI (requires `pip install edge-tts`).
 * Returns the path to the generated audio file.
 */
export async function generateSpeechLocal(
  text: string,
  config: TTSConfig,
): Promise<GenerationResult> {
  const voice = config.voice ?? DEFAULT_VOICE;
  const assetsDir = config.assetsDir;
  if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

  const filename = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`;
  const outputPath = join(assetsDir, filename);

  // Sanitize text for shell: escape single quotes, limit length
  const sanitizedText = text
    .replace(/'/g, "'\\''")
    .replace(/\n/g, ' ')
    .slice(0, 5000);

  let cmd = `edge-tts --voice "${voice}" --text '${sanitizedText}' --write-media "${outputPath}"`;

  if (config.rate) {
    cmd += ` --rate="${config.rate}"`;
  }
  if (config.pitch) {
    cmd += ` --pitch="${config.pitch}"`;
  }

  try {
    await execAsync(cmd, { timeout: 60_000 });

    if (!existsSync(outputPath)) {
      throw new Error('edge-tts produced no output file');
    }

    return {
      audioUrl: outputPath,
      model: `edge-tts/${voice}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`edge-tts failed: ${message}`);
  }
}

/**
 * Check if edge-tts is available on the system.
 */
export async function isEdgeTTSAvailable(): Promise<boolean> {
  try {
    await execAsync('edge-tts --version', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * List available edge-tts voices (filtered by locale if provided).
 */
export async function listVoices(locale?: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('edge-tts --list-voices', { timeout: 10_000 });
    const lines = stdout.split('\n').filter(l => l.startsWith('Name:'));
    const voices = lines.map(l => l.replace('Name: ', '').trim());
    if (locale) {
      return voices.filter(v => v.toLowerCase().startsWith(locale.toLowerCase()));
    }
    return voices;
  } catch {
    return [];
  }
}

/**
 * Main TTS function with automatic fallback.
 * Strategy: edge-tts (local) first → error if unavailable
 * (Web automation fallback can be added later via Workbench)
 */
export async function generateSpeech(
  text: string,
  config: TTSConfig,
): Promise<GenerationResult> {
  const preferLocal = config.preferLocal ?? true;

  if (preferLocal) {
    try {
      return await generateSpeechLocal(text, config);
    } catch (err) {
      console.warn('[tts] edge-tts failed, no fallback available:', err);
      throw err;
    }
  }

  // If local is not preferred, still try it as the only option for now
  return generateSpeechLocal(text, config);
}
