import { describe, it, expect } from 'vitest';
import { CharacterTracker } from './characterTracker.js';
import type { Scene } from '../types.js';

function makeScene(overrides: Partial<Scene> & { number: number; visualPrompt: string }): Scene {
  return {
    id: `s${overrides.number}`,
    narrative: '',
    productionSpecs: { camera: 'wide', lighting: 'soft', sound: 'ambient', notes: '' },
    estimatedDuration: 5,
    assetType: 'video',
    status: 'done',
    logs: [],
    ...overrides,
  } as Scene;
}

describe('CharacterTracker', () => {
  describe('extractCharacters', () => {
    it('extracts Chinese character labels', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: '角色：小明，穿着白色T恤的年轻男子' }),
        makeScene({ number: 2, visualPrompt: '人物：小红，红色连衣裙的女孩' }),
      ];
      const chars = tracker.extractCharacters(scenes);
      expect(chars).toHaveLength(2);
      expect(chars.map(c => c.id)).toContain('小明');
      expect(chars.map(c => c.id)).toContain('小红');
    });

    it('extracts English person patterns', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: 'A young woman wearing a blue dress stands in a garden' }),
        makeScene({ number: 2, visualPrompt: 'A tall man in a dark suit enters the room' }),
      ];
      const chars = tracker.extractCharacters(scenes);
      expect(chars.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts explicit [Subject:] markers', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: '[Character: Dr. Chen, wearing a white lab coat]' }),
      ];
      const chars = tracker.extractCharacters(scenes);
      expect(chars).toHaveLength(1);
      expect(chars[0].id).toBe('dr._chen');
    });

    it('deduplicates characters across scenes', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: '角色：小明，穿着白色T恤' }),
        makeScene({ number: 2, visualPrompt: '角色：小明，换上了红色外套' }),
      ];
      const chars = tracker.extractCharacters(scenes);
      expect(chars).toHaveLength(1);
      expect(chars[0].appearances).toEqual([1, 2]);
    });

    it('returns empty array for scenes without characters', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: 'A beautiful sunset over the ocean' }),
      ];
      const chars = tracker.extractCharacters(scenes);
      expect(chars).toHaveLength(0);
    });
  });

  describe('register', () => {
    it('adds a manual character', () => {
      const tracker = new CharacterTracker();
      tracker.register('Hero', 'tall man with a scar');
      expect(tracker.getAll()).toHaveLength(1);
      expect(tracker.get('hero')?.appearance).toBe('tall man with a scar');
    });
  });

  describe('injectCharacterAnchors', () => {
    it('prepends identity anchors to visual prompts', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: '角色：小明，穿着白色T恤的男生' }),
        makeScene({ number: 2, visualPrompt: '角色：小明，站在教室里' }),
      ];
      tracker.extractCharacters(scenes);
      const count = tracker.injectCharacterAnchors(scenes);
      expect(count).toBeGreaterThan(0);
      expect(scenes[0].visualPrompt).toContain('[角色一致性:');
      expect(scenes[1].visualPrompt).toContain('[角色一致性:');
    });

    it('does not duplicate anchors on repeated calls', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: '角色：小明，穿着白色T恤' }),
      ];
      tracker.extractCharacters(scenes);
      tracker.injectCharacterAnchors(scenes);
      const firstPrompt = scenes[0].visualPrompt;
      tracker.injectCharacterAnchors(scenes);
      // Should not double-inject
      const anchorCount = (scenes[0].visualPrompt!.match(/\[角色一致性:/g) || []).length;
      expect(anchorCount).toBe(1);
    });

    it('returns 0 when no characters registered', () => {
      const tracker = new CharacterTracker();
      const scenes = [makeScene({ number: 1, visualPrompt: 'A random scene' })];
      expect(tracker.injectCharacterAnchors(scenes)).toBe(0);
    });
  });

  describe('scoreConsistency', () => {
    it('returns 100 when no multi-scene characters exist', () => {
      const tracker = new CharacterTracker();
      const scenes = [makeScene({ number: 1, visualPrompt: '角色：小明，穿着白色T恤' })];
      tracker.extractCharacters(scenes);
      const report = tracker.scoreConsistency(scenes);
      expect(report.score).toBe(100);
      expect(report.multiSceneCharacterCount).toBe(0);
    });

    it('scores coverage for multi-scene characters', () => {
      const tracker = new CharacterTracker();
      const scenes = [
        makeScene({ number: 1, visualPrompt: '角色：小明，穿着白色T恤的男生' }),
        makeScene({ number: 2, visualPrompt: '角色：小明，站在门口' }),
      ];
      tracker.extractCharacters(scenes);
      tracker.injectCharacterAnchors(scenes);
      const report = tracker.scoreConsistency(scenes);
      expect(report.multiSceneCharacterCount).toBe(1);
      expect(report.characters).toHaveLength(1);
      expect(report.score).toBeGreaterThan(0);
    });
  });

  describe('buildAnchorForScene', () => {
    it('builds anchor only for mentioned characters', () => {
      const tracker = new CharacterTracker();
      tracker.register('小明', '穿白T恤的男生');
      tracker.register('小红', '穿红裙的女生');
      const scene = makeScene({ number: 1, visualPrompt: '小明走进图书馆' });
      // manually set appearances
      tracker.get('小明')!.appearances.push(1);
      const anchor = tracker.buildAnchorForScene(scene);
      expect(anchor).toContain('小明');
      expect(anchor).not.toContain('小红');
    });
  });
});
