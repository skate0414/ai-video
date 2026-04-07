/* ------------------------------------------------------------------ */
/*  SessionManager – manages chat session lifecycle and reuse         */
/*  Enables context sharing across related pipeline stages by         */
/*  grouping them into named sessions.                                */
/* ------------------------------------------------------------------ */

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
 * Group C (Visual): STORYBOARD → REFERENCE_IMAGE → KEYFRAME_GEN
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
  STORYBOARD: 'visual',
  REFERENCE_IMAGE: 'visual',
  KEYFRAME_GEN: 'visual',
  VIDEO_GEN: 'production',
  TTS: 'production',
  ASSEMBLY: 'production',
  REFINEMENT: 'production',
};

const GROUP_STAGES: Record<SessionGroup, PipelineStage[]> = {
  analysis: ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH'],
  creation: ['NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW'],
  visual: ['STORYBOARD', 'REFERENCE_IMAGE', 'KEYFRAME_GEN'],
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
}
