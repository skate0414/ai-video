/**
 * session-manager.ts — Per-account session isolation via Electron partitions.
 *
 * Each AI provider account gets its own Electron session partition so that
 * cookies, localStorage, and cache are fully isolated — just like separate
 * Chrome profiles in the current Playwright-based architecture.
 *
 * Partition names follow the pattern: `persist:account-<accountId>`
 * The "persist:" prefix ensures sessions survive app restarts.
 */

import { session, type Session } from 'electron';

/** Stealth settings applied to every session to avoid automation detection. */
const STEALTH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

export interface ManagedSession {
  partition: string;
  session: Session;
  accountId: string;
}

const activeSessions = new Map<string, ManagedSession>();

/**
 * Get or create an isolated session for a given account.
 * Sessions are persisted to disk with the "persist:" prefix so login state
 * survives across app restarts.
 */
export function getAccountSession(accountId: string): ManagedSession {
  const existing = activeSessions.get(accountId);
  if (existing) return existing;

  const partition = `persist:account-${accountId}`;
  const sess = session.fromPartition(partition);

  // Apply stealth settings to bypass automation detection
  sess.setUserAgent(STEALTH_USER_AGENT);

  // Apply proxy if configured via environment variable
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (proxyUrl) {
    // Strip embedded credentials — auth is handled by app 'login' event
    let proxyServer = proxyUrl;
    try {
      const u = new URL(proxyUrl);
      u.username = '';
      u.password = '';
      proxyServer = u.toString().replace(/\/$/, '');
    } catch { /* use raw URL */ }
    sess.setProxy({
      proxyRules: proxyServer,
      proxyBypassRules: '127.0.0.1,localhost,<local>',
    });
  }

  // Disable WebRTC real-IP leak at the session level
  sess.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Block media (which includes WebRTC data channels) to prevent IP leak
    // Allow everything else
    callback(permission !== 'media');
  });

  // Override Client Hints headers that leak the Electron brand.
  // Google's OAuth servers inspect these to block embedded browsers.
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };

    // Sec-Ch-Ua: brand list (primary detection signal)
    for (const key of Object.keys(headers)) {
      const lk = key.toLowerCase();
      if (lk === 'sec-ch-ua') {
        headers[key] = '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"';
      }
      if (lk === 'sec-ch-ua-full-version-list') {
        headers[key] = '"Chromium";v="136.0.0.0", "Google Chrome";v="136.0.0.0", "Not.A/Brand";v="99.0.0.0"';
      }
    }

    callback({ requestHeaders: headers });
  });

  const managed: ManagedSession = { partition, session: sess, accountId };
  activeSessions.set(accountId, managed);
  return managed;
}

/**
 * Get or create a default session for the app UI tab.
 * This uses a separate partition from account sessions.
 */
export function getAppSession(): Session {
  return session.fromPartition('persist:app-ui');
}

/**
 * Clear session data for a specific account (logout).
 */
export async function clearAccountSession(accountId: string): Promise<void> {
  const managed = activeSessions.get(accountId);
  if (!managed) return;

  await managed.session.clearStorageData();
  await managed.session.clearCache();
  activeSessions.delete(accountId);
}

/**
 * List all active account session IDs.
 */
export function listActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys());
}
