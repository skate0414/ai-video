/* ------------------------------------------------------------------ */
/*  promptSanitizer – content-moderation-safe text replacement        */
/* ------------------------------------------------------------------ */

/**
 * Sanitize visual prompts for 即梦's content moderation.
 * 即梦 (especially agent mode) rejects prompts with medical/anatomical keywords
 * like "brain", "neural", "consciousness", "blood", etc.
 * Replace them with safe abstract/artistic equivalents.
 */
/** @internal Exported for testing */
export function sanitizePromptForJimeng(prompt: string): string {
  // Map of sensitive English/Chinese keywords to safe replacements
  const replacements: Array<[RegExp, string]> = [
    // Anatomical / medical terms → abstract visual equivalents
    [/\bbrain\b/gi, 'glowing sphere'],
    [/\bbrains\b/gi, 'glowing spheres'],
    [/\bneural\s*pathway[s]?\b/gi, 'flowing light streams'],
    [/\bneural\s*network[s]?\b/gi, 'interconnected light network'],
    [/\bneural\b/gi, 'luminous'],
    [/\bneuron[s]?\b/gi, 'glowing orb'],
    [/\bsynaps[ei]s?\b/gi, 'spark connections'],
    [/\bcortex\b/gi, 'layered dome structure'],
    [/\bhippocampus\b/gi, 'curved crystal structure'],
    [/\bamygdala\b/gi, 'almond-shaped gem'],
    [/\bcerebr\w+\b/gi, 'organic dome'],
    [/\bconsciousness\b/gi, 'inner awareness'],
    [/\bblood\s*vessel[s]?\b/gi, 'glowing channels'],
    [/\bblood\s*flow\b/gi, 'energy flow'],
    [/\bblood\b/gi, 'life energy'],
    [/\borgan[s]?\b/gi, 'core structure'],
    [/\bsurg\w+\b/gi, 'transformation'],
    [/\bdissect\w*\b/gi, 'reveal layers'],
    // Chinese anatomical terms
    [/大脑/g, '发光球体'],
    [/神经通路/g, '流光线条'],
    [/神经元/g, '光点'],
    [/神经/g, '光脉络'],
    [/意识/g, '内在感知'],
    [/血管/g, '能量通道'],
    [/血液/g, '生命能量'],
  ];

  let result = prompt;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Sanitize visual prompts for 可灵's content moderation.
 * 可灵 rejects prompts that mention chemicals, drugs, medical procedures,
 * violence, weapons, or anatomical details.
 */
/** @internal Exported for testing */
export function sanitizePromptForKling(prompt: string): string {
  const replacements: Array<[RegExp, string]> = [
    // Chemical / drug-related terms
    [/\bchemical\s*substance[s]?\b/gi, 'luminous essence'],
    [/\bchemical[s]?\b/gi, 'ethereal substance'],
    [/\bmolecule[s]?\b/gi, 'glowing particle'],
    [/\bcompound[s]?\b/gi, 'radiant element'],
    [/\bdrug[s]?\b/gi, 'healing light'],
    [/\btoxin[s]?\b/gi, 'dark mist'],
    [/\bpoison\w*\b/gi, 'shadow'],
    [/\binjection[s]?\b/gi, 'flow of light'],
    [/\bdose\b/gi, 'pulse'],
    [/\baddiction\b/gi, 'attachment'],
    // Medical / anatomical terms
    [/\bbrain\b/gi, 'glowing sphere'],
    [/\bneural\s*pathway[s]?\b/gi, 'flowing light streams'],
    [/\bneural\b/gi, 'luminous'],
    [/\bneuron[s]?\b/gi, 'glowing orb'],
    [/\bsynaps[ei]s?\b/gi, 'spark connections'],
    [/\bcortex\b/gi, 'layered dome'],
    [/\bcerebr\w+\b/gi, 'organic dome'],
    [/\bconsciousness\b/gi, 'inner awareness'],
    [/\bblood\s*vessel[s]?\b/gi, 'glowing channels'],
    [/\bblood\s*flow\b/gi, 'energy flow'],
    [/\bblood\b/gi, 'life energy'],
    [/\borgan[s]?\b/gi, 'core structure'],
    [/\bsurg\w+\b/gi, 'transformation'],
    [/\bbody\s*fluid[s]?\b/gi, 'flowing energy'],
    [/\bcancer\w*\b/gi, 'dark cluster'],
    [/\btumor[s]?\b/gi, 'shadow mass'],
    [/\bvirus\b/gi, 'dark spore'],
    [/\bbacteria\w*\b/gi, 'tiny drifting forms'],
    [/\binfect\w*\b/gi, 'spread'],
    [/\bdisease\b/gi, 'shadow'],
    [/\bdeath\b/gi, 'stillness'],
    [/\bdie[sd]?\b/gi, 'faded'],
    [/\bkill\w*\b/gi, 'vanquished'],
    [/\bweapon[s]?\b/gi, 'tool'],
    // Violence
    [/\bexplo[sd]\w*\b/gi, 'burst of light'],
    [/\bdestro\w+\b/gi, 'dissolving'],
    [/\battack\w*\b/gi, 'encounter'],
    [/\bwar\b/gi, 'conflict'],
    // Chinese terms
    [/化学物质/g, '发光精华'],
    [/化学/g, '光华'],
    [/分子/g, '光粒'],
    [/药物/g, '能量光束'],
    [/毒素/g, '暗雾'],
    [/癌[变细胞症]*/g, '暗簇'],
    [/肿瘤/g, '暗影'],
    [/病毒/g, '暗色浮尘'],
    [/细菌/g, '微浮形体'],
    [/感染/g, '蔓延'],
    [/疾病/g, '暗影'],
    [/死亡/g, '静止'],
    [/杀[死灭伤]*/g, '消散'],
    [/大脑/g, '发光球体'],
    [/神经通路/g, '流光线条'],
    [/神经元/g, '光点'],
    [/神经/g, '光脉络'],
    [/意识/g, '内在感知'],
    [/血管/g, '能量通道'],
    [/血液/g, '生命能量'],
    [/白细胞/g, '光之守卫'],
    [/红细胞/g, '暖光粒子'],
    [/器官/g, '核心结构'],
    [/心脏/g, '发光核心'],
    [/肺/g, '呼吸之穹'],
    [/肝/g, '深色琥珀'],
    [/饥饿/g, '能量匮乏'],
    [/人体/g, '光之形体'],
    [/生存/g, '延续'],
  ];

  let result = prompt;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Aggressively rewrite a prompt after compliance rejection.
 * Strips all template framing (科普视频 instructions) and keeps only
 * the core visual description, replacing any remaining risky terms.
 */
export function rewritePromptForCompliance(prompt: string): string {
  // Extract the visual description line (after "场景描述:") if present
  const descMatch = prompt.match(/场景描述[:：]\s*(.+?)(?:\n|风格要求|请直接|$)/s);
  let visual = descMatch ? descMatch[1].trim() : prompt;

  // Remove the Chinese template wrapper entirely
  visual = visual.replace(/请根据以下场景描述[^]*?场景描述[:：]\s*/s, '');
  visual = visual.replace(/风格要求[^]*$/s, '');
  visual = visual.replace(/请直接生成[^]*$/s, '');

  // Apply Kling sanitization again on the extracted part
  visual = sanitizePromptForKling(visual);

  // Rebuild as a minimal, safe, purely visual prompt
  return `Create a cinematic motion graphics animation: ${visual.trim()}. Smooth camera movement, professional lighting, 4K quality.`;
}
