/* ------------------------------------------------------------------ */
/*  TempFileTracker – tracks temporary files for cleanup              */
/*  Ensures intermediate files are removed even on pipeline errors.   */
/* ------------------------------------------------------------------ */

import { existsSync, unlinkSync, rmSync } from 'node:fs';

/**
 * Tracks temporary files and directories created during a pipeline run
 * so they can be cleaned up in a finally block even if a stage throws.
 */
export class TempFileTracker {
  private readonly files: string[] = [];
  private readonly dirs: string[] = [];

  /** Register a file for cleanup. Returns the same path for chaining. */
  trackFile(path: string): string {
    this.files.push(path);
    return path;
  }

  /** Register a directory for cleanup. Returns the same path for chaining. */
  trackDir(path: string): string {
    this.dirs.push(path);
    return path;
  }

  /** Remove all tracked files and directories. Best-effort, never throws. */
  cleanup(): { removed: number; errors: number } {
    let removed = 0;
    let errors = 0;

    for (const f of this.files) {
      try {
        if (existsSync(f)) {
          unlinkSync(f);
          removed++;
        }
      } catch {
        errors++;
      }
    }

    // Remove directories in reverse order (deepest first)
    for (const d of this.dirs.reverse()) {
      try {
        if (existsSync(d)) {
          rmSync(d, { recursive: true, force: true });
          removed++;
        }
      } catch {
        errors++;
      }
    }

    this.files.length = 0;
    this.dirs.length = 0;
    return { removed, errors };
  }
}
