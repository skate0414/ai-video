import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ProviderId, TaskItem } from './types.js';

type TaskStatus = TaskItem['status'];

let counter = 0;

/** Generate a short unique id. */
function uid(): string {
  return `task_${Date.now()}_${++counter}`;
}

/** Valid state transitions: pending → running → done | failed */
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['running'],
  running: ['done', 'failed'],
  done: [],
  failed: ['pending'],   // allow retry: failed → pending
} as const;

function assertTransition(from: TaskStatus, to: TaskStatus, taskId: string): void {
  if (!(VALID_TRANSITIONS[from] as readonly string[]).includes(to)) {
    throw new Error(`Invalid task state transition: ${from} → ${to} (task ${taskId})`);
  }
}

const DEFAULT_MAX_QUEUE_SIZE = 10_000;

/**
 * In-memory ordered task queue.
 *
 * Tasks progress through: pending → running → done | failed.
 * The queue is consumed sequentially – only one task is "running" at a time.
 */
export class TaskQueue {
  private items: TaskItem[] = [];
  private readonly maxSize: number;

  constructor(maxSize = DEFAULT_MAX_QUEUE_SIZE) {
    this.maxSize = maxSize;
  }

  /** Return a shallow copy of all tasks. */
  all(): TaskItem[] {
    return [...this.items];
  }

  /** Add one or many questions.  Returns the created TaskItem(s). */
  add(
    questions: string | string[],
    preferredProvider?: ProviderId,
    preferredModel?: string,
    attachments?: string[],
    options?: { chatMode?: TaskItem['chatMode']; sessionId?: TaskItem['sessionId'] },
  ): TaskItem[] {
    const qs = Array.isArray(questions) ? questions : [questions];
    if (this.items.length + qs.length > this.maxSize) {
      throw new Error(`TaskQueue capacity exceeded (max ${this.maxSize}). Remove completed tasks before adding new ones.`);
    }
    const created: TaskItem[] = qs.map((q) => ({
      id: uid(),
      question: q,
      status: 'pending' as const,
      ...(preferredProvider ? { preferredProvider } : {}),
      ...(preferredModel ? { preferredModel } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(options?.chatMode ? { chatMode: options.chatMode } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    }));
    this.items.push(...created);
    return created;
  }

  /** Get the next pending task (FIFO). */
  next(): TaskItem | undefined {
    return this.items.find((t) => t.status === 'pending');
  }

  /** Mark a task as running. */
  markRunning(taskId: string, accountId: string): void {
    const t = this.get(taskId);
    if (!t) return;
    assertTransition(t.status, 'running', taskId);
    t.status = 'running';
    t.startedAt = new Date().toISOString();
    t.accountId = accountId;
  }

  /** Mark a task as done with an answer. */
  markDone(taskId: string, answer: string): void {
    const t = this.get(taskId);
    if (!t) return;
    assertTransition(t.status, 'done', taskId);
    t.status = 'done';
    t.answer = answer;
    t.completedAt = new Date().toISOString();
  }

  /** Mark a task as failed. */
  markFailed(taskId: string, error: string): void {
    const t = this.get(taskId);
    if (!t) return;
    assertTransition(t.status, 'failed', taskId);
    t.status = 'failed';
    t.error = error;
    t.completedAt = new Date().toISOString();
  }

  /** Remove a task by id. Returns true if removed. */
  remove(taskId: string): boolean {
    const idx = this.items.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }

  /** Clear all tasks. */
  clear(): void {
    this.items = [];
  }

  /** Look up by id. */
  get(taskId: string): TaskItem | undefined {
    return this.items.find((t) => t.id === taskId);
  }

  /** How many tasks are pending. */
  pendingCount(): number {
    return this.items.filter((t) => t.status === 'pending').length;
  }

  /** How many tasks are done. */
  doneCount(): number {
    return this.items.filter((t) => t.status === 'done').length;
  }

  /**
   * Persist queue to a JSON file using atomic write (tmp + rename).
   * Only pending and running tasks are saved. Running tasks are
   * demoted to pending so they can be retried on reload.
   */
  saveTo(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const saveable = this.items
      .filter((t) => t.status === 'pending' || t.status === 'running')
      .map((t) => (t.status === 'running' ? { ...t, status: 'pending' as const, startedAt: undefined, accountId: undefined } : { ...t }));

    const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(saveable, null, 2));
    renameSync(tmpPath, filePath);
  }

  /**
   * Load tasks from a previously-persisted JSON file.
   * Replaces current queue contents. Invalid entries are skipped.
   */
  loadFrom(filePath: string): void {
    if (!existsSync(filePath)) return;

    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(raw)) return;

      const valid: TaskItem[] = [];
      for (const item of raw) {
        if (
          typeof item === 'object' && item !== null &&
          typeof item.id === 'string' &&
          typeof item.question === 'string' &&
          typeof item.status === 'string' &&
          item.status in VALID_TRANSITIONS
        ) {
          valid.push(item as TaskItem);
        }
      }

      if (valid.length > this.maxSize) {
        valid.length = this.maxSize;
      }

      this.items = valid;
    } catch {
      // Corrupt file — start with empty queue
    }
  }
}
