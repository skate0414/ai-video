/* ------------------------------------------------------------------ */
/*  SessionManager – compiler backend session pooling                 */
/*  Groups related compilation passes into shared sessions so the    */
/*  LLM backend retains context across passes (e.g. analysis group). */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PipelineStage } from './types.js';

/**
 * Session group definitions — stages that benefit from shared chat context.
 *
 * Group A (Analysis): CAPABILITY_ASSESSMENT → STYLE_EXTRACTION → RESEARCH
 *   Shares video analysis context across safety check, style, and research.
 *
 * Group B (Creation): NARRATIVE_MAP → SCRIPT_GENERATION → QA_REVIEW
 *   Shares narrative structure for consistent script development.
 *
 * Group C (Visual): STORYBOARD → VIDEO_IR_COMPILE → REFERENCE_IMAGE → KEYFRAME_GEN
 *   Shares visual style consistency across all image generation.
 *
 * Group D (Production): VIDEO_GEN, TTS, ASSEMBLY, REFINEMENT
 *   Independent — each gets its own session or no session.
 */
export type SessionGroup = 'analysis' | 'creation' | 'visual' | 'production';

export interface SessionInfo {
  group: SessionGroup;
  sessionId: string;
  stages: PipelineStage[];
  /** Whether to reuse the same chat thread (continue mode). */
  useSameChat: boolean;
  /** Counter of messages sent in this session. */
  messageCount: number;
  /** ISO timestamp of creation. */
  createdAt: string;
}

const SESSION_GROUP_MAP: Record<PipelineStage, SessionGroup> = {
  CAPABILITY_ASSESSMENT: 'analysis',
  STYLE_EXTRACTION: 'analysis',
  RESEARCH: 'analysis',
  NARRATIVE_MAP: 'creation',
  SCRIPT_GENERATION: 'creation',
  QA_REVIEW: 'creation',
  TEMPORAL_PLANNING: 'creation',
  STORYBOARD: 'visual',
  VIDEO_IR_COMPILE: 'visual',
  REFERENCE_IMAGE: 'visual',
  KEYFRAME_GEN: 'visual',
  VIDEO_GEN: 'production',
  TTS: 'production',
  ASSEMBLY: 'production',
  REFINEMENT: 'production',
};

const GROUP_STAGES: Record<SessionGroup, PipelineStage[]> = {
  analysis: ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH'],
  creation: ['NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING'],
  visual: ['STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE', 'KEYFRAME_GEN'],
  production: ['VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT'],
};

/**
 * SessionManager tracks chat session groups per project.
 * When a stage starts, it checks if a session already exists for that group
 * and returns the session ID so ChatAdapter can reuse the same chat thread.
 */
export class SessionManager {
  /** Active sessions keyed by `${projectId}:${group}` */
  private sessions = new Map<string, SessionInfo>();

  /**
   * Get or create a session for the given project + stage combination.
   * Returns session info including whether to use same chat.
   */
  getSession(projectId: string, stage: PipelineStage): SessionInfo {
    const group = SESSION_GROUP_MAP[stage];
    const key = `${projectId}:${group}`;

    let session = this.sessions.get(key);
    if (!session) {
      session = {
        group,
        sessionId: `session_${projectId}_${group}_${Date.now()}`,
        stages: GROUP_STAGES[group],
        useSameChat: false,
        messageCount: 0,
        createdAt: new Date().toISOString(),
      };
      this.sessions.set(key, session);
    }

    return session;
  }

  /**
   * Check if the stage is the first in its group (should open new chat)
   * or a continuation (should reuse existing chat).
   */
  shouldContinueChat(projectId: string, stage: PipelineStage): boolean {
    const group = SESSION_GROUP_MAP[stage];
    const key = `${projectId}:${group}`;
    const session = this.sessions.get(key);
    // If session exists and already has messages, continue
    return !!session && session.messageCount > 0;
  }

  /**
   * Record that a message was sent in this session.
   */
  recordMessage(projectId: string, stage: PipelineStage): void {
    const group = SESSION_GROUP_MAP[stage];
    const key = `${projectId}:${group}`;
    const session = this.sessions.get(key);
    if (session) {
      session.messageCount++;
      session.useSameChat = true;
    }
  }

  /**
   * Invalidate all sessions for a project (e.g. on retry or reset).
   */
  clearProject(projectId: string): void {
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Invalidate a specific group's session (e.g. when retrying a stage in that group).
   */
  clearGroup(projectId: string, stage: PipelineStage): void {
    const group = SESSION_GROUP_MAP[stage];
    this.sessions.delete(`${projectId}:${group}`);
  }

  /**
   * Get the group for a stage.
   */
  getGroupForStage(stage: PipelineStage): SessionGroup {
    return SESSION_GROUP_MAP[stage];
  }

  /**
   * Get all active sessions (for debugging / UI display).
   */
  getAllSessions(): SessionInfo[] {
    return [...this.sessions.values()];
  }

  /* ---- Persistence ---- */

  private static readonly SESSIONS_FILE = 'sessions.json';

  /**
   * Persist all sessions for a given project to `{projectDir}/sessions.json`.
   * Uses atomic write (write to tmp, then rename) to avoid corruption.
   */
  saveTo(projectDir: string): void {
    const entries: Array<{ key: string; value: SessionInfo }> = [];
    const prefix = projectDir; // we scope by projectDir
    for (const [key, value] of this.sessions) {
      // Only persist sessions whose key starts with the projectId embedded in the key
      entries.push({ key, value });
    }
    if (entries.length === 0) return;
    const filePath = join(projectDir, SessionManager.SESSIONS_FILE);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
    renameSync(tmpPath, filePath);
  }

  /**
   * Load sessions for a project from `{projectDir}/sessions.json`.
   * Merges into the current in-memory state (does not replace).
   */
  loadFrom(projectDir: string): void {
    const filePath = join(projectDir, SessionManager.SESSIONS_FILE);
    if (!existsSync(filePath)) return;
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Array<{ key: string; value: SessionInfo }>;
      for (const { key, value } of data) {
        if (!this.sessions.has(key)) {
          this.sessions.set(key, value);
        }
      }
    } catch {
      // Corrupt file — ignore and start fresh
    }
  }
}
