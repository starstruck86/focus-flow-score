/**
 * Reliability layer for AI and edge function calls.
 * Provides retry, timeout, response validation, and structured failure logging.
 */

import { createLogger } from './logger';
import type { AppError } from './appError';

const logger = createLogger('Reliability');

// ── Retry ───────────────────────────────────────────────────

export interface RetryOptions {
  /** Max number of attempts (including the initial call). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms before retrying. Doubles each attempt. Default: 1000 */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default: 8000 */
  maxDelayMs?: number;
  /** Predicate: should we retry this error? Default: checks `retryable` on AppError */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Abort signal — cancels pending retries */
  signal?: AbortSignal;
}

const DEFAULT_RETRY: Required<Omit<RetryOptions, 'signal' | 'shouldRetry'>> = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
};

/**
 * Determines whether an error is retryable by default.
 * Checks AppError.retryable, HTTP status patterns, and common network errors.
 */
export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    // AppError
    if ('retryable' in error && typeof (error as AppError).retryable === 'boolean') {
      return (error as AppError).retryable;
    }
    // Error with message
    if ('message' in error) {
      const msg = ((error as Error).message || '').toLowerCase();
      if (msg.includes('rate') || msg.includes('429')) return true;
      if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) return true;
      if (msg.includes('failed to fetch') || msg.includes('network')) return true;
      if (msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    }
  }
  return false;
}

/**
 * Execute an async function with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_RETRY.maxAttempts;
  const baseDelay = opts?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  const maxDelay = opts?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const shouldRetry = opts?.shouldRetry ?? ((err) => isRetryableError(err));

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (opts?.signal?.aborted) throw err;
      if (attempt >= maxAttempts) throw err;
      if (!shouldRetry(err, attempt)) throw err;

      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      logger.warn(`Retry ${attempt}/${maxAttempts}, waiting ${Math.round(jitter)}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, jitter);
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
  }

  throw lastError;
}

// ── Timeout ─────────────────────────────────────────────────

/**
 * Wraps a promise with a timeout. Rejects with a FUNCTION_TIMEOUT-style error.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'Operation',
): Promise<T> {
  if (timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ── Response Validation ─────────────────────────────────────

export interface ValidationRule<T> {
  /** Human-readable description of what's being checked */
  check: string;
  /** Predicate — return true if valid */
  validate: (data: T) => boolean;
  /** Severity: 'error' rejects, 'warn' logs but passes through */
  severity?: 'error' | 'warn';
}

export interface ValidationResult<T> {
  valid: boolean;
  data: T;
  warnings: string[];
  errors: string[];
  /** 0-1 completeness score based on how many checks passed */
  completeness: number;
}

/**
 * Validate an AI/edge response against a set of rules.
 * Returns a structured result with completeness scoring.
 */
export function validateResponse<T>(
  data: T,
  rules: ValidationRule<T>[],
): ValidationResult<T> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let passed = 0;

  for (const rule of rules) {
    try {
      if (rule.validate(data)) {
        passed++;
      } else {
        const msg = `Validation failed: ${rule.check}`;
        if (rule.severity === 'warn') {
          warnings.push(msg);
          passed += 0.5; // Partial credit for warnings
        } else {
          errors.push(msg);
        }
      }
    } catch {
      errors.push(`Validation threw: ${rule.check}`);
    }
  }

  const completeness = rules.length > 0 ? passed / rules.length : 1;

  return {
    valid: errors.length === 0,
    data,
    warnings,
    errors,
    completeness,
  };
}

/**
 * Shorthand: validate and throw if invalid.
 */
export function assertValid<T>(
  data: T,
  rules: ValidationRule<T>[],
  label = 'Response',
): T {
  const result = validateResponse(data, rules);
  if (!result.valid) {
    throw new Error(`${label} validation failed: ${result.errors.join('; ')}`);
  }
  if (result.warnings.length > 0) {
    logger.warn(`${label} validation warnings`, { warnings: result.warnings, completeness: result.completeness });
  }
  return data;
}

// ── Common Validators ───────────────────────────────────────

/** Check that a field exists and is not null/undefined */
export function requiredField<T>(field: keyof T & string, label?: string): ValidationRule<T> {
  return {
    check: label ?? `${field} is required`,
    validate: (data) => data[field] !== null && data[field] !== undefined,
    severity: 'error',
  };
}

/** Check that a field is a non-empty string */
export function nonEmptyString<T>(field: keyof T & string, label?: string): ValidationRule<T> {
  return {
    check: label ?? `${field} must be a non-empty string`,
    validate: (data) => typeof data[field] === 'string' && (data[field] as string).length > 0,
    severity: 'error',
  };
}

/** Check that a field is a number within a range */
export function numberInRange<T>(field: keyof T & string, min: number, max: number): ValidationRule<T> {
  return {
    check: `${field} must be between ${min} and ${max}`,
    validate: (data) => {
      const val = data[field];
      return typeof val === 'number' && val >= min && val <= max;
    },
    severity: 'warn',
  };
}

/** Check that a success flag is true */
export function successFlag<T extends { success?: boolean }>(): ValidationRule<T> {
  return {
    check: 'Response must indicate success',
    validate: (data) => data.success === true,
    severity: 'error',
  };
}
