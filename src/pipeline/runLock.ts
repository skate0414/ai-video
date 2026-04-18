/* ------------------------------------------------------------------ */
/*  RunLock – per-compilation-unit concurrency guard                   */
/*  Prevents two compilation runs on the same project simultaneously. */
/* ------------------------------------------------------------------ */

/** Default lease timeout: 30 minutes. */
const DEFAULT_LEASE_TIMEOUT_MS = 30 * 60_000;

/**
 * RunLock ensures that at most one pipeline run is active per projectId.
 * It is safe to run different projects concurrently.
 *
 * A configurable lease timeout (W10) auto-expires stale locks so a crashed
 * run cannot permanently block its project.
 */
export class RunLock {
  private running = new Map<string, { startedAt: number; abort: () => void }>();
  private readonly leaseTimeoutMs: number;

  constructor(leaseTimeoutMs: number = DEFAULT_LEASE_TIMEOUT_MS) {
    this.leaseTimeoutMs = leaseTimeoutMs;
  }

  /**
   * Attempt to acquire the run lock for a project.
   * If a stale lock is detected (exceeded lease timeout), it is auto-released
   * before granting the new lock.
   * @returns `true` if acquired, `false` if the project is already running.
   */
  acquire(projectId: string, abort: () => void): boolean {
    const existing = this.running.get(projectId);
    if (existing) {
      // W10: Stale lock recovery — if lease has expired, auto-release
      if (Date.now() - existing.startedAt > this.leaseTimeoutMs) {
        this.running.delete(projectId);
      } else {
        return false;
      }
    }
    this.running.set(projectId, { startedAt: Date.now(), abort });
    return true;
  }

  /**
   * Release the lock after a run completes (success or failure).
   */
  release(projectId: string): void {
    this.running.delete(projectId);
  }

  /**
   * Check if a project is currently running (non-stale).
   */
  isRunning(projectId: string): boolean {
    const entry = this.running.get(projectId);
    if (!entry) return false;
    // Stale locks are not "running"
    if (Date.now() - entry.startedAt > this.leaseTimeoutMs) {
      this.running.delete(projectId);
      return false;
    }
    return true;
  }

  /**
   * Abort a running project's pipeline and release the lock.
   */
  abort(projectId: string): boolean {
    const entry = this.running.get(projectId);
    if (!entry) return false;
    entry.abort();
    return true;
  }

  /**
   * Abort all running pipelines.
   */
  abortAll(): void {
    for (const entry of this.running.values()) {
      entry.abort();
    }
  }

  /**
   * Get all currently running (non-stale) project IDs with their start times.
   */
  getRunning(): Array<{ projectId: string; startedAt: number }> {
    const now = Date.now();
    const result: Array<{ projectId: string; startedAt: number }> = [];
    for (const [projectId, v] of this.running.entries()) {
      if (now - v.startedAt > this.leaseTimeoutMs) {
        this.running.delete(projectId);
      } else {
        result.push({ projectId, startedAt: v.startedAt });
      }
    }
    return result;
  }
}
