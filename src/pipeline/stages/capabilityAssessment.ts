/* ------------------------------------------------------------------ */
/*  Pass 1: Capability Assessment – provider capability probing       */
/*  Probes available backend capabilities before pipeline runs.       */
/* ------------------------------------------------------------------ */

import type { AIAdapter, LogEntry } from '../types.js';
import type { ProviderCapabilityRegistry } from '../providerRegistry.js';
import { runSafetyMiddleware } from '../safety.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('CapabilityAssessment');

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
 * Probes available provider capabilities (text, image, video, etc.).
 */
export async function runCapabilityAssessment(
  _adapter: AIAdapter,
  input: CapabilityAssessmentInput,
  onLog?: (entry: LogEntry) => void,
): Promise<CapabilityAssessmentOutput> {
  const emit = onLog ?? (() => {});

  // Topic safety check — run local safety middleware on the topic text
  const safetyReport = runSafetyMiddleware(input.topic);
  let safetyCheck: { safe: boolean; reason?: string };
  if (safetyReport.suicideDetected || safetyReport.medicalClaimDetected) {
    const reasons = safetyReport.categories.filter(c => c === 'suicide_risk' || c === 'medical_claim');
    safetyCheck = { safe: false, reason: `Topic blocked: ${reasons.join(', ')}` };
    emit(log(`Safety check FAILED: ${safetyCheck.reason}`, 'error'));
  } else {
    safetyCheck = { safe: true, reason: 'Topic passed safety check' };
    emit(log('Safety check passed'));
  }

  // Provider capability probing (non-blocking, best-effort)
  const probedProviders: string[] = [];
  if (input.providerRegistry && input.providerIds?.length) {
    emit(log(`Detected ${input.providerIds.length} configured provider(s):`));
    for (const providerId of input.providerIds) {
      try {
        const existing = input.providerRegistry.get(providerId);
        if (existing) {
          probedProviders.push(providerId);
          const profile = existing.profileExists ? '✅ profile exists' : '❌ no profile dir';
          const quota = existing.quotaExhausted ? ' [quota exhausted]' : '';
          emit(log(`  ${providerId}: text=${existing.text}, image=${existing.imageGeneration}, video=${existing.videoGeneration}, search=${existing.webSearch}, upload=${existing.fileUpload} — ${profile}${quota}`, 'info'));
        }
      } catch {
        emit(log(`  ${providerId}: ❌ failed to query capabilities`, 'warning'));
      }
    }
  } else {
    emit(log('⚠️ No providers configured — please add accounts in Settings', 'warning'));
  }

  return { safetyCheck, probedProviders };
}
