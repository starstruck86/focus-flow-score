/**
 * Crash Sentinel — global runtime error capture for the entire app.
 *
 * Captures:
 * - unhandledrejection (promise rejections)
 * - window.onerror (uncaught exceptions)
 * - breadcrumbs (last N user actions / route changes / async ops)
 * - session context at crash time
 *
 * Persists crash events to localStorage for post-mortem inspection
 * and flushes to the error_logs table when possible.
 */

import { normalizeError, recordError, generateTraceId } from './appError';

// ── Breadcrumb ring buffer ─────────────────────────────────────────

export interface Breadcrumb {
  ts: number;
  type: 'click' | 'route' | 'fetch' | 'error' | 'state' | 'visibility' | 'audio' | 'custom';
  label: string;
  data?: Record<string, unknown>;
}

const MAX_BREADCRUMBS = 40;
const _breadcrumbs: Breadcrumb[] = [];

export function addBreadcrumb(type: Breadcrumb['type'], label: string, data?: Record<string, unknown>): void {
  _breadcrumbs.push({ ts: Date.now(), type, label, data });
  if (_breadcrumbs.length > MAX_BREADCRUMBS) _breadcrumbs.shift();
}

export function getBreadcrumbs(): ReadonlyArray<Breadcrumb> {
  return _breadcrumbs;
}

// ── Crash event model ──────────────────────────────────────────────

export interface CrashEvent {
  id: string;
  timestamp: number;
  type: 'unhandled_rejection' | 'uncaught_error' | 'error_boundary';
  message: string;
  stack: string | null;
  route: string;
  breadcrumbs: Breadcrumb[];
  sessionContext: SessionContext;
}

export interface SessionContext {
  route: string;
  sessionDurationMs: number;
  activeFeature: string | null;
  audioPlaying: boolean;
  tabVisible: boolean;
  memoryMB: number | null;
  activeTimers: number;
  activeListeners: number;
  dojoSessionActive: boolean;
  recoveryInProgress: boolean;
  ownershipConflict: boolean;
}

// ── Session context providers (registered by features) ─────────────

type ContextProvider = () => Partial<SessionContext>;
const _contextProviders: ContextProvider[] = [];

export function registerContextProvider(fn: ContextProvider): () => void {
  _contextProviders.push(fn);
  return () => {
    const idx = _contextProviders.indexOf(fn);
    if (idx >= 0) _contextProviders.splice(idx, 1);
  };
}

function gatherContext(): SessionContext {
  const base: SessionContext = {
    route: window.location.pathname,
    sessionDurationMs: Date.now() - _sessionStart,
    activeFeature: null,
    audioPlaying: false,
    tabVisible: document.visibilityState === 'visible',
    memoryMB: getMemoryMB(),
    activeTimers: _trackedTimers.size,
    activeListeners: _trackedListeners,
    dojoSessionActive: false,
    recoveryInProgress: false,
    ownershipConflict: false,
  };
  for (const provider of _contextProviders) {
    try {
      Object.assign(base, provider());
    } catch { /* ignore broken providers */ }
  }
  return base;
}

function getMemoryMB(): number | null {
  try {
    const mem = (performance as any).memory;
    if (mem) return Math.round(mem.usedJSHeapSize / 1024 / 1024);
  } catch { /* not available */ }
  return null;
}

// ── Crash store (localStorage) ─────────────────────────────────────

const CRASH_STORE_KEY = 'app_crash_events';
const MAX_STORED_CRASHES = 20;

function persistCrash(event: CrashEvent): void {
  try {
    const raw = localStorage.getItem(CRASH_STORE_KEY);
    const existing: CrashEvent[] = raw ? JSON.parse(raw) : [];
    existing.push(event);
    while (existing.length > MAX_STORED_CRASHES) existing.shift();
    localStorage.setItem(CRASH_STORE_KEY, JSON.stringify(existing));
  } catch { /* localStorage full or unavailable */ }
}

export function getStoredCrashes(): CrashEvent[] {
  try {
    const raw = localStorage.getItem(CRASH_STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearStoredCrashes(): void {
  try { localStorage.removeItem(CRASH_STORE_KEY); } catch { /* noop */ }
}

// ── Resource leak tracking ─────────────────────────────────────────

const _trackedTimers = new Set<number | ReturnType<typeof setInterval>>();
let _trackedListeners = 0;

export function trackTimer(id: number | ReturnType<typeof setInterval>): void {
  _trackedTimers.add(id);
}

export function untrackTimer(id: number | ReturnType<typeof setInterval>): void {
  _trackedTimers.delete(id);
}

export function trackListenerAdd(): void { _trackedListeners++; }
export function trackListenerRemove(): void { _trackedListeners = Math.max(0, _trackedListeners - 1); }

export function getLeakMetrics() {
  return {
    activeTimers: _trackedTimers.size,
    activeListeners: _trackedListeners,
    memoryMB: getMemoryMB(),
  };
}

// ── Telemetry counters ─────────────────────────────────────────────

export interface ReliabilityTelemetry {
  crashCount: number;
  recoverableErrorCount: number;
  fatalErrorCount: number;
  sessionStartMs: number;
  supabaseFailures: number;
  audioFailures: number;
  audioDegradations: number;
  refreshRecoveries: number;
  ownershipConflicts: number;
  retries: number;
}

const _telemetry: ReliabilityTelemetry = {
  crashCount: 0,
  recoverableErrorCount: 0,
  fatalErrorCount: 0,
  sessionStartMs: Date.now(),
  supabaseFailures: 0,
  audioFailures: 0,
  audioDegradations: 0,
  refreshRecoveries: 0,
  ownershipConflicts: 0,
  retries: 0,
};

export function getTelemetry(): Readonly<ReliabilityTelemetry> {
  return { ..._telemetry };
}

export function incrementTelemetry(key: keyof Omit<ReliabilityTelemetry, 'sessionStartMs'>): void {
  _telemetry[key]++;
}

// ── Initialization ─────────────────────────────────────────────────

const _sessionStart = Date.now();
let _initialized = false;

export function initCrashSentinel(): void {
  if (_initialized) return;
  _initialized = true;

  // ── Unhandled promise rejections ──
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? 'Unknown rejection');
    const stack = reason instanceof Error ? reason.stack ?? null : null;

    _telemetry.crashCount++;

    const crash: CrashEvent = {
      id: generateTraceId(),
      timestamp: Date.now(),
      type: 'unhandled_rejection',
      message,
      stack,
      route: window.location.pathname,
      breadcrumbs: [..._breadcrumbs],
      sessionContext: gatherContext(),
    };

    persistCrash(crash);
    recordError(normalizeError({
      error: reason,
      source: 'frontend',
      componentName: 'CrashSentinel',
      route: window.location.pathname,
      metadata: {
        crashType: 'unhandled_rejection',
        breadcrumbCount: _breadcrumbs.length,
        sessionDurationMs: Date.now() - _sessionStart,
      },
    }));

    console.error('[CrashSentinel] Unhandled rejection:', message);
  });

  // ── Uncaught errors ──
  window.addEventListener('error', (event) => {
    // Ignore script loading errors (these are usually CDN/network issues)
    if (!event.error) return;

    const error = event.error;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? null : null;

    _telemetry.crashCount++;

    const crash: CrashEvent = {
      id: generateTraceId(),
      timestamp: Date.now(),
      type: 'uncaught_error',
      message,
      stack,
      route: window.location.pathname,
      breadcrumbs: [..._breadcrumbs],
      sessionContext: gatherContext(),
    };

    persistCrash(crash);
    recordError(normalizeError({
      error,
      source: 'frontend',
      componentName: 'CrashSentinel',
      route: window.location.pathname,
      metadata: {
        crashType: 'uncaught_error',
        breadcrumbCount: _breadcrumbs.length,
        sessionDurationMs: Date.now() - _sessionStart,
      },
    }));

    console.error('[CrashSentinel] Uncaught error:', message);
  });

  // ── Click breadcrumbs ──
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const label = target.tagName + (target.textContent?.slice(0, 30) ?? '');
    addBreadcrumb('click', label);
  }, { passive: true, capture: true });

  // ── Visibility breadcrumbs ──
  document.addEventListener('visibilitychange', () => {
    addBreadcrumb('visibility', document.visibilityState);
  });

  // ── Route breadcrumbs (polled) — track interval for cleanup ──
  let _lastRoute = window.location.pathname;
  const routeInterval = setInterval(() => {
    if (window.location.pathname !== _lastRoute) {
      addBreadcrumb('route', `${_lastRoute} → ${window.location.pathname}`);
      _lastRoute = window.location.pathname;
    }
  }, 1000);
  trackTimer(routeInterval);

  // ── Fetch error breadcrumbs (idempotent — only patch once) ──
  if (!(window.fetch as any).__crashSentinelPatched) {
    const originalFetch = window.fetch;
    const patchedFetch = async function(this: any, ...args: Parameters<typeof fetch>) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url ?? '';
      const shortUrl = url.split('?')[0].split('/').slice(-2).join('/');
      try {
        const response = await originalFetch.apply(this, args);
        if (!response.ok && response.status >= 500) {
          addBreadcrumb('fetch', `${response.status} ${shortUrl}`);
          if (shortUrl.includes('functions/v1')) {
            _telemetry.supabaseFailures++;
          }
        }
        return response;
      } catch (err) {
        addBreadcrumb('fetch', `FAIL ${shortUrl}: ${(err as Error).message?.slice(0, 50)}`);
        if (shortUrl.includes('functions/v1')) {
          _telemetry.supabaseFailures++;
        }
        throw err;
      }
    };
    (patchedFetch as any).__crashSentinelPatched = true;
    window.fetch = patchedFetch as typeof fetch;
  }

  console.info('[CrashSentinel] Initialized — tracking errors, rejections, and breadcrumbs');
}
