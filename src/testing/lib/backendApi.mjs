import { DEFAULT_SERVER_URL } from './paths.mjs';

export function parseCliArgs(args = process.argv.slice(2)) {
  const positionals = [];
  const flags = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags.set(token, true);
      continue;
    }

    flags.set(token, next);
    index += 1;
  }

  return { positionals, flags };
}

export function getServerUrl(flags) {
  return String(flags.get('--server-url') || flags.get('--server') || DEFAULT_SERVER_URL);
}

export async function requestJson(method, serverUrl, path, body) {
  const response = await fetch(new URL(path, serverUrl), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`${method} ${path} failed: ${response.status} ${detail}`);
  }

  return payload;
}

export const getJson = (serverUrl, path) => requestJson('GET', serverUrl, path);
export const postJson = (serverUrl, path, body) => requestJson('POST', serverUrl, path, body);
export const putJson = (serverUrl, path, body) => requestJson('PUT', serverUrl, path, body);
export const deleteJson = (serverUrl, path) => requestJson('DELETE', serverUrl, path);

export function formatElapsed(startMs) {
  const elapsed = Math.max(0, Math.round((Date.now() - startMs) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
