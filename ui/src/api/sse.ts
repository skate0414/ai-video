import type { WorkbenchEvent } from '../types';
import { BACKEND_ORIGIN } from '../config';
import { logger } from '../lib/logger';

/** Detect backend URL — Vite proxy in dev, direct in Electron/desktop. */
function getBaseUrl(): string {
  // In Electron (served from file:// or app://), connect directly to backend
  if (window.location.protocol === 'file:' || window.location.protocol === 'app:') {
    return BACKEND_ORIGIN;
  }
  // In dev mode (Vite), use relative path (Vite proxy handles /api)
  return '';
}

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * Connect to the SSE event stream with automatic reconnection.
 * Uses exponential backoff on errors (1 s → 2 s → 4 s → … → 30 s).
 * Returns a cleanup function that stops reconnection.
 */
export function connectSSE(onEvent: (event: WorkbenchEvent) => void): () => void {
  const base = getBaseUrl();
  const url = `${base}/api/events`;
  let retryDelay = INITIAL_RETRY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let source: EventSource | null = null;
  let disposed = false;

  function connect() {
    if (disposed) return;
    source = new EventSource(url);
    logger.info('sse', 'connected', { url });

    source.onopen = () => {
      retryDelay = INITIAL_RETRY_MS;       // reset backoff on success
    };

    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WorkbenchEvent;
        logger.debug('sse', 'event', { type: event.type });
        onEvent(event);
      } catch {
        logger.warn('sse', 'parse_error', { data: String(e.data).slice(0, 200) });
      }
    };

    source.onerror = () => {
      logger.warn('sse', 'connection_error', { retryIn: retryDelay });
      source?.close();
      source = null;
      if (!disposed) {
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
          connect();
        }, retryDelay);
      }
    };
  }

  connect();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
    source = null;
    logger.info('sse', 'disconnected');
  };
}
