import { describe, it, expect } from 'vitest';
import * as providers from './index.js';

describe('pipeline providers index barrel', () => {
  it('re-exports plugin registry entry points', () => {
    expect(typeof providers.PluginRegistry).toBe('function');
    expect(typeof providers.registerPlugin).toBe('function');
    expect(typeof providers.getGlobalPluginRegistry).toBe('function');
    expect(typeof providers.resolvePlugin).toBe('function');
  });
});
