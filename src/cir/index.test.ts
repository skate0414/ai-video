import { describe, it, expect } from 'vitest';
import * as cir from './index.js';

describe('cir index barrel', () => {
  it('re-exports parser and loader functions', () => {
    expect(typeof cir.parseStyleAnalysisCIR).toBe('function');
    expect(typeof cir.parseScriptCIR).toBe('function');
    expect(typeof cir.loadStyleCIR).toBe('function');
    expect(typeof cir.loadScriptCIR).toBe('function');
  });

  it('re-exports validators', () => {
    expect(typeof cir.validateStyleAnalysisCIR).toBe('function');
    expect(typeof cir.validateScriptCIR).toBe('function');
    expect(typeof cir.validateStoryboardCIR).toBe('function');
  });
});
