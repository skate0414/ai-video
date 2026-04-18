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
export declare enum BootPhase {
    /** Initial state before boot begins. */
    IDLE = "IDLE",
    /** Creating the Electron BrowserWindow and tab bar. */
    WINDOW = "WINDOW",
    /** Starting the automation control HTTP server. */
    AUTOMATION = "AUTOMATION",
    /** Verifying ports: backend port free, CDP port bound. */
    PORT_CHECK = "PORT_CHECK",
    /** Spawning the backend child process. */
    BACKEND_SPAWN = "BACKEND_SPAWN",
    /** Polling /health until the backend responds OK. */
    HEALTH_WAIT = "HEALTH_WAIT",
    /** All systems operational — app tab opened. */
    READY = "READY",
    /** Backend crashed, pending restart with backoff. */
    BACKEND_CRASHED = "BACKEND_CRASHED",
    /** Unrecoverable failure — boot halted. */
    FAILED = "FAILED",
    /** Graceful shutdown in progress. */
    SHUTTING_DOWN = "SHUTTING_DOWN",
    /** Shutdown complete — terminal state. */
    STOPPED = "STOPPED"
}
/** Valid outgoing transitions for each phase. */
export declare const BOOT_TRANSITIONS: Record<BootPhase, readonly BootPhase[]>;
/** Returns true if `from → to` is a valid phase transition. */
export declare function isValidTransition(from: BootPhase, to: BootPhase): boolean;
