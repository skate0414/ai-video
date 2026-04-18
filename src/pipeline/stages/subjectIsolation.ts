/* ------------------------------------------------------------------ */
/*  Subject Isolation – visual prompt semantic validation              */
/*  Ensures each scene's visual description has a clear identifiable  */
/*  subject for reliable image codegen output.                       */
/* ------------------------------------------------------------------ */

import type { AIAdapter, Scene, LogEntry } from '../types.js';
import type { StyleAnalysisCIR } from '../../cir/types.js';
import { fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('SubjectIsolation');

export interface SubjectIsolationInput {
  scenes: Scene[];
  styleCIR: StyleAnalysisCIR;
}

export interface SubjectIsolationOutput {
  results: Array<{
    sceneId: string;
    hasIsolatedSubject: boolean;
    confidence: number;
    suggestion?: string;
    revisedPrompt?: string;
  }>;
  failedCount: number;
}

// Subject isolation is a sub-step of the STORYBOARD stage (validates visual prompts before image gen)
const log = createStageLog('STORYBOARD');

const SUBJECT_ISOLATION_PROMPT = `You are a visual prompt QA specialist. Your job is to check whether each scene's visual prompt has a CLEAR, IDENTIFIABLE primary subject that an AI image generator can render.

## SCENES TO CHECK
{scenes_json}

## WHAT TO CHECK FOR EACH SCENE
1. Is there a clear primary subject (person, object, concept visualization)?
2. Is the subject described concretely enough for AI rendering?
3. Are there too many competing subjects in one scene?
4. If the scene is abstract, is there a concrete visual metaphor?

## OUTPUT FORMAT (JSON only):
{
  "results": [
    {
      "sceneId": "scene_1",
      "hasIsolatedSubject": true/false,
      "confidence": 0.0-1.0,
      "suggestion": "if failed: what to change (null if passed)",
      "revisedPrompt": "if failed: improved prompt (null if passed)"
    }
  ]
}`;

/**
 * Run subject isolation check on storyboard scenes.
 * Ensures each visual prompt has a clear, renderable primary subject.
 * Failed scenes get revised prompts automatically.
 */
export async function runSubjectIsolation(
  adapter: AIAdapter,
  input: SubjectIsolationInput,
  onLog?: (entry: LogEntry) => void,
): Promise<SubjectIsolationOutput> {
  const emit = onLog ?? (() => {});
  const { scenes } = input;

  emit(log('Running subject isolation check on visual prompts...'));

  // Prepare scene data for the prompt (only send what's needed)
  const scenesForPrompt = scenes.map(s => ({
    sceneId: s.id,
    narrative: s.narrative,
    visualPrompt: s.visualPrompt,
  }));

  const prompt = fillTemplate(SUBJECT_ISOLATION_PROMPT, {
    scenes_json: JSON.stringify(scenesForPrompt, null, 2),
  });
  slog.debug('prompt_preview', { content: prompt.slice(0, 500) });
  slog.debug('scenes_count', { count: scenesForPrompt.length });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  slog.debug('response_received', { length: (result.text ?? '').length });
  slog.debug('response_preview', { content: (result.text ?? '').slice(0, 1000) });

  const checkData = extractJSON<any>(result.text ?? '');
  slog.debug('parsed_result', { resultsCount: checkData?.results?.length ?? 0 });

  if (!checkData?.results) {
    emit(log('Subject isolation: could not parse response — degrading all scenes to image-only for safety', 'warning'));
    return {
      results: scenes.map(s => ({
        sceneId: s.id,
        hasIsolatedSubject: false,
        confidence: 0,
        suggestion: 'Isolation check unparseable — downgraded to image-only',
      })),
      failedCount: scenes.length,
    };
  }

  const results: SubjectIsolationOutput['results'] = (checkData.results ?? []).map((r: any) => ({
    sceneId: r.sceneId ?? '',
    hasIsolatedSubject: r.hasIsolatedSubject ?? true,
    confidence: r.confidence ?? 0.7,
    suggestion: r.suggestion ?? undefined,
    revisedPrompt: r.revisedPrompt ?? undefined,
  }));

  const failedCount = results.filter(r => !r.hasIsolatedSubject).length;

  if (failedCount === 0) {
    emit(log(`Subject isolation: all ${scenes.length} scenes have clear subjects`, 'success'));
  } else {
    emit(log(`Subject isolation: ${failedCount}/${scenes.length} scenes need prompt revision`, 'warning'));
  }

  return { results, failedCount };
}

/**
 * Apply subject isolation fixes to scenes — update visual prompts
 * for scenes that failed the isolation check.
 */
export function applySubjectIsolationFixes(
  scenes: Scene[],
  isolationOutput: SubjectIsolationOutput,
): Scene[] {
  for (const result of isolationOutput.results) {
    if (!result.hasIsolatedSubject) {
      const scene = scenes.find(s => s.id === result.sceneId);
      if (scene) {
        if (result.revisedPrompt) {
          scene.visualPrompt = result.revisedPrompt;
        } else {
          // No revised prompt available — degrade to image-only for safer rendering
          scene.assetType = 'image';
        }
      }
    }
  }
  return scenes;
}
