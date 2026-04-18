import { describe, it, expect } from 'vitest';
import * as trace from './index.js';

describe('trace index barrel', () => {
  it('re-exports trace writer and context helpers', () => {
    expect(typeof trace.TraceWriter).toBe('function');
    expect(typeof trace.createRootContext).toBe('function');
    expect(typeof trace.createChildContext).toBe('function');
    expect(typeof trace.makeTraceEvent).toBe('function');
  });

  it('re-exports analyzer helpers', () => {
    expect(typeof trace.buildTimeline).toBe('function');
    expect(typeof trace.findFailureSpan).toBe('function');
    expect(typeof trace.buildSpanTree).toBe('function');
  });
});
