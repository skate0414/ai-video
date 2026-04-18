/* ================================================================== */
/*  Centralized Frontend Logger                                        */
/*  Structured logging with ring buffer, dev-mode console output       */
/* ================================================================== */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'api' | 'user' | 'sse' | 'navigation' | 'error' | 'storage';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  action: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
}

const MAX_ENTRIES = 500;
const IS_DEV = import.meta.env.DEV;

const history: LogEntry[] = [];

function push(entry: LogEntry) {
  if (history.length >= MAX_ENTRIES) history.shift();
  history.push(entry);

  if (IS_DEV) {
    const tag = `[${entry.category}] ${entry.action}`;
    const args: unknown[] = [];
    if (entry.detail) args.push(entry.detail);
    if (entry.durationMs != null) args.push(`${entry.durationMs}ms`);

    switch (entry.level) {
      case 'debug': console.debug(tag, ...args); break;
      case 'info':  console.info(tag, ...args);  break;
      case 'warn':  console.warn(tag, ...args);  break;
      case 'error': console.error(tag, ...args); break;
    }
  }
}

function log(level: LogLevel, category: LogCategory, action: string, detail?: Record<string, unknown>) {
  push({ timestamp: new Date().toISOString(), level, category, action, detail });
}

function time(category: LogCategory, action: string) {
  const start = performance.now();
  return {
    end(detail?: Record<string, unknown>) {
      const durationMs = Math.round(performance.now() - start);
      push({ timestamp: new Date().toISOString(), level: 'info', category, action, detail, durationMs });
      return durationMs;
    },
    fail(detail?: Record<string, unknown>) {
      const durationMs = Math.round(performance.now() - start);
      push({ timestamp: new Date().toISOString(), level: 'error', category, action, detail, durationMs });
      return durationMs;
    },
  };
}

export const logger = {
  debug: (category: LogCategory, action: string, detail?: Record<string, unknown>) => log('debug', category, action, detail),
  info:  (category: LogCategory, action: string, detail?: Record<string, unknown>) => log('info', category, action, detail),
  warn:  (category: LogCategory, action: string, detail?: Record<string, unknown>) => log('warn', category, action, detail),
  error: (category: LogCategory, action: string, detail?: Record<string, unknown>) => log('error', category, action, detail),
  time,
  getHistory: (): readonly LogEntry[] => history,
};
