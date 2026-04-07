import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../sessionManager.js';

describe('SessionManager', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
  });

  it('creates a new session for a stage', () => {
    const session = sm.getSession('proj_1', 'CAPABILITY_ASSESSMENT');
    expect(session.group).toBe('analysis');
    expect(session.stages).toContain('CAPABILITY_ASSESSMENT');
    expect(session.messageCount).toBe(0);
  });

  it('returns the same session for stages in the same group', () => {
    const s1 = sm.getSession('proj_1', 'CAPABILITY_ASSESSMENT');
    const s2 = sm.getSession('proj_1', 'STYLE_EXTRACTION');
    expect(s1.sessionId).toBe(s2.sessionId);
    expect(s1.group).toBe(s2.group);
  });

  it('returns different sessions for stages in different groups', () => {
    const s1 = sm.getSession('proj_1', 'CAPABILITY_ASSESSMENT');
    const s2 = sm.getSession('proj_1', 'SCRIPT_GENERATION');
    expect(s1.sessionId).not.toBe(s2.sessionId);
    expect(s1.group).toBe('analysis');
    expect(s2.group).toBe('creation');
  });

  it('returns different sessions for different projects', () => {
    const s1 = sm.getSession('proj_1', 'RESEARCH');
    const s2 = sm.getSession('proj_2', 'RESEARCH');
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  it('shouldContinueChat returns false for first message', () => {
    expect(sm.shouldContinueChat('proj_1', 'CAPABILITY_ASSESSMENT')).toBe(false);
  });

  it('shouldContinueChat returns true after recording a message', () => {
    sm.getSession('proj_1', 'CAPABILITY_ASSESSMENT');
    sm.recordMessage('proj_1', 'CAPABILITY_ASSESSMENT');
    expect(sm.shouldContinueChat('proj_1', 'STYLE_EXTRACTION')).toBe(true);
  });

  it('recordMessage increments messageCount', () => {
    const session = sm.getSession('proj_1', 'RESEARCH');
    expect(session.messageCount).toBe(0);
    sm.recordMessage('proj_1', 'RESEARCH');
    expect(session.messageCount).toBe(1);
    sm.recordMessage('proj_1', 'RESEARCH');
    expect(session.messageCount).toBe(2);
  });

  it('clearProject removes all sessions for a project', () => {
    sm.getSession('proj_1', 'CAPABILITY_ASSESSMENT');
    sm.getSession('proj_1', 'SCRIPT_GENERATION');
    sm.recordMessage('proj_1', 'CAPABILITY_ASSESSMENT');

    sm.clearProject('proj_1');

    // New session should be created with 0 messages
    expect(sm.shouldContinueChat('proj_1', 'CAPABILITY_ASSESSMENT')).toBe(false);
  });

  it('clearGroup clears only the specified group', () => {
    sm.getSession('proj_1', 'CAPABILITY_ASSESSMENT');
    sm.getSession('proj_1', 'SCRIPT_GENERATION');
    sm.recordMessage('proj_1', 'CAPABILITY_ASSESSMENT');
    sm.recordMessage('proj_1', 'SCRIPT_GENERATION');

    sm.clearGroup('proj_1', 'CAPABILITY_ASSESSMENT');

    // Analysis group cleared
    expect(sm.shouldContinueChat('proj_1', 'CAPABILITY_ASSESSMENT')).toBe(false);
    // Creation group still has messages
    expect(sm.shouldContinueChat('proj_1', 'SCRIPT_GENERATION')).toBe(true);
  });

  it('getGroupForStage returns correct group', () => {
    expect(sm.getGroupForStage('VIDEO_GEN')).toBe('production');
    expect(sm.getGroupForStage('STORYBOARD')).toBe('visual');
    expect(sm.getGroupForStage('NARRATIVE_MAP')).toBe('creation');
  });

  it('getAllSessions returns all active sessions', () => {
    sm.getSession('proj_1', 'CAPABILITY_ASSESSMENT');
    sm.getSession('proj_1', 'SCRIPT_GENERATION');
    sm.getSession('proj_2', 'CAPABILITY_ASSESSMENT');
    expect(sm.getAllSessions()).toHaveLength(3);
  });
});
