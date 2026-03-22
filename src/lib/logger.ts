/**
 * Structured logger replacing scattered console.log calls.
 * Logs are formatted as JSON-ish lines with level, tag, and optional traceId.
 * In production these could be shipped to an external service; for now they
 * go to the console and feed the diagnostics store.
 */

import { normalizeError, recordError, generateTraceId, type AppError, type ErrorSource } from './appError';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  tag: string;
  message: string;
  traceId?: string;
  data?: unknown;
  ts: number;
}

const IS_DEV = import.meta.env.DEV;

// Minimum level: 'debug' in dev, 'info' in prod
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = IS_DEV ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function emit(entry: LogEntry) {
  if (!shouldLog(entry.level)) return;

  const prefix = `[${entry.tag}]`;
  const traceStr = entry.traceId ? ` (${entry.traceId})` : '';

  switch (entry.level) {
    case 'debug':
      console.debug(prefix, entry.message + traceStr, entry.data ?? '');
      break;
    case 'info':
      console.info(prefix, entry.message + traceStr, entry.data ?? '');
      break;
    case 'warn':
      console.warn(prefix, entry.message + traceStr, entry.data ?? '');
      break;
    case 'error':
      console.error(prefix, entry.message + traceStr, entry.data ?? '');
      break;
  }
}

/** Create a scoped logger for a specific tag (module/component name) */
export function createLogger(tag: string) {
  return {
    debug(message: string, data?: unknown, traceId?: string) {
      emit({ level: 'debug', tag, message, data, traceId, ts: Date.now() });
    },
    info(message: string, data?: unknown, traceId?: string) {
      emit({ level: 'info', tag, message, data, traceId, ts: Date.now() });
    },
    warn(message: string, data?: unknown, traceId?: string) {
      emit({ level: 'warn', tag, message, data, traceId, ts: Date.now() });
    },
    error(message: string, data?: unknown, traceId?: string) {
      emit({ level: 'error', tag, message, data, traceId, ts: Date.now() });
    },
    /** Normalize an unknown error, record it, and log it */
    captureError(
      error: unknown,
      opts?: { functionName?: string; componentName?: string; source?: ErrorSource; traceId?: string; metadata?: Record<string, unknown> },
    ): AppError {
      const traceId = opts?.traceId ?? generateTraceId();
      const appError = normalizeError({
        error,
        source: opts?.source ?? 'frontend',
        functionName: opts?.functionName ?? null,
        componentName: opts?.componentName ?? tag,
        traceId,
        metadata: opts?.metadata,
      });
      recordError(appError);
      emit({ level: 'error', tag, message: `[${appError.category}] ${appError.rawMessage}`, traceId, ts: Date.now() });
      return appError;
    },
  };
}

/** Convenience: global logger for one-off usage */
export const log = createLogger('App');
