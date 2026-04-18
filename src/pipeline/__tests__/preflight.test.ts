import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PipelineOrchestrator } from '../orchestrator.js';
import type { AIAdapter } from '../types.js';

/* ---- Minimal mock adapter ---- */
const mockAdapter: AIAdapter = {
  provider: 'mock',
  generateText: async () => ({ text: '' }),
  generateImage: async () => ({ text: '' }),
  generateVideo: async () => ({ text: '' }),
};

describe('Orchestrator preflight checks', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'preflight-test-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  /* ---- B4: No text-capable provider ---- */
  it('B4: run() sets project.error when no text-capable provider exists', async () => {
    const orch = new PipelineOrchestrator(mockAdapter, {
      dataDir,
      // No accounts → registry is empty → no text providers
    });
    const project = orch.createProject('No provider test');

    const result = await orch.run(project.id);
    expect(result.error).toMatch(/no text-capable provider/i);
  });

  /* ---- B5: No videoGeneration provider → hard error ---- */
  it('B5: run() fails with error when no video provider configured', async () => {
    const orch = new PipelineOrchestrator(mockAdapter, {
      dataDir,
    });

    // Seed a text-only provider so B4 check passes
    orch.providerRegistry.register('test-provider', {
      text: true,
      imageGeneration: false,
      videoGeneration: false,
    });

    const project = orch.createProject('Video error test');

    const result = await orch.run(project.id);
    expect(result.error).toMatch(/视频生成服务商|video/i);
  });
});
