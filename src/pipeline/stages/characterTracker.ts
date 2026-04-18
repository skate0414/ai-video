/* ------------------------------------------------------------------ */
/*  Character Tracker – cross-scene subject consistency               */
/*  Registers characters from storyboard, injects identity anchors   */
/*  into downstream prompts, and scores inter-scene consistency.     */
/* ------------------------------------------------------------------ */

import { createLogger } from '../../lib/logger.js';
import type { Scene } from '../types.js';

const log = createLogger('CharacterTracker');

/** A registered character identity. */
export interface CharacterIdentity {
  /** Short identifier, e.g. "主角" or "doctor" */
  id: string;
  /** Detailed visual description extracted from the first appearance. */
  appearance: string;
  /** Scene numbers where this character appears (for auditing). */
  appearances: number[];
  /** Optional reference image URL (first scene's reference image). */
  referenceImageUrl?: string;
}

/**
 * CharacterTracker maintains a registry of characters across scenes.
 *
 * Workflow:
 * 1. After storyboard generation, call `extractCharacters()` to parse scenes
 *    and build the character registry.
 * 2. Before image/video generation, call `injectCharacterAnchors()` to prepend
 *    identity descriptions to each scene's visual prompt.
 * 3. After generation, call `scoreConsistency()` to audit how well characters
 *    were maintained across scenes.
 */
export class CharacterTracker {
  private characters = new Map<string, CharacterIdentity>();

  /** Extract and register characters from scenes' visual prompts. */
  extractCharacters(scenes: Scene[]): CharacterIdentity[] {
    this.characters.clear();

    for (const scene of scenes) {
      const prompt = scene.visualPrompt ?? '';
      const subjects = extractSubjectsFromPrompt(prompt);

      for (const subject of subjects) {
        const id = normalizeCharacterId(subject.name);
        const existing = this.characters.get(id);
        if (existing) {
          existing.appearances.push(scene.number);
        } else {
          this.characters.set(id, {
            id,
            appearance: subject.description,
            appearances: [scene.number],
            referenceImageUrl: scene.referenceImageUrl,
          });
        }
      }
    }

    const chars = [...this.characters.values()];
    log.info('characters_extracted', {
      count: chars.length,
      ids: chars.map(c => c.id),
    });
    return chars;
  }

  /** Register a character manually (e.g. from user input). */
  register(id: string, appearance: string, referenceImageUrl?: string): void {
    const normalized = normalizeCharacterId(id);
    this.characters.set(normalized, {
      id: normalized,
      appearance,
      appearances: [],
      referenceImageUrl,
    });
  }

  /** Get all registered characters. */
  getAll(): CharacterIdentity[] {
    return [...this.characters.values()];
  }

  /** Get a specific character. */
  get(id: string): CharacterIdentity | undefined {
    return this.characters.get(normalizeCharacterId(id));
  }

  /**
   * Build a character identity anchor string to prepend to visual prompts.
   * Contains appearance details for all characters appearing in a scene.
   */
  buildAnchorForScene(scene: Scene): string {
    if (this.characters.size === 0) return '';

    const prompt = scene.visualPrompt ?? '';
    const mentionedChars: CharacterIdentity[] = [];

    for (const char of this.characters.values()) {
      // Check if the character is mentioned in this scene's prompt
      if (prompt.toLowerCase().includes(char.id.toLowerCase()) ||
          char.appearances.includes(scene.number)) {
        mentionedChars.push(char);
      }
    }

    if (mentionedChars.length === 0) return '';

    const anchors = mentionedChars.map(c =>
      `[角色一致性: "${c.id}" — ${c.appearance}]`,
    );
    return anchors.join('\n');
  }

  /**
   * Inject character identity anchors into all scenes' visual prompts.
   * Modifies scenes in place. Returns the number of prompts augmented.
   */
  injectCharacterAnchors(scenes: Scene[]): number {
    let augmented = 0;
    for (const scene of scenes) {
      const anchor = this.buildAnchorForScene(scene);
      if (anchor) {
        // Strip any prior character anchor to avoid duplication
        const stripped = (scene.visualPrompt ?? '').replace(/^\[角色一致性:.*?\]\n*/gm, '');
        scene.visualPrompt = `${anchor}\n${stripped}`;
        augmented++;
      }
    }
    log.info('anchors_injected', { augmented, total: scenes.length });
    return augmented;
  }

  /**
   * Score character consistency across scenes.
   * Returns 0-100 (100 = all characters have appearance descriptions injected).
   */
  scoreConsistency(scenes: Scene[]): CharacterConsistencyReport {
    const multiSceneChars = [...this.characters.values()].filter(c => c.appearances.length > 1);
    if (multiSceneChars.length === 0) {
      return { score: 100, characters: [], multiSceneCharacterCount: 0 };
    }

    const charReports: CharacterReport[] = multiSceneChars.map(char => {
      const scenesWithAnchor = scenes.filter(s =>
        char.appearances.includes(s.number) &&
        (s.visualPrompt ?? '').includes(`角色一致性: "${char.id}"`),
      );
      const coverage = scenesWithAnchor.length / char.appearances.length;
      return {
        id: char.id,
        totalAppearances: char.appearances.length,
        anchoredScenes: scenesWithAnchor.length,
        coverage: Math.round(coverage * 100),
      };
    });

    const avgCoverage = charReports.reduce((sum, r) => sum + r.coverage, 0) / charReports.length;

    return {
      score: Math.round(avgCoverage),
      characters: charReports,
      multiSceneCharacterCount: multiSceneChars.length,
    };
  }
}

export interface CharacterConsistencyReport {
  /** Overall consistency score 0-100. */
  score: number;
  /** Per-character breakdown. */
  characters: CharacterReport[];
  /** How many characters appear in multiple scenes. */
  multiSceneCharacterCount: number;
}

export interface CharacterReport {
  id: string;
  totalAppearances: number;
  anchoredScenes: number;
  /** Percentage of appearances that have identity anchors (0-100). */
  coverage: number;
}

/* ---- Internal helpers ---- */

interface ExtractedSubject {
  name: string;
  description: string;
}

/**
 * Extract subject entities from a visual prompt.
 * Looks for common patterns: "a [adjective] [person/character]", "角色:", etc.
 */
function extractSubjectsFromPrompt(prompt: string): ExtractedSubject[] {
  const subjects: ExtractedSubject[] = [];

  // Pattern 1: Chinese character label — "角色：小明，穿着白色T恤..."
  const zhPattern = /(?:角色|人物|主角|主人公)[：:]\s*([^，,。.]+)[，,。.]?\s*([^。.！!？?\n]{0,100})/g;
  let match;
  while ((match = zhPattern.exec(prompt)) !== null) {
    subjects.push({
      name: match[1].trim(),
      description: `${match[1].trim()} ${match[2]?.trim() ?? ''}`.trim(),
    });
  }

  // Pattern 2: English "A [subject] with/wearing/who ..." patterns
  const enPattern = /\b[Aa]\s+((?:young|old|tall|short|male|female|)\s*(?:man|woman|boy|girl|person|character|figure|doctor|teacher|student|protagonist|hero|heroine))\b[^.]{0,80}/g;
  while ((match = enPattern.exec(prompt)) !== null) {
    const name = match[1].trim().split(/\s+/).pop() ?? match[1].trim();
    subjects.push({
      name,
      description: match[0].trim(),
    });
  }

  // Pattern 3: Explicit subject markers — "[Subject: ...]"
  const markerPattern = /\[(?:Subject|Character|角色)\s*:\s*([^\]]+)\]/gi;
  while ((match = markerPattern.exec(prompt)) !== null) {
    const parts = match[1].split(/[,，]/);
    const name = parts[0].trim();
    subjects.push({
      name,
      description: match[1].trim(),
    });
  }

  // Deduplicate by normalized ID
  const seen = new Set<string>();
  return subjects.filter(s => {
    const id = normalizeCharacterId(s.name);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeCharacterId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}
