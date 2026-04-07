/* ------------------------------------------------------------------ */
/*  Stage 2: Research – topic research + fact collection               */
/* ------------------------------------------------------------------ */

import type { AIAdapter, ResearchData, StyleProfile, LogEntry } from '../types.js';
import { RESEARCH_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

export interface ResearchInput {
  topic: string;
  styleProfile: StyleProfile;
  /** Suspicious numeric claims from style extraction to verify */
  suspiciousNumericClaims?: Array<{
    claim: string;
    value: string;
    context: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

const log = createStageLog('RESEARCH');

/**
 * Run the research stage:
 * 1. Search for verified facts on the topic
 * 2. Identify myths and glossary terms
 * 3. (Optional) Cross-validate claims using a different provider
 */
export async function runResearch(
  adapter: AIAdapter,
  input: ResearchInput,
  onLog?: (entry: LogEntry) => void,
): Promise<ResearchData> {
  const emit = onLog ?? (() => {});

  emit(log('Researching topic facts and data...'));

  // Build claim verification addendum if there are suspicious claims
  let claimAddendum = '';
  if (input.suspiciousNumericClaims?.length) {
    const claimsList = input.suspiciousNumericClaims
      .map(c => `- "${c.claim}" (value: ${c.value}, severity: ${c.severity})`)
      .join('\n');
    claimAddendum = `\n\nADDITIONAL TASK: The following numeric claims from the reference video need verification. For each, include a claimVerification entry:\n${claimsList}`;
    emit(log(`Verifying ${input.suspiciousNumericClaims.length} suspicious numeric claims...`));
  }

  const prompt = fillTemplate(RESEARCH_PROMPT, {
    topic: input.topic,
  }) + claimAddendum;

  // Only request Google Search grounding when the adapter supports it (Gemini API).
  // ChatAdapter ignores `tools`, so passing it is harmless but misleading in logs.
  const supportsGrounding = adapter.provider === 'gemini' || adapter.provider === 'fallback';
  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
    ...(supportsGrounding ? { tools: [{ googleSearch: {} }] } : {}),
  });

  const researchData = extractJSON<any>(result.text ?? '');
  if (!researchData) {
    throw new Error('Failed to parse research results as JSON');
  }

  // Normalize the data structure
  const facts = (researchData.facts ?? []).map((f: any, i: number) => ({
    id: f.id ?? `fact-${i + 1}`,
    content: f.content ?? '',
    sources: (f.sources ?? []).map((s: any) => ({
      url: s.url ?? '',
      title: s.title ?? '',
    })),
    aggConfidence: f.aggConfidence ?? 0.7,
    type: f.type ?? 'verified',
  }));

  const output: ResearchData = {
    facts,
    myths: researchData.myths ?? [],
    glossary: researchData.glossary ?? [],
    claimVerifications: researchData.claimVerifications,
  };

  emit(log(`Research complete: ${facts.length} facts, ${output.myths?.length ?? 0} myths`, 'success'));

  return output;
}
