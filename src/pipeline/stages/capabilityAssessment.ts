/* ------------------------------------------------------------------ */
/*  Stage 1: Capability Assessment – safety pre-check on topic        */
/*  + optional provider capability probing                            */
/* ------------------------------------------------------------------ */

import type { AIAdapter, LogEntry } from '../types.js';
import { SAFETY_PRE_CHECK_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import type { ProviderCapabilityRegistry } from '../providerRegistry.js';
import { createStageLog } from './stageLog.js';

export interface CapabilityAssessmentInput {
  topic: string;
  /** Optional: provider registry to update with probing results. */
  providerRegistry?: ProviderCapabilityRegistry;
  /** Optional: list of provider IDs to probe for capabilities. */
  providerIds?: string[];
}

export interface CapabilityAssessmentOutput {
  safetyCheck: { safe: boolean; reason?: string };
  /** Probed provider capabilities (if providerRegistry was provided). */
  probedProviders?: string[];
}

const log = createStageLog('CAPABILITY_ASSESSMENT');

/**
 * Run capability assessment:
 * 1. Safety pre-check on the topic (medical, self-harm, political, hate speech)
 * 2. Optional provider capability probing (if registry provided)
 */
export async function runCapabilityAssessment(
  adapter: AIAdapter,
  input: CapabilityAssessmentInput,
  onLog?: (entry: LogEntry) => void,
): Promise<CapabilityAssessmentOutput> {
  const emit = onLog ?? (() => {});

  emit(log('Running safety pre-check on topic...'));
  const safetyPrompt = fillTemplate(SAFETY_PRE_CHECK_PROMPT, { topic: input.topic });
  const safetyResult = await adapter.generateText('', safetyPrompt, {
    responseMimeType: 'application/json',
  });

  const safetyCheck = extractJSON<{ safe: boolean; reason?: string }>(safetyResult.text ?? '') ?? { safe: true };
  if (!safetyCheck.safe) {
    emit(log(`Safety concern: ${safetyCheck.reason}`, 'warning'));
  } else {
    emit(log('Topic passed safety pre-check', 'success'));
  }

  // Provider capability probing (non-blocking, best-effort)
  const probedProviders: string[] = [];
  if (input.providerRegistry && input.providerIds?.length) {
    emit(log(`Probing ${input.providerIds.length} provider capabilities...`));
    for (const providerId of input.providerIds) {
      try {
        const existing = input.providerRegistry.get(providerId);
        if (existing) {
          probedProviders.push(providerId);
          emit(log(`Provider ${providerId}: text=${existing.text}, image=${existing.imageGeneration}, video=${existing.videoGeneration}, search=${existing.webSearch}`, 'info'));
        }
      } catch {
        emit(log(`Failed to probe provider ${providerId}`, 'warning'));
      }
    }
  }

  return { safetyCheck, probedProviders };
}
