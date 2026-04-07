import { describe, it, expect, beforeEach } from 'vitest';
import { TaskQueue } from './taskQueue.js';

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  it('starts empty', () => {
    expect(queue.all()).toHaveLength(0);
    expect(queue.next()).toBeUndefined();
    expect(queue.pendingCount()).toBe(0);
  });

  it('adds a single question', () => {
    const items = queue.add('What is AI?');
    expect(items).toHaveLength(1);
    expect(items[0].question).toBe('What is AI?');
    expect(items[0].status).toBe('pending');
    expect(queue.pendingCount()).toBe(1);
  });

  it('adds multiple questions at once', () => {
    const items = queue.add(['Q1', 'Q2', 'Q3']);
    expect(items).toHaveLength(3);
    expect(queue.all()).toHaveLength(3);
    expect(queue.pendingCount()).toBe(3);
  });

  it('returns next pending task in FIFO order', () => {
    queue.add(['First', 'Second']);
    const next = queue.next();
    expect(next?.question).toBe('First');
  });

  it('marks a task as running', () => {
    const [task] = queue.add('Question');
    queue.markRunning(task.id, 'acc_1');
    expect(queue.get(task.id)?.status).toBe('running');
    expect(queue.get(task.id)?.accountId).toBe('acc_1');
    expect(queue.get(task.id)?.startedAt).toBeTruthy();
  });

  it('marks a task as done', () => {
    const [task] = queue.add('Question');
    queue.markRunning(task.id, 'acc_1');
    queue.markDone(task.id, 'Answer here');
    const t = queue.get(task.id)!;
    expect(t.status).toBe('done');
    expect(t.answer).toBe('Answer here');
    expect(t.completedAt).toBeTruthy();
    expect(queue.doneCount()).toBe(1);
  });

  it('marks a task as failed', () => {
    const [task] = queue.add('Question');
    queue.markRunning(task.id, 'acc_1');
    queue.markFailed(task.id, 'Timeout');
    const t = queue.get(task.id)!;
    expect(t.status).toBe('failed');
    expect(t.error).toBe('Timeout');
  });

  it('removes a task', () => {
    const [task] = queue.add('Remove me');
    expect(queue.remove(task.id)).toBe(true);
    expect(queue.all()).toHaveLength(0);
  });

  it('returns false when removing non-existent task', () => {
    expect(queue.remove('nonexistent')).toBe(false);
  });

  it('clears all tasks', () => {
    queue.add(['A', 'B', 'C']);
    queue.clear();
    expect(queue.all()).toHaveLength(0);
  });

  it('next() skips running / done tasks', () => {
    const items = queue.add(['A', 'B', 'C']);
    queue.markRunning(items[0].id, 'acc');
    queue.markDone(items[0].id, 'done');
    const next = queue.next();
    expect(next?.question).toBe('B');
  });
});
