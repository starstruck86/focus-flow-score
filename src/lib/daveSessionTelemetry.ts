/**
 * Dave Session Telemetry — Real-world audio session tracking.
 *
 * Captures in-car usability metrics for validation:
 * - Completion rates by mode
 * - Replay/interruption command frequency
 * - Silence retries and recognition failures
 * - Time to first response
 * - Retry loop frequency
 *
 * Data is localStorage-persisted, privacy-safe, never leaves the browser.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveSessionTelemetry');
const STORAGE_KEY = 'dave-session-telemetry';
const MAX_RECORDS = 300;

export type SessionType = 'learn' | 'dojo';
export type SessionMode = 'compressed' | 'full';
export type DrivingMode = 'visual' | 'audio-first' | 'driving';

export interface InterruptionCounts {
  repeat: number;
  pause: number;
  skip: number;
  stop: number;
  resume: number;
  retry: number;
  go: number;
  done: number;
}

export interface AudioSessionRecord {
  id: string;
  timestamp: number;
  sessionType: SessionType;
  mode: SessionMode;
  drivingMode: DrivingMode;
  /** Was the session completed without touching the screen? */
  completedHandsFree: boolean;
  /** Did the session complete at all (vs abort)? */
  completed: boolean;
  /** Number of replay commands used */
  replayCount: number;
  /** Number of targeted replays (repeat objection, etc.) */
  targetedReplayCount: number;
  /** Number of "I didn't catch that" silence retries */
  silenceRetries: number;
  /** Time from session start to first user speech (ms) */
  timeToFirstResponseMs: number;
  /** Number of retry loops triggered */
  retryLoopCount: number;
  /** Interruption command frequency */
  interruptions: InterruptionCounts;
  /** Total session duration (ms) */
  durationMs: number;
  /** Whether Learn auto-handed off to Dojo */
  handedOffToDojo: boolean;
  /** Final score (if applicable) */
  finalScore: number | null;
}

// ── Tracker (mutable, lives for one session) ───────────────────

export class SessionTelemetryTracker {
  private startTime = Date.now();
  private firstResponseTime: number | null = null;
  private record: Omit<AudioSessionRecord, 'id' | 'timestamp' | 'durationMs' | 'timeToFirstResponseMs'>;

  constructor(
    sessionType: SessionType,
    mode: SessionMode,
    drivingMode: DrivingMode,
  ) {
    this.record = {
      sessionType,
      mode,
      drivingMode,
      completedHandsFree: true,
      completed: false,
      replayCount: 0,
      targetedReplayCount: 0,
      silenceRetries: 0,
      retryLoopCount: 0,
      interruptions: { repeat: 0, pause: 0, skip: 0, stop: 0, resume: 0, retry: 0, go: 0, done: 0 },
      handedOffToDojo: false,
      finalScore: null,
    };
  }

  trackInterruption(command: string): void {
    if (command in this.record.interruptions) {
      this.record.interruptions[command as keyof InterruptionCounts]++;
    }
    if (command === 'repeat') this.record.replayCount++;
  }

  trackTargetedReplay(): void {
    this.record.targetedReplayCount++;
  }

  trackSilenceRetry(): void {
    this.record.silenceRetries++;
  }

  trackFirstResponse(): void {
    if (!this.firstResponseTime) {
      this.firstResponseTime = Date.now();
    }
  }

  trackRetryLoop(): void {
    this.record.retryLoopCount++;
  }

  trackScreenTouch(): void {
    this.record.completedHandsFree = false;
  }

  setHandoff(v: boolean): void {
    this.record.handedOffToDojo = v;
  }

  setFinalScore(score: number | null): void {
    this.record.finalScore = score;
  }

  /** Finalize and persist */
  finalize(completed: boolean): AudioSessionRecord {
    const now = Date.now();
    const final: AudioSessionRecord = {
      ...this.record,
      id: crypto.randomUUID(),
      timestamp: now,
      completed,
      durationMs: now - this.startTime,
      timeToFirstResponseMs: this.firstResponseTime
        ? this.firstResponseTime - this.startTime
        : -1,
    };
    persistRecord(final);
    logger.info('Session telemetry recorded', {
      type: final.sessionType,
      mode: final.mode,
      completed: final.completed,
      handsFree: final.completedHandsFree,
      duration: final.durationMs,
    });
    return final;
  }
}

// ── Persistence ────────────────────────────────────────────────

function persistRecord(record: AudioSessionRecord): void {
  try {
    const existing: AudioSessionRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    existing.push(record);
    if (existing.length > MAX_RECORDS) existing.splice(0, existing.length - MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch { /* noop */ }
}

// ── Aggregated Metrics ─────────────────────────────────────────

export interface TelemetryAggregates {
  totalSessions: number;
  completionRate: number;
  handsFreeRate: number;
  avgReplayCommands: number;
  avgSilenceRetries: number;
  avgTimeToFirstResponseMs: number;
  avgRetryLoops: number;
  avgDurationMs: number;
  interruptionTotals: InterruptionCounts;
  handoffRate: number;
  byType: Record<string, { count: number; completionRate: number }>;
  byDrivingMode: Record<string, { count: number; completionRate: number }>;
}

export function getSessionTelemetry(windowMs = 7 * 24 * 3600 * 1000): TelemetryAggregates {
  const cutoff = Date.now() - windowMs;
  let records: AudioSessionRecord[];
  try {
    records = (JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as AudioSessionRecord[])
      .filter(r => r.timestamp > cutoff);
  } catch { records = []; }

  if (!records.length) {
    return {
      totalSessions: 0, completionRate: 0, handsFreeRate: 0,
      avgReplayCommands: 0, avgSilenceRetries: 0, avgTimeToFirstResponseMs: 0,
      avgRetryLoops: 0, avgDurationMs: 0,
      interruptionTotals: { repeat: 0, pause: 0, skip: 0, stop: 0, resume: 0, retry: 0, go: 0, done: 0 },
      handoffRate: 0, byType: {}, byDrivingMode: {},
    };
  }

  const n = records.length;
  const completed = records.filter(r => r.completed).length;
  const handsFree = records.filter(r => r.completedHandsFree).length;
  const handoffs = records.filter(r => r.handedOffToDojo).length;

  const totals: InterruptionCounts = { repeat: 0, pause: 0, skip: 0, stop: 0, resume: 0, retry: 0, go: 0, done: 0 };
  for (const r of records) {
    for (const k of Object.keys(totals) as (keyof InterruptionCounts)[]) {
      totals[k] += r.interruptions[k] ?? 0;
    }
  }

  const group = (key: 'sessionType' | 'drivingMode') => {
    const map: Record<string, { count: number; completionRate: number }> = {};
    for (const r of records) {
      const v = r[key];
      if (!map[v]) map[v] = { count: 0, completionRate: 0 };
      map[v].count++;
    }
    for (const k of Object.keys(map)) {
      const sub = records.filter(r => r[key] === k);
      map[k].completionRate = sub.filter(r => r.completed).length / sub.length;
    }
    return map;
  };

  const validTTFR = records.filter(r => r.timeToFirstResponseMs > 0);

  return {
    totalSessions: n,
    completionRate: completed / n,
    handsFreeRate: handsFree / n,
    avgReplayCommands: records.reduce((s, r) => s + r.replayCount, 0) / n,
    avgSilenceRetries: records.reduce((s, r) => s + r.silenceRetries, 0) / n,
    avgTimeToFirstResponseMs: validTTFR.length
      ? Math.round(validTTFR.reduce((s, r) => s + r.timeToFirstResponseMs, 0) / validTTFR.length)
      : 0,
    avgRetryLoops: records.reduce((s, r) => s + r.retryLoopCount, 0) / n,
    avgDurationMs: Math.round(records.reduce((s, r) => s + r.durationMs, 0) / n),
    interruptionTotals: totals,
    handoffRate: handoffs / n,
    byType: group('sessionType'),
    byDrivingMode: group('drivingMode'),
  };
}

/** Expose for console debugging */
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__daveTelemetry = {
    getMetrics: getSessionTelemetry,
    getRaw: () => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
    },
  };
}
