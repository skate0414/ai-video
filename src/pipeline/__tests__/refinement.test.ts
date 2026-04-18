import { describe, it, expect } from 'vitest';
import { runRefinement } from '../stages/refinement.js';
import type { LogEntry } from '../types.js';
import type { PipelineScene } from '../../../shared/types.js';

function makeScene(overrides: Partial<PipelineScene> & { id: string }): PipelineScene {
  return {
    number: 1,
    narrative: 'Test',
    visualPrompt: 'Test prompt',
    estimatedDuration: 5,
    assetType: 'image',
    status: 'done',
    ...overrides,
  };
}

describe('runRefinement', () => {
  it('reports all complete when all scenes have assets', async () => {
    const scenes: PipelineScene[] = [
      makeScene({ id: 's1', assetUrl: '/img.png', audioUrl: '/audio.mp3', assetType: 'image', status: 'done' }),
      makeScene({ id: 's2', assetUrl: '/img2.png', audioUrl: '/audio2.mp3', assetType: 'video', status: 'done', number: 2 }),
    ];

    const logs: LogEntry[] = [];
    const result = await runRefinement({ scenes, maxRetries: 2 }, (e) => logs.push(e));

    expect(result.allComplete).toBe(true);
    expect(result.failedScenes).toEqual([]);
    const successLog = logs.find(l => l.type === 'success');
    expect(successLog).toBeDefined();
  });

  it('identifies scenes missing visual assets', async () => {
    const scenes: PipelineScene[] = [
      makeScene({ id: 's1', assetUrl: '/img.png', audioUrl: '/audio.mp3', assetType: 'image', status: 'done' }),
      makeScene({ id: 's2', assetUrl: undefined, audioUrl: '/audio2.mp3', assetType: 'placeholder', status: 'done', number: 2 }),
    ];

    const result = await runRefinement({ scenes, maxRetries: 2 });

    expect(result.allComplete).toBe(false);
    expect(result.failedScenes).toContain('s2');
  });

  it('identifies scenes missing audio', async () => {
    const scenes: PipelineScene[] = [
      makeScene({ id: 's1', assetUrl: '/img.png', audioUrl: undefined, assetType: 'image', status: 'done' }),
    ];

    const result = await runRefinement({ scenes, maxRetries: 2 });

    expect(result.allComplete).toBe(false);
    expect(result.failedScenes).toContain('s1');
  });

  it('identifies scenes with error status', async () => {
    const scenes: PipelineScene[] = [
      makeScene({ id: 's1', assetUrl: '/img.png', audioUrl: '/audio.mp3', assetType: 'image', status: 'error' }),
    ];

    const result = await runRefinement({ scenes, maxRetries: 2 });

    expect(result.allComplete).toBe(false);
    expect(result.failedScenes).toContain('s1');
  });

  it('returns empty retriedScenes initially', async () => {
    const scenes: PipelineScene[] = [
      makeScene({ id: 's1', assetUrl: undefined, assetType: 'placeholder', status: 'pending' }),
    ];

    const result = await runRefinement({ scenes, maxRetries: 2 });

    expect(result.retriedScenes).toEqual([]);
    expect(result.retryCount).toBe(0);
  });
});
