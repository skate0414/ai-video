/* ------------------------------------------------------------------ */
/*  RunLock – per-project concurrency guard                           */
/*  Prevents two pipeline runs on the same project at the same time.  */
/* ------------------------------------------------------------------ */

/**
 * RunLock ensures that at most one pipeline run is active per projectId.
 * It is safe to run different projects concurrently.
 */
export class RunLock {
  private running = new Map<string, { startedAt: number; abort: () => void }>();

  /**
   * Attempt to acquire the run lock for a project.
   * @returns `true` if acquired, `false` if the project is already running.
   */
  acquire(projectId: string, abort: () => void): boolean {
    if (this.running.has(projectId)) return false;
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
   * Check if a project is currently running.
   */
  isRunning(projectId: string): boolean {
    return this.running.has(projectId);
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
   * Get all currently running project IDs with their start times.
   */
  getRunning(): Array<{ projectId: string; startedAt: number }> {
    return [...this.running.entries()].map(([projectId, v]) => ({
      projectId,
      startedAt: v.startedAt,
    }));
  }
}
