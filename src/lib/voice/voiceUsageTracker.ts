/**
 * Voice Usage Tracker — Local-first session cost tracking.
 *
 * All credit values are ESTIMATES (heuristic, not calibrated against
 * ElevenLabs billing). Labeled with "~" prefix in summaries.
 *
 * All tracking is lightweight and synchronous — never blocks the hot path.
 */

// ── Credit Cost Estimates ──────────────────────────────────────────
// Approximate multipliers — not calibrated against actual ElevenLabs billing.

const TTS_CREDITS_PER_CHAR_APPROX = 1;
const STT_CREDITS_PER_SECOND_APPROX = 10;

// ── Session State ──────────────────────────────────────────────────

export interface VoiceSessionUsage {
  sessionId: string;
  startedAt: number;

  // TTS
  ttsCalls: number;
  ttsCharacters: number;
  ttsCacheHitsMemory: number;
  ttsCacheHitsPersistent: number;
  ttsCacheMisses: number;

  // STT
  sttCalls: number;
  sttAudioSeconds: number;
  sttRetries: number;
  sttMalformed: number;

  // Totals (approximate)
  estimatedCreditsApprox: number;

  // Top repeated utterances (for waste detection)
  utteranceCounts: Map<string, number>;
}

let currentSession: VoiceSessionUsage | null = null;

export function startUsageSession(sessionId?: string): VoiceSessionUsage {
  currentSession = {
    sessionId: sessionId ?? crypto.randomUUID(),
    startedAt: Date.now(),
    ttsCalls: 0,
    ttsCharacters: 0,
    ttsCacheHitsMemory: 0,
    ttsCacheHitsPersistent: 0,
    ttsCacheMisses: 0,
    sttCalls: 0,
    sttAudioSeconds: 0,
    sttRetries: 0,
    sttMalformed: 0,
    estimatedCreditsApprox: 0,
    utteranceCounts: new Map(),
  };
  return currentSession;
}

export function getUsageSession(): VoiceSessionUsage | null {
  return currentSession;
}

export function endUsageSession(): VoiceSessionUsage | null {
  const session = currentSession;
  currentSession = null;
  return session;
}

// ── TTS Tracking ───────────────────────────────────────────────────

export function trackTtsCall(text: string, cacheSource: 'memory' | 'persistent' | 'miss'): void {
  if (!currentSession) return;

  if (cacheSource === 'memory') {
    currentSession.ttsCacheHitsMemory++;
  } else if (cacheSource === 'persistent') {
    currentSession.ttsCacheHitsPersistent++;
  } else {
    currentSession.ttsCacheMisses++;
    currentSession.ttsCalls++;
    currentSession.ttsCharacters += text.length;
    currentSession.estimatedCreditsApprox += text.length * TTS_CREDITS_PER_CHAR_APPROX;
  }

  const short = text.slice(0, 80);
  currentSession.utteranceCounts.set(short, (currentSession.utteranceCounts.get(short) ?? 0) + 1);
}

// ── STT Tracking ───────────────────────────────────────────────────

/**
 * Track an STT call. Pass actual recording duration in seconds
 * from recorder timing metadata, NOT estimated from blob size.
 */
export function trackSttCall(actualDurationSeconds: number): void {
  if (!currentSession) return;
  currentSession.sttCalls++;
  currentSession.sttAudioSeconds += actualDurationSeconds;
  currentSession.estimatedCreditsApprox += actualDurationSeconds * STT_CREDITS_PER_SECOND_APPROX;
}

export function trackSttRetry(): void {
  if (!currentSession) return;
  currentSession.sttRetries++;
}

export function trackSttMalformed(): void {
  if (!currentSession) return;
  currentSession.sttMalformed++;
}

// ── Thresholds & Warnings ──────────────────────────────────────────

const WARNING_CREDITS = 5000;
const CRITICAL_CREDITS = 10000;

export type UsageLevel = 'normal' | 'warning' | 'critical';

export function getUsageLevel(): UsageLevel {
  if (!currentSession) return 'normal';
  if (currentSession.estimatedCreditsApprox >= CRITICAL_CREDITS) return 'critical';
  if (currentSession.estimatedCreditsApprox >= WARNING_CREDITS) return 'warning';
  return 'normal';
}

// ── Summary for Debug Panel ────────────────────────────────────────

export interface UsageSummary {
  sessionDurationMs: number;
  ttsCalls: number;
  ttsCharacters: number;
  cacheHitRate: number;
  sttCalls: number;
  sttAudioSeconds: number;
  sttRetries: number;
  sttMalformed: number;
  /** Approximate — not calibrated against ElevenLabs billing */
  estimatedCreditsApprox: number;
  usageLevel: UsageLevel;
  topRepeatedUtterances: Array<{ text: string; count: number }>;
}

export function getUsageSummary(): UsageSummary | null {
  if (!currentSession) return null;

  const totalTtsLookups = currentSession.ttsCacheHitsMemory +
    currentSession.ttsCacheHitsPersistent + currentSession.ttsCacheMisses;
  const cacheHitRate = totalTtsLookups > 0
    ? (currentSession.ttsCacheHitsMemory + currentSession.ttsCacheHitsPersistent) / totalTtsLookups
    : 0;

  const topRepeated = Array.from(currentSession.utteranceCounts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  return {
    sessionDurationMs: Date.now() - currentSession.startedAt,
    ttsCalls: currentSession.ttsCalls,
    ttsCharacters: currentSession.ttsCharacters,
    cacheHitRate,
    sttCalls: currentSession.sttCalls,
    sttAudioSeconds: currentSession.sttAudioSeconds,
    sttRetries: currentSession.sttRetries,
    sttMalformed: currentSession.sttMalformed,
    estimatedCreditsApprox: currentSession.estimatedCreditsApprox,
    usageLevel: getUsageLevel(),
    topRepeatedUtterances: topRepeated,
  };
}
