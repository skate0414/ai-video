/* ------------------------------------------------------------------ */
/*  Frontend configuration — centralized constants for the UI.         */
/*  Values are injected at build time via Vite's `define` and can be   */
/*  overridden with environment variables (VITE_BACKEND_PORT, etc).    */
/* ------------------------------------------------------------------ */

/** Port the backend HTTP server listens on. */
export const BACKEND_PORT: number =
  typeof import.meta.env?.VITE_BACKEND_PORT === 'string'
    ? Number(import.meta.env.VITE_BACKEND_PORT)
    : 3220;

/** Full backend origin used when running inside Electron (file:// / app://). */
export const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
