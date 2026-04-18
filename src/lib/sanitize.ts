/**
 * Transcript sanitization — taint masking for style-safe reference text.
 * Masks topic-specific content (numbers, entities) to prevent content
 * contamination while preserving structural/stylistic patterns in the
 * compiler's source analysis.
 */

export function sanitizeTranscriptForStyle(
  transcript: string | undefined,
  extraBlacklist: string[] = [],
  hookText?: string,
): { sanitized: string; replaceMap: Record<string, string> } {
  if (!transcript) return { sanitized: '', replaceMap: {} };

  const replaceMap: Record<string, string> = {};
  let prefix = '';
  let suffix = transcript;

  // Preserve hook text at the beginning (learning structure, not content)
  if (hookText) {
    const normHook = hookText.trim();
    const idx = suffix.indexOf(normHook);
    if (idx !== -1) {
      prefix = suffix.slice(0, idx + normHook.length);
      suffix = suffix.slice(idx + normHook.length);
    } else if (normHook.length > 0 && suffix.startsWith(normHook.substring(0, 10))) {
      prefix = suffix.slice(0, normHook.length);
      suffix = suffix.slice(normHook.length);
    }
  }

  // 1) Mask numbers with placeholders <NUM_n>
  suffix = suffix.replace(
    /(\d+[\d.,]*\s*(?:kg|千克|克|吨|升|ml|mL|次|年|万|百万|亿|billion|million|%)?)/gi,
    (m) => {
      const key = `<NUM_${Object.keys(replaceMap).length + 1}>`;
      replaceMap[key] = m;
      return key;
    },
  );

  // 2) Mask domain-specific entities to prevent content leakage
  const commonSubjects = [
    '心脏', '肾脏', '肝脏', '白细胞', '癌变', '癌细胞', '血液',
    '大脑', '神经', '细胞', '宇宙', '星尘', '心跳', '骨骼',
    '肺', '皮肤', '免疫', '抗体', '病毒', '细菌',
  ];
  const blacklist = Array.from(new Set([...commonSubjects, ...extraBlacklist])).filter(Boolean);

  for (const w of blacklist) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(suffix)) {
      const key = `<MASK_${Object.keys(replaceMap).length + 1}>`;
      replaceMap[key] = w;
      suffix = suffix.replace(re, key);
    }
  }

  return { sanitized: prefix + suffix, replaceMap };
}

export function detectContentContamination(
  generatedText: string,
  sourceEntities: string[],
): string[] {
  if (!generatedText || !sourceEntities || sourceEntities.length === 0) return [];
  const lower = generatedText.toLowerCase();

  const found = sourceEntities.filter((e) => {
    if (!e) return false;
    const eStr = String(e).toLowerCase();
    // Skip short pure numbers to avoid false positives
    if (/^\d+$/.test(eStr) && eStr.length < 4) return false;
    return lower.includes(eStr);
  });

  return Array.from(new Set(found));
}
