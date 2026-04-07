import type { IncomingMessage, ServerResponse } from 'node:http';

/* ---- Constants ---- */

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024; // 200 MB (base64 files are larger)

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm',   // video
  '.mp3', '.wav', '.ogg', '.m4a', '.flac',   // audio
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', // image
  '.txt', '.srt', '.vtt', '.json',           // text
]);

const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB decoded

/* ---- Response helpers ---- */

export function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/* ---- Body reading with size limit ---- */

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

export async function readBody(req: IncomingMessage, maxSize = MAX_BODY_SIZE): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += (chunk as Buffer).length;
    if (totalSize > maxSize) throw new BodyTooLargeError(maxSize);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

/* ---- Safe JSON parse (readBody + JSON.parse wrapped) ---- */

export async function parseJsonBody<T = unknown>(req: IncomingMessage, maxSize?: number): Promise<T> {
  const raw = await readBody(req, maxSize);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new SyntaxError('Invalid JSON in request body');
  }
}

/* ---- Upload helpers ---- */

export { MAX_UPLOAD_SIZE, ALLOWED_UPLOAD_EXTENSIONS, MAX_SINGLE_FILE_BYTES };

/* ---- Route types ---- */

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  match: RegExpExecArray,
) => Promise<void> | void;

export interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}
