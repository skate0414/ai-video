/* ------------------------------------------------------------------ */
/*  Prompt templates – compiler frontend instruction set              */
/*  Each prompt programs the LLM "parser" for a specific compilation  */
/*  pass, producing structured CIR-compatible output.                 */
/* ------------------------------------------------------------------ */

/**
 * Template substitution helper.
 * Replaces {key} placeholders with values from the vars object.
 */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`{${k}}`, String(v));
  }
  return result;
}

/* ---- Stage 0: Self-Assessment (pre-extraction) ---- */

export const ANALYSIS_SELF_ASSESSMENT_PROMPT = `I am building a science explainer video style transfer tool.

PRODUCT OVERVIEW:
- Input: one viral 3D animated science explainer video + a new topic
- Output: a new video that replicates the original video's style
- Video type: 3D animated science short-form content (60-300 seconds)
- Each voiceover sentence maps to one independent 3D animation scene

FULL GENERATION PIPELINE:
StyleDNA Extraction → Script Generation → Compliance Check →
Scene Decomposition → Visual Prompt Generation → Keyframe Generation
→ Image-to-Video → BGM Generation → TTS Voiceover → FFmpeg Assembly

STYLE DNA SERVES THREE DOWNSTREAM PIPELINES:
- Script pipeline: constrains narrative structure, sentence style, and pacing
- Visual pipeline: constrains image/video generation for keyframes and clips
- Audio pipeline: constrains music generation for BGM mood and style

Before I ask you to extract the DNA, answer these five questions
about your own capabilities as the sole executor of this task:

Q1. For the SCRIPT pipeline:
    Which fields can you extract accurately from a video,
    and in what format? Be specific about what you can
    observe directly versus what you are inferring.

Q2. For the VISUAL pipeline:
    Which fields can you extract accurately, and which
    fields are directly usable as image/video generation
    prompt keywords?

Q3. For the AUDIO pipeline:
    Which fields can you extract accurately, and which
    fields are directly usable as music generation
    prompt keywords?

Q4. CONFIDENCE SELF-ASSESSMENT:
    For each field you propose, explicitly state:
    - "confident" if you can extract it reliably
      from visual/audio observation
    - "inferred" if you are making an educated guess
    Tell me WHY for each rating.

Q5. BLIND SPOTS:
    Are there any fields you could extract from this video
    that I have NOT asked about, but that would have
    significant impact on downstream generation quality?

Output your answer as a structured assessment,
NOT as JSON. Use plain text with clear section headers.
This is a dialogue, not an extraction task.`;

/* ---- Stage 1: Analysis / StyleDNA Extraction ---- */

export const STYLE_EXTRACTION_PROMPT = `You are a video style analysis expert. Analyze the provided reference video and extract a detailed "Style DNA" profile.

## ANALYSIS REQUIREMENTS

You must analyze THREE tracks with per-field confidence tagging:

### Track A – Script
Analyze: narrative structure, hook strategy, emotional tone arc, rhetorical devices, sentence patterns, interaction cues, CTA pattern, jargon treatment, metaphor usage.

### Track B – Visual
Analyze: base medium, lighting, camera motion, composition, color palette, color temperature, scene duration, transition style, b-roll ratio, visual metaphor mapping.

### Track C – Audio
Analyze: BGM genre/mood/tempo, voice style, relative volume, audio-visual sync points.

### Track D – Packaging
Analyze: subtitle rendering style (position, font category, color, shadow, backdrop), transition style and duration, intro/outro cards (presence and duration), fade-in/fade-out (presence and duration).

## CONFIDENCE TAGGING
For EVERY field, assign a confidence level in the "nodeConfidence" object:
- "confident" — directly observed from video
- "inferred" — educated guess based on limited evidence
- "guess" — no direct evidence, using domain defaults

## SUSPICIOUS CLAIMS
If the video contains numeric claims that seem exaggerated or unverifiable, list them in "suspiciousNumericClaims" for downstream research verification.

## OUTPUT FORMAT
Output a single JSON object (no markdown code blocks, first char must be {, last must be }):
{
  "meta": {
    "video_language": "Chinese or English",
    "video_duration_sec": number,
    "video_type": "e.g. science explainer, educational, documentary"
  },
  "visualStyle": "e.g. 3D animated, cinematic, motion graphics",
  "pacing": "fast/medium/slow",
  "tone": "e.g. informative, emotional, humorous",
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "colorPaletteByMood": {
    "emotional": ["#warm1", "#warm2", "#warm3"],
    "scientific": ["#cool1", "#cool2", "#cool3"],
    "metaphorical": ["#cosmic1", "#cosmic2", "#cosmic3"]
  },
  "targetAudience": "description of target audience",
  "narrativeStructure": ["Hook", "Problem", "Mechanism", "Climax", "CTA"],
  "hookType": "Question/ShockingStat/Story/VisualHook",
  "callToActionType": "Subscribe/LearnMore/Reflect/None",
  "wordCount": number,
  "wordsPerMinute": number,
  "emotionalIntensity": 1-5,
  "audioStyle": {
    "genre": "string",
    "mood": "string",
    "tempo": "slow/medium/fast",
    "intensity": 1-5,
    "instrumentation": ["instrument1", "instrument2"]
  },
  "track_a_script": {
    "hook_strategy": "how the video opens — question/statistic/story/visual",
    "hook_example": "first 2-3 sentences from transcript",
    "narrative_arc": ["stage1", "stage2", ...],
    "emotional_tone_arc": "description of emotional progression through the video",
    "rhetorical_core": "key rhetorical devices used (e.g. analogy, contrast, repetition)",
    "sentence_length_avg": "number — average character/word count PER SINGLE SENTENCE (NOT total script length)",
    "sentence_length_max": "number — character/word count of the LONGEST SINGLE SENTENCE in the transcript",
    "sentence_length_unit": "characters or words",
    "interaction_cues_count": number,
    "cta_pattern": "CTA structural template — describe the sentence pattern (e.g., 'imperative phrase (好好+verb) + connector (因为) + comparative structure (比你想象的更+adj)')",
    "metaphor_count": number,
    "jargon_treatment": "simplified/technical/mixed — how jargon is handled"
  },
  "track_b_visual": {
    "base_medium": "3D animation / live action / motion graphics / mixed",
    "lighting_style": "e.g. soft cinematic, high contrast, flat",
    "camera_motion": "e.g. slow pan, orbit, static, dynamic tracking",
    "color_temperature": "warm/neutral/cool",
    "scene_avg_duration_sec": number,
    "transition_style": "cut/dissolve/morph/zoom",
    "visual_metaphor_mapping": {
      "rule": "general rule for visual metaphors (e.g., 'All abstract biology processes should be depicted as epic cinematic 3D scenes with humanized emotions')",
      "examples": [
        { "concept": "abstract concept from video", "metaphor_visual": "visual representation used" }
      ]
    },
    "b_roll_ratio": 0.0-1.0,
    "composition_style": "centered/rule-of-thirds/dynamic"
  },
  "track_c_audio": {
    "bgm_genre": "string",
    "bgm_mood": "string",
    "bgm_tempo": "slow/medium/fast",
    "bgm_relative_volume": 0.0-1.0,
    "voice_style": "description of narrator voice characteristics",
    "audio_visual_sync_points": ["description of key sync moments"]
  },
  "track_d_packaging": {
    "subtitle_position": "bottom/top/center — where subtitles appear on screen",
    "subtitle_has_shadow": true/false,
    "subtitle_has_backdrop": true/false,
    "subtitle_font_size": "small/medium/large — relative to video frame",
    "subtitle_primary_color": "#RRGGBB — hex color of subtitle text",
    "subtitle_outline_color": "#RRGGBB — hex color of subtitle outline/stroke",
    "subtitle_font_category": "sans-serif/serif/handwritten/monospace",
    "transition_dominant_style": "cut/dissolve/fade/zoom/morph/wipe — most common transition",
    "transition_estimated_duration_sec": number,
    "has_intro_card": true/false,
    "intro_card_duration_sec": number,
    "has_fade_in": true/false,
    "fade_in_duration_sec": number,
    "has_outro_card": true/false,
    "outro_card_duration_sec": number,
    "has_fade_out": true/false,
    "fade_out_duration_sec": number
  },
  "fullTranscript": "complete transcript of the video",
  "nodeConfidence": {
    "field_name": "confident/inferred/guess",
    ...
  },
  "suspiciousNumericClaims": [
    {
      "claim": "the original claim text",
      "value": "the numeric value",
      "context": "surrounding context",
      "severity": "low/medium/high"
    }
  ]
}`;

/* ---- Stage 2: Research ---- */

export const RESEARCH_PROMPT = `You are a research assistant for a science video production system.

New topic: {topic}

Search for and compile research data on this topic.

Requirements:
1. Find 5-7 verified facts with reliable sources
2. Identify 2-3 common myths or misconceptions
3. Create a glossary of key terms (3-5 terms)
4. Each fact must be specific enough to use as a data point in a video script (include numbers/comparisons where possible)
5. Each fact must be visually imaginable as a 3D animation scene

Output as JSON (no markdown code blocks, raw JSON only):
{
  "facts": [
    {
      "id": "fact-1",
      "content": "Fact description in the video's language",
      "sources": [{ "url": "source URL or reference", "title": "source title" }],
      "aggConfidence": 0.0-1.0,
      "type": "verified"
    }
  ],
  "myths": ["myth 1", "myth 2"],
  "glossary": [
    { "term": "term", "definition": "definition" }
  ]
}`;

/* ---- Stage 3A: Calibration + Fact Verification ---- */

export const CALIBRATION_PROMPT = `You are a research assistant for a science explainer video production system.

Your task has TWO parts. Output a single JSON object (no markdown code blocks).

PART 1: SPEECH RATE CALIBRATION
Reference video data:
- video_duration_sec: {video_duration_sec}
- total_words: {total_words}
- video_language: {video_language}

Calculate:
1. actual_speech_rate = total_words / video_duration_sec * 60
2. target_word_count = actual_speech_rate * {video_duration_sec} / 60

PART 2: NARRATIVE MAP
Using the calibration and reference style below, generate a narrative map.

Reference narrative arc stages: {narrative_arc}
Hook type: {hook_strategy}
CTA pattern: {cta_pattern}
Target total duration: {video_duration_sec} seconds

New topic: {topic}

Output JSON:
{
  "calibration": {
    "reference_total_words": number,
    "reference_duration_sec": number,
    "actual_speech_rate": "X words/characters per minute",
    "new_video_target_duration_sec": number,
    "target_word_count": number,
    "target_word_count_min": "target * 0.9",
    "target_word_count_max": "target * 1.1"
  },
  "verified_facts": [
    {
      "fact_id": 1,
      "content": "fact content",
      "source_marker": "研究显示 / 据统计 / 科学家发现",
      "visual_potential": "how this can be visualized",
      "recommended_stage": "which narrative stage"
    }
  ],
  "narrative_map": [
    {
      "stage_index": 1,
      "stage_title": "stage title",
      "description": "what this stage achieves",
      "estimated_duration_sec": number,
      "target_word_count": number,
      "fact_references": [1, 2]
    }
  ]
}`;

/* ---- Stage 3B: Script Generation ---- */

export const SCRIPT_SYSTEM_PROMPT = `You are a science explainer video scriptwriter specializing in emotionally resonant, high-retention short-form content.

Your scripts are for 3D animated videos. Each sentence will be rendered as a separate 3D animation scene, so every sentence must be visually concrete.

ABSOLUTE RULES:
1. Write entirely in {video_language}
2. Every style constraint below is a HARD requirement — deviation means failure
3. Content must be scientifically accurate — never fabricate data, statistics, or research findings
4. This is science communication, not medical advice — never provide diagnosis or treatment recommendations
5. Output strictly valid JSON only (first char must be {, last must be })
6. NEVER include placeholder text like [INSERT], [TODO], or TBD
7. Every numeric claim MUST have a source marker (研究显示/据统计/科学家发现)
8. If you cannot verify a fact, omit it rather than guess
9. Maintain consistent tone throughout — do not mix formal/informal registers
10. Each sentence must be independently filmable as a 3D scene
11. ZERO PLAGIARISM: Do NOT copy any sentence, phrase (>6 characters), fact, statistic, or metaphor from the reference transcript. Learn ONLY the rhythm, sentence structure, and emotional arc — then write ENTIRELY ORIGINAL content about the new topic. If any phrase resembles the reference, rewrite it completely`;

export const SCRIPT_USER_PROMPT = `# SCRIPT GENERATION — STYLE DNA CONSTRAINTS

## Section 1: Topic & Target
Target topic: {topic}
Target audience: {target_audience}

## Section 2: Length Calibration
Target word count: {target_word_count} (HARD range: {target_word_count_min} - {target_word_count_max})
Target duration: {target_duration_sec} seconds
Reference speech rate: {speech_rate}
Target sentence count: {target_sentence_count} (HARD requirement — each sentence becomes one video scene)

────────────────────────────────────────────────────────────────
## Section 3: Hook
────────────────────────────────────────────────────────────────
Hook strategy: {hook_strategy}

Reference hook from original video（学习句式结构和情感冲击方式，不抄内容）:
「{hook_example}」

Your opening must:
- Use {hook_strategy} as the primary opening strategy
- Complete the hook within 3 sentences
- Use second-person address from the very first sentence
- Achieve the same emotional punch as the reference hook

────────────────────────────────────────────────────────────────
## Section 3.5: Retention Architecture
────────────────────────────────────────────────────────────────
Short-form video viewers drop off at predictable points.
Your script MUST embed retention devices at these beats:

1. **Sentence 1-3 (0-5s)**: Cognitive dissonance hook — present an
   unexpected fact + implicit "why?" that creates an information gap.
   The viewer must feel "that can't be right" or "I need to know more".

2. **Sentence ~8 (15-20s)**: Pattern interrupt — break the established
   rhythm with a short punchy sentence, a rhetorical question, or a
   surprising pivot. This counters the 15s attention cliff.

3. **Every 4-5 sentences**: Curiosity gap — plant an unresolved question
   or tease ("但这还不是最可怕的部分", "接下来的发现彻底颠覆了认知").
   NEVER go more than 5 consecutive sentences without a forward pull.

4. **Sentence ~15 (30-40s)**: Second hook — re-engage with a new
   surprising angle or escalation. Viewers who reach 30s will likely
   finish, but only if momentum is maintained.

5. **Final 3 sentences**: Payoff + open loop — deliver the emotional
   climax, then end with a thought that lingers (question, implication,
   or call to reflection). Do NOT let the ending feel "closed".

CRITICAL: These retention beats are NON-NEGOTIABLE. A script that
lacks curiosity gaps will be rejected by quality validation.

────────────────────────────────────────────────────────────────
## Section 4: Narrative Structure
────────────────────────────────────────────────────────────────
Follow this exact stage sequence. Each stage must be clearly
distinguishable in tone and content:

{narrative_arc_expanded}

Emotional tone arc: {emotional_tone_arc}

This arc must map directly to your narrative stages.
Do not flatten it. The audience must feel the escalation
and then the resolution.

────────────────────────────────────────────────────────────────
## Section 5: Rhetorical Requirements
────────────────────────────────────────────────────────────────
Apply these rhetorical devices consistently:

{rhetorical_core_expanded}

────────────────────────────────────────────────────────────────
## Section 6: Sentence Length
────────────────────────────────────────────────────────────────
Unit: {sentence_length_unit}
Average: {sentence_length_avg} {sentence_length_unit}
Hard maximum: {sentence_length_max} {sentence_length_unit}
  Exception context: {sentence_length_max_context}
Interaction cues target: {interaction_cues_count}
Jargon treatment: {jargon_treatment}

CRITICAL: Every sentence becomes one 3D animation scene.
Sentences that are too long cannot be animated effectively.
When in doubt, split one long sentence into two short ones.

Pacing: {pacing}
Emotional intensity: {emotional_intensity} (1-5 scale)

────────────────────────────────────────────────────────────────
## Section 7: Reference Style Example
────────────────────────────────────────────────────────────────
The following is a MASKED transcript excerpt from the reference video.
Content-specific entities are replaced with placeholders to prevent contamination.

⚠️ ANTI-PLAGIARISM DIRECTIVE:
- You may ONLY learn: sentence length pattern, punctuation rhythm, narrative pacing, emotional progression
- You must NOT copy: any phrase (>6 chars), facts, statistics, metaphors, examples, or topic-specific vocabulary
- Every sentence you write must be 100% original, about the NEW topic ({topic})
- If in doubt, DO NOT reference this excerpt at all — the structural constraints above are sufficient

Reference style sample (for rhythm analysis ONLY):
---
{reference_transcript_excerpt}
---

────────────────────────────────────────────────────────────────
## Section 7.5: Format Signature (HARD STRUCTURAL CONSTRAINTS)
────────────────────────────────────────────────────────────────
{format_signature_section}

────────────────────────────────────────────────────────────────
## Section 8: Metaphor & Visual Rule
────────────────────────────────────────────────────────────────
Include exactly {metaphor_count} metaphors or analogies.

Each metaphor must follow this visual metaphor rule:
「{visual_metaphor_mapping_rule}」

Reference examples from the source video:
{visual_metaphor_mapping_examples}

Apply the same logic to all abstract concepts in this new topic.
Never use textbook diagrams or literal anatomy as visual metaphors.

────────────────────────────────────────────────────────────────
## Section 9: Call to Action
────────────────────────────────────────────────────────────────
CTA structural template:
{cta_pattern}
（Do NOT use the original CTA text verbatim — follow the pattern structure with new topic content）

────────────────────────────────────────────────────────────────
## Section 10: Fact Integration
────────────────────────────────────────────────────────────────
Verified facts to use (use at least 3 with source markers):
{verified_facts_list}

────────────────────────────────────────────────────────────────
## Section 11: Visual Compatibility
────────────────────────────────────────────────────────────────
Base medium: {base_medium}
Every sentence must describe something that can be rendered as a {base_medium} scene.

────────────────────────────────────────────────────────────────
## Section 12: Narrative Map (follow this structure)
────────────────────────────────────────────────────────────────
{narrative_map}

════════════════════════════════════════════════════════════════
## SELF-CHECK (perform before output)
════════════════════════════════════════════════════════════════
Before outputting, verify every item:
□ Total word count is within [{target_word_count_min}, {target_word_count_max}]
□ Sentence count is exactly {target_sentence_count} (±2 allowed)
□ Every sentence can be filmed independently as a 3D scene
□ At least 3 verified facts are used with source markers
□ Metaphor count matches target ±1
□ Hook follows the specified strategy and uses second-person address
□ Emotional arc progresses as specified
□ No fabricated statistics or claims without source markers
□ CTA follows the structural template, not copied verbatim
□ No phrase >6 characters matches the reference transcript — every sentence is 100% original
□ All facts and statistics are about the NEW topic, none carried over from the reference
□ Output is valid JSON starting with { and ending with }

## OUTPUT FORMAT (JSON only, no markdown):
{
  "script": "Complete script with \\n between sentences",
  "sentence_list": [
    {
      "index": 1,
      "text": "sentence text",
      "length": word_count,
      "stage": "narrative stage name",
      "has_metaphor": true_or_false,
      "visual_note": "one-line 3D scene description matching visual_metaphor_mapping rule",
      "factReferences": ["fact-1"]
    }
  ],
  "total_length": actual_total_words,
  "hook_text": "opening hook (first 3 sentences)",
  "cta_text": "closing CTA text",
  "stage_breakdown": { "stage_name": "sentence index range" },
  "metaphors_identified": [
    "metaphor 1: abstract concept → visual representation"
  ],
  "constraint_compliance": {
    "avg_sentence_length": actual_avg,
    "max_sentence_length": actual_max,
    "max_sentence_stage": "stage of longest sentence",
    "metaphor_count": actual_count,
    "interaction_cues_count": actual_count,
    "total_length": actual_total,
    "within_target_range": true_or_false
  },
  "self_check": {
    "word_count_in_range": true/false,
    "all_sentences_filmable": true/false,
    "fact_count": number,
    "metaphor_count": number,
    "issues": ["any issues found during self-check"]
  }
}`;

/* ---- Stage 3B-v2: Two-Step Script Generation ---- */

export const SKELETON_SYSTEM_PROMPT = `You are a script architect for science explainer videos.

Your ONLY job is to produce a structural blueprint (skeleton) — NO creative writing.
Each row in the skeleton defines one sentence slot: its narrative stage, its purpose, its approximate word count, and whether it carries a fact or metaphor.

RULES:
1. Output strictly valid JSON only (first char must be {, last must be })
2. Write stage names and purpose tags in {video_language}
3. Distribute sentences across stages according to the narrative arc below
4. Total target words must equal {target_word_count} (±10%)
5. Each sentence slot gets a target length — vary them for rhythm (short 8-15, medium 15-25, long 25-{sentence_length_max})
6. Mark exactly which slots carry facts (at least {min_facts}) and metaphors ({metaphor_count})
7. The first 3 slots form the hook — slot 1 MUST be purpose "data_anchor"
8. The last 2-3 slots form the CTA / closing`;

export const SKELETON_USER_PROMPT = `# SKELETON GENERATION

## Topic
{topic}

## Length Targets
- Total words: {target_word_count} (range: {target_word_count_min}–{target_word_count_max})
- Target sentence count: {target_sentence_count}

## Narrative Arc (follow this stage sequence)
{narrative_arc_expanded}

## Hook Strategy
{hook_strategy}

## Retention Architecture
- Sentences 1-3: Hook (data anchor + curiosity gap)
- Every 4-5 sentences: a curiosity-gap sentence (purpose = "curiosity_gap")
- Sentence ~8: pattern interrupt (purpose = "pattern_interrupt")
- Sentence ~15: second hook (purpose = "second_hook")
- Final 2-3: CTA + open loop

## Constraints
- Metaphor slots: {metaphor_count}
- Minimum fact slots: {min_facts}
{confidence_notes}

## OUTPUT FORMAT (JSON only):
{
  "sentences": [
    {
      "index": 1,
      "stage": "narrative stage name",
      "targetLength": estimated_word_count,
      "purposeTag": "data_anchor | exposition | curiosity_gap | pattern_interrupt | second_hook | climax | cta | metaphor_vehicle | transition",
      "hasFact": true_or_false,
      "hasMetaphor": true_or_false
    }
  ],
  "totalTargetWords": sum_of_all_targetLength,
  "hookIndices": [1, 2, 3],
  "ctaIndices": [last_few_indices],
  "stageBreakdown": { "stage_name": [sentence_indices] }
}`;

export const WRITING_SYSTEM_PROMPT = `You are a science explainer video scriptwriter. You write emotionally resonant, high-retention short-form content for 3D animated videos.

You will receive a structural skeleton — a blueprint that tells you exactly how many sentences to write, how long each should be, and what purpose each serves. Your job is ONLY creative writing: fill in the skeleton with vivid, original text.

ABSOLUTE RULES:
1. Write entirely in {video_language}
2. Output strictly valid JSON only (first char must be {, last must be })
3. Follow the skeleton exactly — same number of sentences, same order, same stage assignments
4. Every numeric claim MUST have a source marker (研究显示/据统计/科学家发现)
5. ZERO PLAGIARISM: Write 100% original content about the topic — no copied phrases
6. Each sentence must be independently filmable as a 3D scene
7. Content must be scientifically accurate — never fabricate data
8. Maintain consistent tone throughout`;

export const WRITING_USER_PROMPT = `# WRITING — Fill the Skeleton

## Topic
{topic}

## Target Audience
{target_audience}

## Skeleton (follow this structure exactly)
{skeleton_json}

## Emotional Tone Arc
{emotional_tone_arc}

## Facts to Integrate (use source markers)
{verified_facts_list}

## Visual Medium
Base medium: {base_medium}
Every sentence must describe something that can be rendered as a {base_medium} scene.

## Reference Style (rhythm ONLY — do NOT copy content)
{reference_transcript_excerpt}

{style_guidance}

{format_signature_section}

## OUTPUT FORMAT (JSON only):
{
  "script": "Complete script with \\n between sentences",
  "sentence_list": [
    {
      "index": 1,
      "text": "sentence text",
      "length": actual_word_count,
      "stage": "narrative stage name",
      "has_metaphor": true_or_false,
      "visual_note": "one-line 3D scene description",
      "factReferences": ["fact-1"]
    }
  ],
  "total_length": actual_total_words,
  "hook_text": "opening hook (first 3 sentences)",
  "cta_text": "closing CTA text",
  "metaphors_identified": ["metaphor 1: concept → visual"]
}`;

/* ---- Stage 4: Storyboard ---- */

export const STORYBOARD_PROMPT = `You are a visual director for 3D animated science explainer videos.

The compiler has already fixed the scene structure. Your job is to fill visual content for each pre-built scene, not to redesign the structure.

## CRITICAL: STRUCTURE LOCK
- The scene count is already fixed at {target_scene_count}.
- You MUST return exactly {target_scene_count} scene entries in the same order.
- DO NOT alter scene count or order.
- DO NOT merge scenes.
- DO NOT split scenes.
- DO NOT reinterpret scene boundaries.

## PRE-BUILT SCENE STRUCTURE
Use this exact structure and fill content 1:1:
{scene_structure_json}

## CRITICAL: CROSS-TOPIC ADAPTATION
The STYLE DNA below is from a reference video about a potentially DIFFERENT subject.
You MUST ADAPT the visual style to fit the NEW topic "{topic}".
- KEEP: artistic medium ({base_medium}), lighting ({lighting_style}), color palette, mood, camera motion
- REPLACE: subject-specific visual elements with ones appropriate for the new topic
- Do NOT include irrelevant objects from the reference video

## SCRIPT
{script_text}

## STYLE DNA — VISUAL TRACK
- Base medium: {base_medium}
- Lighting: {lighting_style}
- Camera motion: {camera_motion}
- Color temperature: {color_temperature}
- Global color palette: {color_palette}
- Mood-specific palettes: {color_palette_by_mood}
- Composition: {composition_style}
- Transition style: {transition_style}
- Average scene duration: {scene_avg_duration_sec}s

## VISUAL METAPHOR MAPPINGS
Use these visual metaphors for abstract concepts.

Visual metaphor rule:
「{visual_metaphor_mapping_rule}」

Reference examples:
{visual_metaphor_mapping_examples}

Apply the same logic to all abstract concepts in the new topic.

## SERIES VISUAL MOTIFS
{series_visual_motifs_section}

## STORYBOARD REPLICATION (OPTIONAL)
{storyboard_replication_section}

## REQUIREMENTS FOR EACH SCENE
0. **Preserve structure**: Keep the given scene number and narrative meaning. You are enriching content only.
1. **Visual prompt**: Detailed, self-contained description for AI image generation. Include: subject, action, lighting, camera angle, color palette keywords, style keywords. Must be independently renderable (no reference to "previous scene"). Write the visual prompt in ENGLISH for best AI generation quality.
2. **Production specs**: Camera setup, lighting setup, sound design
3. **Subject description**: Main visual subject in the scene (for subject isolation checking downstream)
4. **Emotional beat**: The intended emotional impact of this scene
5. **Color mood**: Select the appropriate mood palette for this scene from the mood-specific palettes above

## VISUAL PROMPT QUALITY RULES
- Select the appropriate mood palette for each scene: emotional scenes use warm colors, scientific scenes use cool colors, metaphorical scenes use cosmic colors
- Every prompt must specify the lighting style: {lighting_style}
- Never use vague descriptions like "interesting scene" or "cool visual"
- Each prompt must be 30-80 words of specific visual description in ENGLISH
- Abstract concepts MUST use visual metaphor mappings above
- Maintain visual consistency: all scenes should share the same base medium ({base_medium}), similar lighting, and related color families

Output JSON (no markdown code blocks):
{
  "scenes": [
    {
      "number": 1,
      "narrative": "original script sentence",
      "visualPrompt": "detailed visual description in ENGLISH for AI generation — include subject, action, lighting, camera angle, style",
      "productionSpecs": {
        "camera": "e.g. close-up, 50mm lens, slight dolly in",
        "lighting": "e.g. soft key light, warm 3200K, rim backlight",
        "sound": "e.g. ambient drone, rising tension"
      },
      "subjectDescription": "main visual subject for isolation check",
      "emotionalBeat": "curiosity/tension/wonder/resolution/urgency",
      "colorMood": "emotional/scientific/metaphorical"
    }
  ]
}`;

/* ---- Stage 5a: Reference Sheet (Visual Anchor) ---- */

export const REFERENCE_SHEET_PROMPT = `Create a "Style Reference Sheet" for an educational science video about: {topic}.

Style DNA (Strict Adherence):
- Art Style: {visual_style}
- Color Palette: {color_palette}
- Key Visual Elements: {key_elements}
- Lighting: {lighting_style}
- Pedagogical Approach: {pedagogical_approach}

Instructions:
- Show 3-4 representative visual vignettes in this exact style on a single sheet.
- If the topic has a main character or mascot, show them in 2-3 poses.
- Include sample backgrounds, props, and UI elements that match the style.
- Background: Neutral studio backdrop compatible with the art style.
- Quality: highly detailed, production-ready asset, consistent palette throughout.
- Aspect ratio: {aspect_ratio}

Generate the image directly. Do not describe it in text.`;

/* ---- Stage 5b: Image Generation ---- */

export const IMAGE_GEN_PROMPT = `Generate a high-quality image for a science explainer video scene.

Scene description: {visual_prompt}

Style requirements:
- Color palette: {color_palette}
- Lighting: {lighting_style}
- Visual style: {visual_style}
- Aspect ratio: {aspect_ratio}

Generate the image directly. Do not describe it in text. The image should be polished and production-ready for a professional science video.`;

/* ---- Stage 5b: Video Generation Prompt ---- */

export const VIDEO_GEN_PROMPT = `{visual_prompt}

Style: {visual_style}, {lighting_style}, color palette {color_palette}.
Aspect ratio: {aspect_ratio}. Duration: ~{duration}s.
{style_anchor}`;

/* ---- Utility: Safety pre-check ---- */

export const SAFETY_PRE_CHECK_PROMPT = `Briefly assess whether the following topic is safe for a science explainer video. Flag if it involves:
- Medical diagnosis or treatment advice
- Self-harm or suicide content
- Political propaganda
- Hate speech

Topic: {topic}

Respond with JSON:
{ "safe": true/false, "reason": "brief explanation if unsafe" }`;

/* ---- Stage 7: QA Review ---- */

export const QA_REVIEW_PROMPT = `You are a quality reviewer for science explainer video scripts. Perform a 3-audit review.

## VIDEO INFO
Topic: {topic}
Target word count: {target_word_count}
Target style: {visual_style}, {tone}
Target narrative arc: {narrative_arc}

## SCRIPT TO REVIEW
{script_text}

## AUDIT 1: ACCURACY & FACTUAL INTEGRITY (Score 1-10)
Check for:
- Fabricated statistics or data without source markers
- Misleading implications or oversimplifications that distort truth
- Medical/health claims that could be dangerous
- Numeric claims that seem unreasonable (flag as suspiciousNumericClaims)
- Missing source markers on factual claims

Scoring anchors:
- 9-10: All facts are sourced (研究显示/据统计/etc.), no fabrication, numeric claims are reasonable and verifiable.
- 6-7: 2+ unsourced claims, 1 suspicious statistic, minor oversimplification.
- 1-3: Multiple fabricated facts, dangerous medical claims, no source attribution.

## AUDIT 2: STYLE CONSISTENCY (Score 1-10)
Check against the Style DNA constraints:
- Does the tone match throughout? (target: {tone})
- Is sentence length within target range?
- Does the hook follow the specified strategy?
- Does the emotional arc progress as expected?
- Is the metaphor count appropriate?
- Are interaction cues present?
- Is jargon handled consistently?

Scoring anchors:
- 9-10: Tone fully consistent throughout, rhythm matches reference, hook immediately engaging, emotional arc clear.
- 6-7: 2+ register shifts, hook weak or generic, pacing uneven in 1-2 sections.
- 1-3: Tone inconsistent across script, no clear narrative arc, generic hook.

## AUDIT 3: PRODUCTION-READINESS (Score 1-10)
Check for:
- Can every sentence be independently rendered as a 3D scene?
- Any sentences that are too abstract for visual rendering?
- Is the pacing appropriate (not too dense or too sparse)?
- Does the CTA feel natural?
- Is the total word count within the target range?

Scoring anchors:
- 9-10: Every sentence is concretely filmable, pacing natural, word count within ±5% of target.
- 6-7: 3+ abstract sentences that are hard to visualize, word count off by 15%+, pacing uneven.
- 1-3: Majority of sentences are abstract/unfilmable, word count severely off, no visual variety.

## AUDIT 4: CONTENT CONTAMINATION (Score 1-10)
Reference transcript excerpt (from a DIFFERENT topic video):
---
{reference_transcript_sample}
---

Compare the generated script against the reference transcript above.
Check for:
- Copied sentences or phrases (>8 characters matched verbatim)
- Same specific facts, statistics, or data points reused (the new topic script should have ENTIRELY NEW facts)
- Same visual metaphors or analogies reused word-for-word
- Subject-specific terminology from the original topic bleeding into the new script
A perfect score (10) means the script is COMPLETELY NEW content that only shares STYLE, not facts or phrases.

## AUDIT 5: SERIES CONSISTENCY (Score 1-10)
{series_consistency_section}

## OUTPUT FORMAT (JSON only, no markdown):
{
  "approved": true/false (true if overall_score >= 8),
  "feedback": "brief summary of quality assessment",
  "scores": {
    "accuracy": 1-10,
    "styleConsistency": 1-10,
    "productionReadiness": 1-10,
    "engagement": 1-10,
    "overall": 1-10
  },
  "issues": ["specific actionable issues to fix"],
  "suspiciousNumericClaims": [
    { "claim": "the claim text", "reason": "why it seems suspicious" }
  ],
  "styleDeviations": ["specific deviations from Style DNA"],
  "unfilmableSentences": [
    { "index": number, "text": "sentence", "reason": "why it cannot be rendered" }
  ],
  "contentContamination": {
    "score": 1-10,
    "copiedPhrases": ["any phrases >8 chars matching the reference transcript"],
    "reusedFacts": ["any facts/statistics reused from the reference"],
    "reusedMetaphors": ["any visual metaphors copied verbatim"]
  },
  "seriesConsistency": {
    "score": 1-10,
    "hookStructureMatch": true/false,
    "closingStructureMatch": true/false,
    "rhythmSimilarity": "high/medium/low",
    "arcAllocationMatch": true/false,
    "deviations": ["specific structural deviations from the format signature"]
  }
}`;

/* ---- Format Signature Extraction ---- */

export const FORMAT_SIGNATURE_PROMPT = `You are a structural analyst for video scripts. Your task is to extract the STRUCTURAL SIGNATURE of a reference script — the immutable "series format DNA" that stays constant across different topics.

## INPUT
Full reference transcript:
---
{fullTranscript}
---

Narrative arc stages: {narrative_arc}
Hook strategy: {hook_strategy}
CTA pattern: {cta_pattern}
Video language: {video_language}

## WHAT TO EXTRACT

You must separate "series identity" (structural patterns that repeat across episodes) from "topic content" (facts, examples, metaphors specific to this topic).

### 1. Hook Template
Analyze the first 2-3 sentences. Extract the STRUCTURAL pattern, NOT the content.
Example: "[反直觉数据] + [第二人称挑战] + [悬念前瞻]" or "[shocking statistic] + [second-person challenge] + [suspense tease]"

### 2. Closing Template
Analyze the last 2-3 sentences. Extract the STRUCTURAL pattern.
Example: "[情感升华] + [行动号召] + [开放性问题]" or "[emotional escalation] + [call to action] + [open question]"

### 3. Sentence Length Sequence
Count the character/word length of EACH sentence in order. This is the "rhythm fingerprint".

### 4. Transition Positions
Identify sentence indices (0-based) where the narrative makes a MAJOR shift (topic change, emotional pivot, new section).

### 5. Transition Patterns
Extract the actual transition phrases used (e.g. "但这还不是最可怕的", "然而真正的问题是", "But here's what's really interesting"). Strip topic-specific content, keep structural skeleton.

### 6. Arc Sentence Allocation
Count how many sentences belong to each narrative arc stage. Output as an array matching the stage order.

### 7. Signature Phrases
Extract recurring sentence STRUCTURES (not content) that define this series' voice. Replace topic-specific nouns with [X].
Example: "每当你[X]的时候，你的身体其实在[X]" → structural template

### 8. Emotional Arc Shape
Assign each sentence an emotional intensity score (0.0 = calm/informative, 1.0 = peak emotional impact). This creates the series' emotional "waveform".

### 9. Series Visual Motifs
For each major narrative phase (hook, mechanism, climax, reflection), describe the CATEGORY of visual treatment, not the specific subject.
Example: hookMotif = "scale shift: microscopic subject shown at cosmic scale"

## OUTPUT FORMAT (JSON only, no markdown):
{
  "hookTemplate": "structural pattern string",
  "closingTemplate": "structural pattern string",
  "sentenceLengthSequence": [number, number, ...],
  "transitionPositions": [index1, index2, ...],
  "transitionPatterns": ["pattern1", "pattern2", ...],
  "arcSentenceAllocation": [count_per_stage, ...],
  "arcStageLabels": ["stage1", "stage2", ...],
  "signaturePhrases": ["[X] structural template 1", ...],
  "emotionalArcShape": [0.0-1.0 per sentence, ...],
  "seriesVisualMotifs": {
    "hookMotif": "visual treatment category for hook",
    "mechanismMotif": "visual treatment category for mechanism/explanation",
    "climaxMotif": "visual treatment category for climax",
    "reflectionMotif": "visual treatment category for reflection/CTA"
  }
}`;
