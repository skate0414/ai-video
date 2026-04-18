import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueue } from './taskQueue.js';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('stores per-task chat session metadata', () => {
    const [task] = queue.add('Session question', undefined, undefined, undefined, {
      chatMode: 'continue',
      sessionId: 'session_123',
    });
    expect(task.chatMode).toBe('continue');
    expect(task.sessionId).toBe('session_123');
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

  it('markRunning is a no-op for unknown task id', () => {
    expect(() => queue.markRunning('missing-task', 'acc_1')).not.toThrow();
    expect(queue.all()).toHaveLength(0);
  });

  it('markDone is a no-op for unknown task id', () => {
    expect(() => queue.markDone('missing-task', 'Answer')).not.toThrow();
    expect(queue.all()).toHaveLength(0);
  });

  it('markFailed is a no-op for unknown task id', () => {
    expect(() => queue.markFailed('missing-task', 'Error')).not.toThrow();
    expect(queue.all()).toHaveLength(0);
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

  describe('state machine validation', () => {
    it('rejects pending → done (must go through running)', () => {
      const [task] = queue.add('Q');
      expect(() => queue.markDone(task.id, 'answer')).toThrow(/Invalid task state transition.*pending → done/);
    });

    it('rejects pending → failed (must go through running)', () => {
      const [task] = queue.add('Q');
      expect(() => queue.markFailed(task.id, 'err')).toThrow(/Invalid task state transition.*pending → failed/);
    });

    it('rejects done → running', () => {
      const [task] = queue.add('Q');
      queue.markRunning(task.id, 'acc');
      queue.markDone(task.id, 'answer');
      expect(() => queue.markRunning(task.id, 'acc')).toThrow(/Invalid task state transition.*done → running/);
    });

    it('allows failed → pending (retry)', () => {
      const [task] = queue.add('Q');
      queue.markRunning(task.id, 'acc');
      queue.markFailed(task.id, 'err');
      // Manually reset to test transition
      const t = queue.get(task.id)!;
      t.status = 'pending' as const;  // simulate retry reset
      // Should now be able to run again
      queue.markRunning(task.id, 'acc');
      expect(queue.get(task.id)?.status).toBe('running');
    });
  });

  describe('capacity limit', () => {
    it('enforces max queue size', () => {
      const small = new TaskQueue(3);
      small.add(['A', 'B', 'C']);
      expect(() => small.add('D')).toThrow(/capacity exceeded/);
    });

    it('allows adding up to exactly max size', () => {
      const small = new TaskQueue(2);
      expect(() => small.add(['A', 'B'])).not.toThrow();
      expect(small.all()).toHaveLength(2);
    });
  });
});

describe('TaskQueue persistence', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `taskqueue-persist-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, 'tasks.json');
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('saveTo + loadFrom round-trips pending tasks', () => {
    const q1 = new TaskQueue();
    q1.add(['A', 'B']);
    q1.saveTo(filePath);

    const q2 = new TaskQueue();
    q2.loadFrom(filePath);
    expect(q2.all()).toHaveLength(2);
    expect(q2.all()[0].question).toBe('A');
    expect(q2.all()[1].question).toBe('B');
    expect(q2.all().every(t => t.status === 'pending')).toBe(true);
  });

  it('running tasks are demoted to pending on save', () => {
    const q1 = new TaskQueue();
    const [task] = q1.add('RunningQ');
    q1.markRunning(task.id, 'acc');
    q1.saveTo(filePath);

    const q2 = new TaskQueue();
    q2.loadFrom(filePath);
    const loaded = q2.get(task.id)!;
    expect(loaded.status).toBe('pending');
    expect(loaded.startedAt).toBeUndefined();
    expect(loaded.accountId).toBeUndefined();
  });

  it('done and failed tasks are excluded from save', () => {
    const q = new TaskQueue();
    const items = q.add(['Pending', 'Done', 'Failed']);
    q.markRunning(items[1].id, 'acc');
    q.markDone(items[1].id, 'answer');
    q.markRunning(items[2].id, 'acc');
    q.markFailed(items[2].id, 'err');
    q.saveTo(filePath);

    const q2 = new TaskQueue();
    q2.loadFrom(filePath);
    expect(q2.all()).toHaveLength(1);
    expect(q2.all()[0].question).toBe('Pending');
  });

  it('loadFrom is a no-op when file does not exist', () => {
    const q = new TaskQueue();
    q.add('Existing');
    q.loadFrom(join(dir, 'nonexistent.json'));
    expect(q.all()).toHaveLength(1); // unchanged
  });

  it('loadFrom handles corrupt JSON gracefully', () => {
    writeFileSync(filePath, '{broken!!!');
    const q = new TaskQueue();
    q.loadFrom(filePath);
    expect(q.all()).toHaveLength(0);
  });

  it('loadFrom skips invalid entries', () => {
    writeFileSync(filePath, JSON.stringify([
      { id: 'ok', question: 'Valid', status: 'pending' },
      { noId: true },
      'not an object',
      { id: 'ok2', question: 'Valid2', status: 'nonexistent_status' },
    ]));
    const q = new TaskQueue();
    q.loadFrom(filePath);
    expect(q.all()).toHaveLength(1);
    expect(q.all()[0].question).toBe('Valid');
  });

  it('loadFrom truncates to maxSize', () => {
    const big = new TaskQueue();
    big.add(['A', 'B', 'C', 'D', 'E']);
    big.saveTo(filePath);

    const small = new TaskQueue(3);
    small.loadFrom(filePath);
    expect(small.all()).toHaveLength(3);
  });

  it('loadFrom replaces existing items', () => {
    const q = new TaskQueue();
    q.add('Old');
    writeFileSync(filePath, JSON.stringify([
      { id: 'new1', question: 'New', status: 'pending' },
    ]));
    q.loadFrom(filePath);
    expect(q.all()).toHaveLength(1);
    expect(q.all()[0].question).toBe('New');
  });

  it('loadFrom handles non-array JSON gracefully', () => {
    writeFileSync(filePath, JSON.stringify({ notArray: true }));
    const q = new TaskQueue();
    q.loadFrom(filePath);
    expect(q.all()).toHaveLength(0);
  });
});

describe('TaskQueue no-op on missing task', () => {
  it('markRunning is a no-op for non-existent task', () => {
    const q = new TaskQueue();
    // Should not throw
    q.markRunning('nonexistent', 'acc');
    expect(q.all()).toHaveLength(0);
  });

  it('markDone is a no-op for non-existent task', () => {
    const q = new TaskQueue();
    q.markDone('nonexistent', 'answer');
    expect(q.all()).toHaveLength(0);
  });

  it('markFailed is a no-op for non-existent task', () => {
    const q = new TaskQueue();
    q.markFailed('nonexistent', 'error');
    expect(q.all()).toHaveLength(0);
  });
});
