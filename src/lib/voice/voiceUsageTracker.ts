/**
 * Voice Usage Tracker — Local-first session cost tracking.
 *
 * Tracks per-session:
 * - TTS call count & characters
 * - STT call count & audio seconds
 * - Cache hit rates
 * - Retry counts
 * - Estimated credits used
 *
 * All tracking is lightweight and synchronous — never blocks the hot path.
 */

// ── Credit Cost Estimates ──────────────────────────────────────────
// ElevenLabs charges by character for TTS, and by second for STT.
// These are approximate multipliers.

const TTS_CREDITS_PER_CHAR = 1; // 1 credit per character (approximate)
const STT_CREDITS_PER_SECOND = 10; // ~10 credits per second of audio

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

  // Totals
  estimatedCredits: number;

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
    estimatedCredits: 0,
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
    currentSession.estimatedCredits += text.length * TTS_CREDITS_PER_CHAR;
  }

  // Track utterance frequency
  const short = text.slice(0, 80);
  currentSession.utteranceCounts.set(short, (currentSession.utteranceCounts.get(short) ?? 0) + 1);
}

// ── STT Tracking ───────────────────────────────────────────────────

export function trackSttCall(audioSeconds: number): void {
  if (!currentSession) return;
  currentSession.sttCalls++;
  currentSession.sttAudioSeconds += audioSeconds;
  currentSession.estimatedCredits += audioSeconds * STT_CREDITS_PER_SECOND;
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
  if (currentSession.estimatedCredits >= CRITICAL_CREDITS) return 'critical';
  if (currentSession.estimatedCredits >= WARNING_CREDITS) return 'warning';
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
  estimatedCredits: number;
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
    estimatedCredits: currentSession.estimatedCredits,
    usageLevel: getUsageLevel(),
    topRepeatedUtterances: topRepeated,
  };
}
