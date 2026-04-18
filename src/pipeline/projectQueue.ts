/* ------------------------------------------------------------------ */
/*  ProjectQueue – bounded-concurrency scheduler for batch pipelines  */
/* ------------------------------------------------------------------ */

import { createLogger } from '../lib/logger.js';

const log = createLogger('ProjectQueue');

export interface QueuedProject {
  projectId: string;
  enqueuedAt: string;
}

export interface ActiveProject {
  projectId: string;
  startedAt: string;
}

export interface QueueSnapshot {
  active: ActiveProject[];
  queued: QueuedProject[];
  maxConcurrent: number;
}

export type StartFn = (projectId: string) => { ok: true } | { error: string; status: number };

/**
 * Bounded-concurrency project queue.
 *
 * - Projects are enqueued via `enqueue()`.
 * - Up to `maxConcurrent` projects run at once.
 * - When a project finishes (via `markDone()`), the next queued project is
 *   automatically started.
 */
export class ProjectQueue {
  private queue: QueuedProject[] = [];
  private active = new Map<string, ActiveProject>();
  private _maxConcurrent: number;
  private startFn: StartFn;

  constructor(maxConcurrent: number, startFn: StartFn) {
    this._maxConcurrent = Math.max(1, maxConcurrent);
    this.startFn = startFn;
  }

  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  set maxConcurrent(n: number) {
    this._maxConcurrent = Math.max(1, n);
    this.drain();
  }

  /** Enqueue a project. Starts immediately if capacity allows. */
  enqueue(projectId: string): 'started' | 'queued' {
    // Already active or already queued — no-op
    if (this.active.has(projectId)) return 'started';
    if (this.queue.some(q => q.projectId === projectId)) return 'queued';

    if (this.active.size < this._maxConcurrent) {
      return this.startProject(projectId);
    }

    this.queue.push({ projectId, enqueuedAt: new Date().toISOString() });
    log.info('project_queued', { projectId, position: this.queue.length });
    return 'queued';
  }

  /** Mark a project as done (success, error, or aborted). Drains queue. */
  markDone(projectId: string): void {
    if (!this.active.delete(projectId)) return;
    log.info('project_done', { projectId, remaining: this.queue.length });
    this.drain();
  }

  /** Remove a queued (not yet started) project. Returns true if removed. */
  dequeue(projectId: string): boolean {
    const idx = this.queue.findIndex(q => q.projectId === projectId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  /** Current state snapshot (for API observability). */
  snapshot(): QueueSnapshot {
    return {
      active: [...this.active.values()],
      queued: [...this.queue],
      maxConcurrent: this._maxConcurrent,
    };
  }

  /** Whether a project is currently active (running). */
  isActive(projectId: string): boolean {
    return this.active.has(projectId);
  }

  /** Whether a project is waiting in the queue. */
  isQueued(projectId: string): boolean {
    return this.queue.some(q => q.projectId === projectId);
  }

  /** Total number of active + queued items. */
  get size(): number {
    return this.active.size + this.queue.length;
  }

  /* ---- internal ---- */

  private startProject(projectId: string): 'started' | 'queued' {
    const result = this.startFn(projectId);
    if ('error' in result) {
      log.warn('start_failed', { projectId, error: result.error });
      // Don't queue a project that fails to start
      return 'queued';
    }
    this.active.set(projectId, { projectId, startedAt: new Date().toISOString() });
    log.info('project_started', { projectId, active: this.active.size });
    return 'started';
  }

  private drain(): void {
    while (this.active.size < this._maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.startProject(next.projectId);
    }
  }
}
