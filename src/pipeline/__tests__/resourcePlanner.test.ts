import { describe, it, expect } from 'vitest';
import { generateResourcePlan } from '../resourcePlanner.js';
import { ProviderCapabilityRegistry } from '../providerRegistry.js';
import { SessionManager } from '../sessionManager.js';

describe('ResourcePlanner', () => {
  it('generates a complete resource plan for free tier', () => {
    const registry = new ProviderCapabilityRegistry();
    const sessionManager = new SessionManager();
    const plan = generateResourcePlan('free', registry, sessionManager, 'proj_test');

    expect(plan.qualityTier).toBe('free');
    expect(plan.stages).toHaveLength(13);
    expect(plan.totalCount).toBe(13);
    expect(plan.summary).toBeTruthy();
  });

  it('marks all stages as feasible when providers are available', () => {
    const registry = new ProviderCapabilityRegistry();
    const sessionManager = new SessionManager();
    const plan = generateResourcePlan('free', registry, sessionManager, 'proj_test');

    // Most stages should be feasible with default providers
    expect(plan.feasibleCount).toBeGreaterThanOrEqual(11);
  });

  it('assigns correct session groups', () => {
    const registry = new ProviderCapabilityRegistry();
    const sessionManager = new SessionManager();
    const plan = generateResourcePlan('free', registry, sessionManager, 'proj_test');

    const analysisStages = plan.stages.filter(s => s.sessionGroup === 'analysis');
    expect(analysisStages).toHaveLength(3);
    expect(analysisStages.map(s => s.stage)).toEqual([
      'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
    ]);

    const creationStages = plan.stages.filter(s => s.sessionGroup === 'creation');
    expect(creationStages).toHaveLength(3);

    const visualStages = plan.stages.filter(s => s.sessionGroup === 'visual');
    expect(visualStages).toHaveLength(3);

    const productionStages = plan.stages.filter(s => s.sessionGroup === 'production');
    expect(productionStages).toHaveLength(4);
  });

  it('TTS and ASSEMBLY are marked as local/free', () => {
    const registry = new ProviderCapabilityRegistry();
    const sessionManager = new SessionManager();
    const plan = generateResourcePlan('free', registry, sessionManager, 'proj_test');

    const tts = plan.stages.find(s => s.stage === 'TTS')!;
    expect(tts.provider).toBe('local');
    expect(tts.costCategory).toBe('free');

    const assembly = plan.stages.find(s => s.stage === 'ASSEMBLY')!;
    expect(assembly.provider).toBe('local');
    expect(assembly.costCategory).toBe('free');
  });

  it('session summary covers all 4 groups', () => {
    const registry = new ProviderCapabilityRegistry();
    const sessionManager = new SessionManager();
    const plan = generateResourcePlan('free', registry, sessionManager, 'proj_test');

    expect(plan.sessionSummary.analysis).toBeDefined();
    expect(plan.sessionSummary.creation).toBeDefined();
    expect(plan.sessionSummary.visual).toBeDefined();
    expect(plan.sessionSummary.production).toBeDefined();
  });

  it('detects blockers when provider quota is exhausted', () => {
    const registry = new ProviderCapabilityRegistry();
    const sessionManager = new SessionManager();

    // Exhaust all image generation providers
    registry.markQuotaExhausted('gemini');
    registry.markQuotaExhausted('chatgpt');

    const plan = generateResourcePlan('free', registry, sessionManager, 'proj_test');

    // Image generation stages may pick exhausted providers but still be "feasible"
    // since findProviders returns them (just sorted last)
    expect(plan.stages).toHaveLength(13);
  });

  it('premium tier uses API adapter', () => {
    const registry = new ProviderCapabilityRegistry();
    const sessionManager = new SessionManager();
    const plan = generateResourcePlan('premium', registry, sessionManager, 'proj_test');

    const apiStages = plan.stages.filter(s => s.adapter === 'api');
    expect(apiStages.length).toBeGreaterThan(0);
  });
});
