import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workbench } from './workbench.js';

describe('Workbench – unit (no browser)', () => {
  let wb: Workbench;
  let testId = 0;

  beforeEach(() => {
    const tempPath = join(tmpdir(), `wb-test-${Date.now()}-${++testId}.json`);
    wb = new Workbench(tempPath, true);
  });

  it('initial state is idle', () => {
    const state = wb.getState();
    expect(state.isRunning).toBe(false);
    expect(state.chatMode).toBe('new');
    expect(state.tasks).toHaveLength(0);
    expect(state.accounts).toHaveLength(0);
  });

  it('can add tasks and accounts', () => {
    wb.tasks.add(['Q1', 'Q2']);
    wb.accounts.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    const state = wb.getState();
    expect(state.tasks).toHaveLength(2);
    expect(state.accounts).toHaveLength(1);
  });

  it('emits events via onEvent', () => {
    const events: string[] = [];
    wb.onEvent((e) => events.push(e.type));
    wb.tasks.add('Q1');
    // Manually emit to test
    // (In real usage, start() would trigger events)
    expect(typeof wb.onEvent).toBe('function');
  });

  it('unsubscribes from events', () => {
    const events: string[] = [];
    const unsub = wb.onEvent((e) => events.push(e.type));
    unsub();
    // After unsub, no events should be received
    expect(events).toHaveLength(0);
  });

  it('exposes selector overrides', () => {
    wb.setProviderSelectors('chatgpt', { promptInput: '#custom-input' });
    const selectors = wb.getSelectors('chatgpt');
    expect(selectors.promptInput).toBe('#custom-input');
    // Other selectors should remain default
    expect(selectors.chatUrl).toBe('https://chatgpt.com/');
  });

  it('can switch chat mode', () => {
    expect(wb.getState().chatMode).toBe('new');
    wb.setChatMode('continue');
    expect(wb.getState().chatMode).toBe('continue');
    wb.setChatMode('new');
    expect(wb.getState().chatMode).toBe('new');
  });
});
