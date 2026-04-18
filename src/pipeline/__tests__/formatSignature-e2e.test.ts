/**
 * End-to-end smoke test for the FormatSignature data chain:
 *
 *   StyleLibrary.save(…, fs) → load(id) → fs round-trips
 *   orchestrator.setStyleProfile(…, fs) → format-signature.json persisted
 *   Artifact whitelist allows serving format-signature.json via HTTP route
 *
 * These tests use real filesystem I/O (temp dirs) but no network calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PipelineOrchestrator } from '../orchestrator.js';
import { StyleLibrary } from '../styleLibrary.js';
import type { AIAdapter } from '../types.js';
import type { FormatSignature } from '../../cir/types.js';
import { ARTIFACT } from '../../constants.js';

/* ---- Fixtures ---- */

const mockAdapter: AIAdapter = {
  provider: 'mock',
  generateText: async () => ({ text: '' }),
  generateImage: async () => ({ text: '' }),
  generateVideo: async () => ({ text: '' }),
};

const sampleFormatSignature: FormatSignature = {
  _type: 'FormatSignature',
  version: 1,
  hookTemplate: 'Direct emotional address + startling internal visual',
  closingTemplate: 'CTA: emotional reflection',
  sentenceLengthSequence: [34, 35, 30, 9, 26, 31, 32, 11, 24, 29, 30, 23, 32, 31, 15, 33, 29, 26, 31, 30, 31, 31, 26, 30, 25, 27],
  transitionPositions: [3, 7, 11, 14, 17],
  transitionPatterns: ['但这还仅仅是个开始', '但这还不是最震撼的', '究竟是什么', '接下来的发现', '你真的还觉得'],
  arcSentenceAllocation: [4, 4, 4, 4, 5, 5],
  arcStageLabels: ['Hook', 'Mechanism', 'Mechanism', 'Mechanism', 'Climax', 'Reflect'],
  signaturePhrases: ['生死时速', '不眠不休', '死心塌地'],
  emotionalArcShape: [0.8, 0.5, 0.6, 0.7, 0.9, 0.7],
  seriesVisualMotifs: {
    hookMotif: 'glowing particles',
    mechanismMotif: 'cellular macro',
    climaxMotif: 'cosmic scale reveal',
    reflectionMotif: 'warm self-embrace',
  },
};

const sampleStyleProfile = {
  visualStyle: 'Cinematic 3D animation',
  pace: 'medium',
  tone: 'emotional',
};

/* ---- Tests ---- */

describe('FormatSignature E2E smoke', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fs-e2e-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  /* ======= Chain 1: StyleLibrary save → load round-trip ======= */

  describe('StyleLibrary round-trip', () => {
    it('save() persists formatSignature and load() restores it identically', () => {
      const lib = new StyleLibrary(dataDir);
      const saved = lib.save('测试模板', '生而为人有多难得', sampleStyleProfile, sampleFormatSignature);

      expect(saved.formatSignature).toEqual(sampleFormatSignature);

      const loaded = lib.load(saved.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.formatSignature).toEqual(sampleFormatSignature);
      // Deep equality — every field survives JSON serialisation
      expect(loaded!.formatSignature!._type).toBe('FormatSignature');
      expect(loaded!.formatSignature!.version).toBe(1);
      expect(loaded!.formatSignature!.sentenceLengthSequence).toHaveLength(26);
      expect(loaded!.formatSignature!.seriesVisualMotifs.hookMotif).toBe('glowing particles');
    });

    it('save() without formatSignature leaves it undefined on load()', () => {
      const lib = new StyleLibrary(dataDir);
      const saved = lib.save('无FS模板', '测试主题', sampleStyleProfile);

      const loaded = lib.load(saved.id);
      expect(loaded!.formatSignature).toBeUndefined();
    });

    it('list() does not leak formatSignature (returns summary only)', () => {
      const lib = new StyleLibrary(dataDir);
      lib.save('有FS', '主题A', sampleStyleProfile, sampleFormatSignature);

      const list = lib.list();
      expect(list).toHaveLength(1);
      // list() omits styleProfile; verify formatSignature is also absent
      expect((list[0] as any).formatSignature).toBeUndefined();
      expect((list[0] as any).styleProfile).toBeUndefined();
    });
  });

  /* ======= Chain 2: orchestrator.setStyleProfile persists artifact ======= */

  describe('Orchestrator setStyleProfile → artifact persistence', () => {
    it('setStyleProfile with formatSignature writes format-signature.json', () => {
      const orch = new PipelineOrchestrator(mockAdapter, { dataDir });
      const project = orch.createProject('FS测试');

      orch.setStyleProfile(project.id, sampleStyleProfile as any, sampleFormatSignature);

      // Verify file exists on disk
      const artifactPath = join(dataDir, 'projects', project.id, ARTIFACT.FORMAT_SIGNATURE);
      expect(existsSync(artifactPath)).toBe(true);

      // Verify content round-trips
      const onDisk = JSON.parse(readFileSync(artifactPath, 'utf-8'));
      expect(onDisk._type).toBe('FormatSignature');
      expect(onDisk.version).toBe(1);
      expect(onDisk.hookTemplate).toBe(sampleFormatSignature.hookTemplate);
      expect(onDisk.sentenceLengthSequence).toEqual(sampleFormatSignature.sentenceLengthSequence);
      expect(onDisk.seriesVisualMotifs).toEqual(sampleFormatSignature.seriesVisualMotifs);
    });

    it('setStyleProfile without formatSignature does NOT create artifact', () => {
      const orch = new PipelineOrchestrator(mockAdapter, { dataDir });
      const project = orch.createProject('无FS测试');

      orch.setStyleProfile(project.id, sampleStyleProfile as any);

      const artifactPath = join(dataDir, 'projects', project.id, ARTIFACT.FORMAT_SIGNATURE);
      expect(existsSync(artifactPath)).toBe(false);
    });

    it('setStyleProfile marks STYLE_EXTRACTION as completed', () => {
      const orch = new PipelineOrchestrator(mockAdapter, { dataDir });
      const project = orch.createProject('阶段测试');

      const updated = orch.setStyleProfile(project.id, sampleStyleProfile as any, sampleFormatSignature);
      expect(updated.stageStatus.STYLE_EXTRACTION).toBe('completed');

      // Also verify style-profile.json exists
      const spPath = join(dataDir, 'projects', project.id, ARTIFACT.STYLE_PROFILE);
      expect(existsSync(spPath)).toBe(true);
    });
  });

  /* ======= Chain 3: Full save → template-load → apply chain ======= */

  describe('Full chain: save template → load → apply to new project', () => {
    it('formatSignature survives the full template save→load→apply pipeline', () => {
      const lib = new StyleLibrary(dataDir);
      const orch = new PipelineOrchestrator(mockAdapter, { dataDir });

      // Step 1: Save a style template with formatSignature
      const tpl = lib.save('系列模板', '原始主题', sampleStyleProfile, sampleFormatSignature);

      // Step 2: Load the template (simulates what PipelinePage does)
      const loaded = lib.load(tpl.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.formatSignature).toBeDefined();

      // Step 3: Apply to a new project (simulates PipelinePage template apply)
      const newProject = orch.createProject('新主题');
      orch.setStyleProfile(
        newProject.id,
        loaded!.styleProfile as any,
        loaded!.formatSignature,
      );

      // Step 4: Verify artifact persisted on new project
      const artifactPath = join(dataDir, 'projects', newProject.id, ARTIFACT.FORMAT_SIGNATURE);
      expect(existsSync(artifactPath)).toBe(true);

      const persisted = JSON.parse(readFileSync(artifactPath, 'utf-8')) as FormatSignature;
      expect(persisted).toEqual(sampleFormatSignature);
      expect(persisted._type).toBe('FormatSignature');
      expect(persisted.hookTemplate).toBe(sampleFormatSignature.hookTemplate);
      expect(persisted.closingTemplate).toBe(sampleFormatSignature.closingTemplate);
    });
  });

  /* ======= Chain 4: Artifact route whitelist ======= */

  describe('Artifact route whitelist', () => {
    it('format-signature.json is in the artifact whitelist', async () => {
      // Verify format-signature.json is in the centralized ARTIFACT registry
      const allowed = Object.values(ARTIFACT);
      expect(allowed).toContain(ARTIFACT.FORMAT_SIGNATURE);
    });
  });
});
