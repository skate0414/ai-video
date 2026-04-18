/* ------------------------------------------------------------------ */
/*  Fact Verification – cross-backend semantic validation              */
/*  Uses a DIFFERENT backend than the original research to avoid     */
/*  the "same model agrees with itself" self-consistency bias.       */
/* ------------------------------------------------------------------ */

import type { AIAdapter, ResearchData, Fact, LogEntry } from '../types.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('FactVerification');

export interface FactVerificationInput {
  topic: string;
  researchData: ResearchData;
}

export interface FactVerificationOutput {
  verifiedFacts: Fact[];
  /** Number of facts that changed confidence after verification. */
  adjustedCount: number;
  /** Facts flagged as potentially unreliable. */
  flaggedFacts: Array<{
    factId: string;
    reason: string;
    /** Suggested replacement claim when available (for research-layer UX). */
    suggestedReplacement?: string;
    /** Best source hint from original fact for manual follow-up. */
    sourceHint?: string;
  }>;
}

const log = createStageLog('RESEARCH');

const FACT_VERIFICATION_PROMPT = `You are a fact-checking specialist. Your ONLY task is to verify the accuracy of the following claims about "{topic}".

For each claim below, check whether it is factually accurate. Be skeptical — treat each claim as potentially wrong until you can confirm it.

## CLAIMS TO VERIFY
{facts_list}

## OUTPUT FORMAT (JSON only, no markdown):
{
  "verifications": [
    {
      "factId": "fact-1",
      "verdict": "confirmed" | "disputed" | "unverifiable",
      "confidence": 0.0-1.0,
      "correction": "if disputed: the correct information (null if confirmed)",
      "reason": "brief explanation of your verdict"
    }
  ]
}

RULES:
- If you are not sure, mark as "unverifiable" with low confidence
- Do NOT confirm claims just because they sound plausible
- If a number is cited, check the order of magnitude at minimum
- Common misconceptions should be flagged even if widely believed`;

/**
 * Run independent fact verification on research output.
 * Uses a separate AI call (ideally a different model) to cross-check
 * the facts produced by the research stage.
 */
export async function runFactVerification(
  adapter: AIAdapter,
  input: FactVerificationInput,
  onLog?: (entry: LogEntry) => void,
): Promise<FactVerificationOutput> {
  const emit = onLog ?? (() => {});
  const { topic, researchData } = input;

  if (!researchData.facts.length) {
    emit(log('No facts to verify, skipping'));
    return { verifiedFacts: researchData.facts, adjustedCount: 0, flaggedFacts: [] };
  }

  emit(log(`Verifying ${researchData.facts.length} research facts with independent check...`));

  const factsList = researchData.facts
    .map(f => `[${f.id}] ${f.content} (original confidence: ${f.aggConfidence})`)
    .join('\n');

  const prompt = FACT_VERIFICATION_PROMPT
    .replace('{topic}', topic)
    .replace('{facts_list}', factsList);

  slog.debug('prompt_preview', { content: prompt.slice(0, 500) });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  slog.debug('response_received', { length: (result.text ?? '').length });

  const data = extractJSON<any>(result.text ?? '');
  const verifications: any[] = data?.verifications ?? [];

  // Build lookup of verification results
  const verdictMap = new Map<string, { verdict: string; confidence: number; correction?: string; reason?: string }>();
  for (const v of verifications) {
    if (v.factId) verdictMap.set(v.factId, v);
  }

  // Adjust fact confidence based on verification
  let adjustedCount = 0;
  const flaggedFacts: Array<{
    factId: string;
    reason: string;
    suggestedReplacement?: string;
    sourceHint?: string;
  }> = [];

  const verifiedFacts = researchData.facts.map(fact => {
    const v = verdictMap.get(fact.id);
    if (!v) return fact; // no verification result — keep as is

    const updatedFact = { ...fact };

    if (v.verdict === 'confirmed') {
      // Boost confidence
      updatedFact.aggConfidence = Math.min(1.0, (fact.aggConfidence + v.confidence) / 2 + 0.1);
      if (updatedFact.aggConfidence !== fact.aggConfidence) adjustedCount++;
    } else if (v.verdict === 'disputed') {
      // Lower confidence and flag
      updatedFact.aggConfidence = Math.min(fact.aggConfidence, 0.3);
      updatedFact.type = 'disputed';
      adjustedCount++;
      const reason = v.correction ?? v.reason ?? 'Disputed by independent verification';
      flaggedFacts.push({
        factId: fact.id,
        reason,
        suggestedReplacement: v.correction ?? 'Replace this claim with a verified alternative fact in this topic cluster.',
        sourceHint: fact.sources?.[0]?.url,
      });
      emit(log(`⚠ Fact "${fact.id}" disputed: ${v.reason ?? v.correction}`, 'warning'));
    } else {
      // Unverifiable — slightly lower confidence
      updatedFact.aggConfidence = Math.min(fact.aggConfidence, 0.5);
      updatedFact.type = 'unverified';
      if (updatedFact.aggConfidence !== fact.aggConfidence) adjustedCount++;
      flaggedFacts.push({
        factId: fact.id,
        reason: v.reason ?? 'Claim is currently unverifiable',
        suggestedReplacement: 'Prefer a fact with stronger primary-source backing and reproducible numbers.',
        sourceHint: fact.sources?.[0]?.url,
      });
      emit(log(`⚠ Fact "${fact.id}" marked unverifiable: ${v.reason ?? 'insufficient evidence'}`, 'warning'));
    }

    return updatedFact;
  });

  emit(log(`Fact verification complete: ${adjustedCount} facts adjusted, ${flaggedFacts.length} flagged`, flaggedFacts.length > 0 ? 'warning' : 'success'));

  return { verifiedFacts, adjustedCount, flaggedFacts };
}
