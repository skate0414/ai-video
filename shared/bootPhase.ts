/* ------------------------------------------------------------------ */
/*  bootPhase.ts — Unified boot state machine definition.             */
/*                                                                    */
/*  State diagram:                                                    */
/*                                                                    */
/*    IDLE → WINDOW → AUTOMATION → PORT_CHECK → BACKEND_SPAWN        */
/*         → HEALTH_WAIT → READY                                     */
/*                           ↓                                        */
/*         ← PORT_CHECK ← BACKEND_CRASHED ←──────────┘               */
/*                              ↓                                     */
/*    Any live phase ─────→ SHUTTING_DOWN → STOPPED                   */
/*    Any phase ──────────→ FAILED → SHUTTING_DOWN → STOPPED          */
/* ------------------------------------------------------------------ */

/**
 * Boot phases for the Electron shell startup state machine.
 *
 * Converges five previously scattered concerns:
 *   1. Backend launcher   (spawn + crash restart)
 *   2. Electron main      (window creation, tab setup)
 *   3. Health check       (HTTP polling with timeout)
 *   4. Provider registry  (readiness verification)
 *   5. Startup gating     (UI blocked until backend ready)
 */
export enum BootPhase {
  /** Initial state before boot begins. */
  IDLE = 'IDLE',
  /** Creating the Electron BrowserWindow and tab bar. */
  WINDOW = 'WINDOW',
  /** Starting the automation control HTTP server. */
  AUTOMATION = 'AUTOMATION',
  /** Verifying ports: backend port free, CDP port bound. */
  PORT_CHECK = 'PORT_CHECK',
  /** Spawning the backend child process. */
  BACKEND_SPAWN = 'BACKEND_SPAWN',
  /** Polling /health until the backend responds OK. */
  HEALTH_WAIT = 'HEALTH_WAIT',
  /** All systems operational — app tab opened. */
  READY = 'READY',
  /** Backend crashed, pending restart with backoff. */
  BACKEND_CRASHED = 'BACKEND_CRASHED',
  /** Unrecoverable failure — boot halted. */
  FAILED = 'FAILED',
  /** Graceful shutdown in progress. */
  SHUTTING_DOWN = 'SHUTTING_DOWN',
  /** Shutdown complete — terminal state. */
  STOPPED = 'STOPPED',
}

/** Valid outgoing transitions for each phase. */
export const BOOT_TRANSITIONS: Readonly<Record<BootPhase, readonly BootPhase[]>> = Object.freeze({
  [BootPhase.IDLE]:             [BootPhase.WINDOW, BootPhase.FAILED, BootPhase.SHUTTING_DOWN],
  [BootPhase.WINDOW]:           [BootPhase.AUTOMATION, BootPhase.FAILED, BootPhase.SHUTTING_DOWN],
  [BootPhase.AUTOMATION]:       [BootPhase.PORT_CHECK, BootPhase.FAILED, BootPhase.SHUTTING_DOWN],
  [BootPhase.PORT_CHECK]:       [BootPhase.BACKEND_SPAWN, BootPhase.FAILED, BootPhase.SHUTTING_DOWN],
  [BootPhase.BACKEND_SPAWN]:    [BootPhase.HEALTH_WAIT, BootPhase.FAILED, BootPhase.SHUTTING_DOWN],
  [BootPhase.HEALTH_WAIT]:      [BootPhase.READY, BootPhase.BACKEND_CRASHED, BootPhase.FAILED, BootPhase.SHUTTING_DOWN],
  [BootPhase.READY]:            [BootPhase.BACKEND_CRASHED, BootPhase.SHUTTING_DOWN],
  [BootPhase.BACKEND_CRASHED]:  [BootPhase.PORT_CHECK, BootPhase.FAILED, BootPhase.SHUTTING_DOWN],
  [BootPhase.FAILED]:           [BootPhase.SHUTTING_DOWN],
  [BootPhase.SHUTTING_DOWN]:    [BootPhase.STOPPED],
  [BootPhase.STOPPED]:          [],
});

/** Returns true if `from → to` is a valid phase transition. */
export function isValidTransition(from: BootPhase, to: BootPhase): boolean {
  return BOOT_TRANSITIONS[from].includes(to);
}
