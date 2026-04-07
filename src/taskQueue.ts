import type { ProviderId, TaskItem } from './types.js';

let counter = 0;

/** Generate a short unique id. */
function uid(): string {
  return `task_${Date.now()}_${++counter}`;
}

/**
 * In-memory ordered task queue.
 *
 * Tasks progress through: pending → running → done | failed.
 * The queue is consumed sequentially – only one task is "running" at a time.
 */
export class TaskQueue {
  private items: TaskItem[] = [];

  /** Return a shallow copy of all tasks. */
  all(): TaskItem[] {
    return [...this.items];
  }

  /** Add one or many questions.  Returns the created TaskItem(s). */
  add(questions: string | string[], preferredProvider?: ProviderId, preferredModel?: string, attachments?: string[]): TaskItem[] {
    const qs = Array.isArray(questions) ? questions : [questions];
    const created: TaskItem[] = qs.map((q) => ({
      id: uid(),
      question: q,
      status: 'pending' as const,
      ...(preferredProvider ? { preferredProvider } : {}),
      ...(preferredModel ? { preferredModel } : {}),
      ...(attachments?.length ? { attachments } : {}),
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
    t.status = 'running';
    t.startedAt = new Date().toISOString();
    t.accountId = accountId;
  }

  /** Mark a task as done with an answer. */
  markDone(taskId: string, answer: string): void {
    const t = this.get(taskId);
    if (!t) return;
    t.status = 'done';
    t.answer = answer;
    t.completedAt = new Date().toISOString();
  }

  /** Mark a task as failed. */
  markFailed(taskId: string, error: string): void {
    const t = this.get(taskId);
    if (!t) return;
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
}
