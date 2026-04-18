import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename } from 'node:path';

/* ---- Constants ---- */

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_UPLOAD_SIZE = 800 * 1024 * 1024; // 800 MB (base64 files are larger)

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm',   // video
  '.mp3', '.wav', '.ogg', '.m4a', '.flac',   // audio
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', // image
  '.txt', '.srt', '.vtt', '.json',           // text
]);

const MAX_SINGLE_FILE_BYTES = 500 * 1024 * 1024; // 500 MB decoded

/* ---- Response helpers ---- */

export function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/* ---- Error sanitisation ---- */

/** Known safe error patterns whose messages are already user-facing. */
const SAFE_PATTERNS = [
  'not found', 'already running', 'already being regenerated', 'not paused',
  'is required', 'is not paused', 'Safety block', 'not started',
];

/** Sanitise internal error messages before sending to client. */
export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (SAFE_PATTERNS.some(p => raw.toLowerCase().includes(p.toLowerCase()))) return raw;
  const firstLine = raw.split('\n')[0];
  if (firstLine.length > 200) return '操作失败，请稍后重试';
  return firstLine;
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

/* ---- Multipart form-data parser (single file field) ---- */

export interface MultipartFile {
  filename: string;
  data: Buffer;
}

/**
 * Parse a single file from a multipart/form-data request.
 * Only extracts the first file field encountered.
 */
export async function parseMultipartFile(req: IncomingMessage, maxSize: number): Promise<MultipartFile> {
  const contentType = req.headers['content-type'] ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!boundaryMatch) throw new Error('Missing multipart boundary');
  const boundary = boundaryMatch[1] ?? boundaryMatch[2];
  const delimiter = Buffer.from(`--${boundary}`);

  const raw = await readBodyBuffer(req, maxSize);

  // Split by boundary
  const parts: Buffer[] = [];
  let start = 0;
  while (true) {
    const idx = raw.indexOf(delimiter, start);
    if (idx === -1) break;
    if (start > 0) parts.push(raw.subarray(start, idx));
    start = idx + delimiter.length;
    // Skip CRLF after delimiter
    if (raw[start] === 0x0d && raw[start + 1] === 0x0a) start += 2;
  }

  for (const part of parts) {
    // Check for closing delimiter
    if (part.length < 4) continue;
    if (part[0] === 0x2d && part[1] === 0x2d) continue; // "--" closing

    // Split headers from body (double CRLF)
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headerStr = part.subarray(0, headerEnd).toString();
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (!filenameMatch) continue;

    // Body ends before trailing CRLF
    let body = part.subarray(headerEnd + 4);
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
      body = body.subarray(0, body.length - 2);
    }

    return { filename: basename(filenameMatch[1]), data: body };
  }

  throw new Error('No file found in multipart body');
}

async function readBodyBuffer(req: IncomingMessage, maxSize: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += (chunk as Buffer).length;
    if (totalSize > maxSize) throw new BodyTooLargeError(maxSize);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
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
