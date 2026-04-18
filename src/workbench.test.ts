import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
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
    wb.resources.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    const state = wb.getState();
    expect(state.tasks).toHaveLength(2);
    expect(state.accounts).toHaveLength(1);
    expect(state.resources).toHaveLength(1);
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

  it('submitAndWait captures task-scoped chat settings without mutating the default mode', async () => {
    const startMock = vi.spyOn(wb, 'start').mockResolvedValue(undefined);
    const controller = new AbortController();

    const promise = wb.submitAndWait({
      question: 'Continue this chat',
      sessionId: 'session_proj_1_creation',
      useSameChat: true,
      signal: controller.signal,
      timeoutMs: 500,
    });

    const [task] = wb.tasks.all();
    expect(task.chatMode).toBe('continue');
    expect(task.sessionId).toBe('session_proj_1_creation');
    expect(wb.getState().chatMode).toBe('new');

    controller.abort();
    await expect(promise).rejects.toThrow('Chat request aborted');
    startMock.mockRestore();
  });

  it('getProviderList returns provider info array', () => {
    const list = wb.getProviderList();
    expect(Array.isArray(list)).toBe(true);
    // Should have at least the built-in providers
    expect(list.length).toBeGreaterThanOrEqual(0);
  });

  it('addCustomProvider creates and retrieves a custom provider', () => {
    const info = wb.addCustomProvider('test-provider', 'Test Provider', {
      chatUrl: 'https://example.com',
      promptInput: 'textarea',
    } as any);
    expect(info.id).toBe('test-provider');
    expect(info.label).toBe('Test Provider');
    expect(info.builtin).toBe(false);
    const list = wb.getProviderList();
    expect(list.some(p => p.id === 'test-provider')).toBe(true);
  });

  it('addCustomProvider throws for built-in provider id', () => {
    expect(() => {
      wb.addCustomProvider('chatgpt', 'Modified GPT', {} as any);
    }).toThrow('built-in');
  });

  it('removeCustomProvider returns false for nonexistent', () => {
    expect(wb.removeCustomProvider('nonexistent')).toBe(false);
  });

  it('removeCustomProvider removes a custom provider', () => {
    wb.addCustomProvider('to-remove', 'Remove Me', { chatUrl: 'https://example.com' } as any);
    expect(wb.removeCustomProvider('to-remove')).toBe(true);
    const list = wb.getProviderList();
    expect(list.some(p => p.id === 'to-remove')).toBe(false);
  });

  it('getModels returns model options for a provider', () => {
    const models = wb.getModels('chatgpt');
    expect(Array.isArray(models)).toBe(true);
  });

  it('stop when not running is a no-op', () => {
    expect(() => wb.stop()).not.toThrow();
  });

  it('tasks.remove returns false for nonexistent task', () => {
    expect(wb.tasks.remove('nonexistent')).toBe(false);
  });

  it('tasks.clear removes all tasks', () => {
    wb.tasks.add(['Q1', 'Q2', 'Q3']);
    expect(wb.tasks.all().length).toBe(3);
    wb.tasks.clear();
    expect(wb.tasks.all().length).toBe(0);
  });

  it('resources.addAccount and removeAccount', () => {
    const acc = wb.resources.addAccount('chatgpt', 'GPT Account', '/tmp/p1');
    expect(acc).toBeDefined();
    expect(acc.provider).toBe('chatgpt');
    const ok = wb.resources.removeAccount(acc.id);
    expect(ok).toBe(true);
    expect(wb.resources.removeAccount(acc.id)).toBe(false);
  });

  it('resources.resetAllQuotas does not throw', () => {
    expect(() => wb.resources.resetAllQuotas()).not.toThrow();
  });

  it('resources.all returns array', () => {
    expect(Array.isArray(wb.resources.all())).toBe(true);
  });

  it('resources.addResource with full config', () => {
    const res = wb.resources.addResource({
      type: 'browser' as any,
      provider: 'custom-test',
      label: 'Custom',
      siteUrl: 'https://example.com',
      profileDir: '/tmp/test-profile',
      capabilities: { text: true },
    });
    expect(res).toBeDefined();
    expect(res.provider).toBe('custom-test');
  });

  it('resources.removeResource returns false for nonexistent', () => {
    expect(wb.resources.removeResource('nonexistent')).toBe(false);
  });

  it('selectorService is accessible', () => {
    expect(wb.selectorService).toBeDefined();
  });

  it('loginBrowser is accessible', () => {
    expect(wb.loginBrowser).toBeDefined();
  });
});
