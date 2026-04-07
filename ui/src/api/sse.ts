import type { WorkbenchEvent } from '../types';

/** Detect backend URL — Vite proxy in dev, direct in Tauri. */
function getBaseUrl(): string {
  // In Tauri (served from tauri://localhost), connect directly to backend
  if (window.location.protocol === 'tauri:' || window.location.protocol === 'https:' && window.location.hostname === 'tauri.localhost') {
    return 'http://127.0.0.1:3220';
  }
  // In dev mode (Vite), use relative path (Vite proxy handles /api)
  return '';
}

/**
 * Connect to the SSE event stream. Returns a cleanup function.
 */
export function connectSSE(onEvent: (event: WorkbenchEvent) => void): () => void {
  const base = getBaseUrl();
  const source = new EventSource(`${base}/api/events`);

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as WorkbenchEvent;
      onEvent(event);
    } catch {
      console.warn('[SSE] Failed to parse event:', e.data);
    }
  };

  source.onerror = () => {
    console.warn('[SSE] Connection error, will auto-reconnect');
  };

  return () => source.close();
}
