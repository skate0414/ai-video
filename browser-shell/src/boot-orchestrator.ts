/**
 * boot-orchestrator.ts — Unified startup state machine for the Electron shell.
 *
 * Converges five previously scattered concerns into one observable FSM:
 *   1. Backend launcher   (spawn + crash restart with exponential backoff)
 *   2. Electron main      (window creation, tab setup)
 *   3. Health check       (HTTP polling with timeout + provider readiness)
 *   4. Provider registry  (gate on provider count from /health response)
 *   5. Startup gating     (UI tab blocked until READY)
 *
 * Fixes:
 *   W11 — Exponential backoff on crash restart (was fixed 2 s)
 *   W12 — Port conflict detection before backend spawn
 *   W13 — UI startup blocked until backend is healthy
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { BootPhase, BOOT_TRANSITIONS } from '../../shared/bootPhase.js';

export { BootPhase };

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BootConfig {
  /** Port the backend HTTP server listens on (default 3220). */
  backendPort: number;
  /** Chrome DevTools Protocol remote-debugging port (default 9222). */
  cdpPort: number;
  /** Max ms to wait for /health before giving up (default 30 000). */
  healthTimeoutMs: number;
  /** Max consecutive crash restarts before FAILED (default 5). */
  maxCrashRestarts: number;
}

/**
 * Callback interface — isolates all Electron-specific operations so
 * the BootOrchestrator itself stays unit-testable without Electron.
 */
export interface BootCallbacks {
  /** Create the BrowserWindow + tab bar. */
  createWindow: () => void;
  /** Start the automation control server. */
  startAutomation: () => void;
  /** Open the app UI as the first (pinned) tab — called only after READY. */
  openAppTab: () => void;
  /** Return spawn descriptor for the backend child process. */
  resolveBackend: () => {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  };
}

export type BootLogLevel = 'info' | 'warn' | 'error';

/** Health response shape expected from the backend /health endpoint. */
interface HealthResponse {
  ok: boolean;
  providers?: number;
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

const DEFAULTS: BootConfig = {
  backendPort: 3220,
  cdpPort: 9222,
  healthTimeoutMs: 30_000,
  maxCrashRestarts: 5,
};

/* ------------------------------------------------------------------ */
/*  BootOrchestrator                                                   */
/* ------------------------------------------------------------------ */

/**
 * Drives the Electron shell through a strict phase sequence:
 *
 *   IDLE → WINDOW → AUTOMATION → PORT_CHECK → BACKEND_SPAWN
 *        → HEALTH_WAIT → READY
 *
 * Emits:
 *   'phase'         (phase: BootPhase, detail?: string)
 *   'log'           (level: BootLogLevel, message: string)
 *   'backendOutput' (stream: 'stdout'|'stderr', data: string)
 */
export class BootOrchestrator extends EventEmitter {
  private _phase: BootPhase = BootPhase.IDLE;
  private backendProcess: ChildProcess | null = null;
  private crashCount = 0;
  private shuttingDown = false;
  private callbacks: BootCallbacks | null = null;
  readonly config: BootConfig;

  constructor(config: Partial<BootConfig> = {}) {
    super();
    this.config = { ...DEFAULTS, ...config };
  }

  /* ---- Phase management ------------------------------------------ */

  get phase(): BootPhase {
    return this._phase;
  }

  /**
   * Transition to a new phase.  Throws on illegal transitions.
   */
  private setPhase(next: BootPhase, detail?: string): void {
    const allowed = BOOT_TRANSITIONS[this._phase];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid boot transition: ${this._phase} → ${next}`);
    }
    const prev = this._phase;
    this._phase = next;
    this.emit('phase', next, detail);
    this.log('info', `${prev} → ${next}${detail ? ` (${detail})` : ''}`);
  }

  private log(level: BootLogLevel, msg: string): void {
    this.emit('log', level, `[Boot] ${msg}`);
    const fn =
      level === 'error' ? console.error :
      level === 'warn'  ? console.warn  :
      console.log;
    fn(`[Boot] ${msg}`);
  }

  /* ---- Main boot sequence ---------------------------------------- */

  /**
   * Run the full boot sequence.
   * Resolves with the final phase (READY or FAILED).
   */
  async boot(callbacks: BootCallbacks): Promise<BootPhase> {
    this.callbacks = callbacks;
    this.shuttingDown = false;

    try {
      // Phase 1 — WINDOW
      this.setPhase(BootPhase.WINDOW);
      callbacks.createWindow();

      // Phase 2 — AUTOMATION
      this.setPhase(BootPhase.AUTOMATION);
      callbacks.startAutomation();

      // Phase 3 — PORT_CHECK  (W12: detect conflicts)
      this.setPhase(BootPhase.PORT_CHECK);
      await this.checkPorts();

      // Phase 4 — BACKEND_SPAWN
      this.setPhase(BootPhase.BACKEND_SPAWN);
      this.spawnBackend();

      // Phase 5 — HEALTH_WAIT  (W13: block UI until healthy)
      this.setPhase(BootPhase.HEALTH_WAIT);
      const health = await this.waitForHealth();
      if (!health.ok) {
        this.setPhase(BootPhase.FAILED, 'Backend health check timeout');
        return this._phase;
      }

      // Phase 6 — READY: open the app tab
      this.setPhase(BootPhase.READY);
      this.crashCount = 0;
      callbacks.openAppTab();

      // Log provider status (provider registry gate — informational)
      if (health.providers !== undefined) {
        if (health.providers === 0) {
          this.log('warn', 'No providers configured — pipeline will not run until accounts are added');
        } else {
          this.log('info', `${health.providers} provider(s) registered`);
        }
      }

      return this._phase;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this._phase !== BootPhase.FAILED) {
        try {
          this.setPhase(BootPhase.FAILED, msg);
        } catch {
          this._phase = BootPhase.FAILED;
          this.emit('phase', BootPhase.FAILED, msg);
        }
      }
      return this._phase;
    }
  }

  /* ---- Port checks (W12) ----------------------------------------- */

  private async checkPorts(): Promise<void> {
    const backendBusy = await this.isPortInUse(this.config.backendPort);
    if (backendBusy) {
      throw new Error(
        `Port ${this.config.backendPort} is already in use — another backend instance may be running`,
      );
    }

    const cdpAccessible = await this.isPortInUse(this.config.cdpPort);
    if (!cdpAccessible) {
      this.log(
        'warn',
        `CDP port ${this.config.cdpPort} not accessible — Playwright automation may fail`,
      );
    }

    this.log(
      'info',
      `Ports OK: backend=${this.config.backendPort} (free), ` +
      `CDP=${this.config.cdpPort} (${cdpAccessible ? 'bound' : 'not bound'})`,
    );
  }

  /** Returns true if a TCP connection to `port` on 127.0.0.1 succeeds. */
  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' });
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
      timer.unref();
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.once('error',   () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    });
  }

  /* ---- Backend spawn --------------------------------------------- */

  private spawnBackend(): void {
    if (!this.callbacks) throw new Error('boot() must be called first');
    const { command, args, env, cwd } = this.callbacks.resolveBackend();
    this.log('info', `Spawning: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });

    child.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[backend] ${msg}`);
        this.emit('backendOutput', 'stdout', msg);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.warn(`[backend] ${msg}`);
        this.emit('backendOutput', 'stderr', msg);
      }
    });

    child.on('exit', (code, signal) => {
      this.log('info', `Backend exited: code=${code} signal=${signal}`);
      this.backendProcess = null;
      if (!this.shuttingDown && code !== 0) {
        this.handleCrash();
      }
    });

    this.backendProcess = child;
  }

  /* ---- Crash recovery with exponential backoff (W11) ------------- */

  private handleCrash(): void {
    this.crashCount++;

    if (this.crashCount > this.config.maxCrashRestarts) {
      this.log('error', `Backend crashed ${this.crashCount} times — giving up`);
      this._phase = BootPhase.BACKEND_CRASHED;
      this.emit('phase', BootPhase.BACKEND_CRASHED, 'max restarts exceeded');
      this.setPhase(BootPhase.FAILED, `Exceeded ${this.config.maxCrashRestarts} restarts`);
      return;
    }

    // Exponential backoff: 2 s → 4 s → 8 s → 16 s → 32 s (capped)
    const delayMs = Math.min(2000 * 2 ** (this.crashCount - 1), 32_000);
    this.log(
      'warn',
      `Crash #${this.crashCount}/${this.config.maxCrashRestarts}, restart in ${delayMs} ms`,
    );

    if (this._phase === BootPhase.READY || this._phase === BootPhase.HEALTH_WAIT) {
      this.setPhase(BootPhase.BACKEND_CRASHED, `crash #${this.crashCount}`);
    }

    setTimeout(async () => {
      if (this.shuttingDown) return;
      try {
        this.setPhase(BootPhase.PORT_CHECK, 'restart');
        await this.checkPorts();
        this.setPhase(BootPhase.BACKEND_SPAWN, 'restart');
        this.spawnBackend();
        this.setPhase(BootPhase.HEALTH_WAIT, 'restart');
        const health = await this.waitForHealth();
        if (health.ok) {
          this.setPhase(BootPhase.READY, 'recovered');
          this.crashCount = 0;
        } else {
          this.handleCrash();
        }
      } catch (err) {
        this.log('error', `Restart failed: ${err}`);
        this.handleCrash();
      }
    }, delayMs);
  }

  /* ---- Health polling (W13) -------------------------------------- */

  private async waitForHealth(): Promise<HealthResponse> {
    const start = Date.now();
    const url = `http://127.0.0.1:${this.config.backendPort}/health`;

    while (Date.now() - start < this.config.healthTimeoutMs) {
      if (this.shuttingDown) return { ok: false };
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const body = await resp.json() as Record<string, unknown>;
          this.log('info', 'Backend healthy');
          return {
            ok: true,
            providers: typeof body.providers === 'number' ? body.providers : undefined,
          };
        }
      } catch {
        // Not ready yet — retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    this.log('error', `Health timeout after ${this.config.healthTimeoutMs} ms`);
    return { ok: false };
  }

  /* ---- Shutdown -------------------------------------------------- */

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    if (
      this._phase !== BootPhase.FAILED &&
      this._phase !== BootPhase.STOPPED &&
      this._phase !== BootPhase.SHUTTING_DOWN
    ) {
      this.setPhase(BootPhase.SHUTTING_DOWN);
    }

    if (this.backendProcess && !this.backendProcess.killed) {
      this.log('info', 'Stopping backend…');
      this.backendProcess.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.backendProcess && !this.backendProcess.killed) {
            this.log('warn', 'Force killing backend…');
            this.backendProcess.kill('SIGKILL');
          }
          resolve();
        }, 5_000);
        timer.unref();
        this.backendProcess?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    if (this._phase === BootPhase.SHUTTING_DOWN) {
      this.setPhase(BootPhase.STOPPED);
    }
  }

  /** Check if the backend child process is alive. */
  isBackendRunning(): boolean {
    return this.backendProcess !== null && !this.backendProcess.killed;
  }
}
