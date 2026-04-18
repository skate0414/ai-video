/* ------------------------------------------------------------------ */
/*  Structured Logger — unified logging with level control             */
/* ------------------------------------------------------------------ */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

/** Truncate large strings to avoid leaking full prompts in production. */
function truncate(val: unknown, maxLen = 500): unknown {
  if (typeof val === 'string' && val.length > maxLen) {
    return val.slice(0, maxLen) + `...[truncated ${val.length - maxLen} chars]`;
  }
  return val;
}

function formatMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = truncate(v);
  }
  return out;
}

export interface Logger {
  debug(action: string, meta?: Record<string, unknown>): void;
  info(action: string, meta?: Record<string, unknown>): void;
  warn(action: string, meta?: Record<string, unknown>): void;
  error(action: string, err?: Error | unknown, meta?: Record<string, unknown>): void;
}

/**
 * Create a structured logger scoped to a module.
 *
 * Output format (one JSON line per log):
 * ```json
 * {"ts":"2026-04-10T12:00:00.000Z","level":"info","module":"TTS","action":"generating","projectId":"abc"}
 * ```
 *
 * Control log level via `LOG_LEVEL` env variable (default: 'info').
 */
export function createLogger(module: string): Logger {
  function emit(level: LogLevel, action: string, meta?: Record<string, unknown>, err?: Error | unknown): void {
    if (!shouldLog(level)) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      module,
      action,
    };
    const formatted = formatMeta(meta);
    if (formatted) Object.assign(entry, formatted);
    if (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.stack && level === 'error') {
        entry.stack = err.stack;
      }
    }

    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  return {
    debug(action, meta?) { emit('debug', action, meta); },
    info(action, meta?) { emit('info', action, meta); },
    warn(action, meta?) { emit('warn', action, meta); },
    error(action, err?, meta?) { emit('error', action, meta, err); },
  };
}
