/**
 * Dave Audio Resilience Layer
 *
 * Playback token system, audio unlock, mic fallback,
 * mode downgrade logic, and per-step telemetry.
 *
 * Architecture: text is the source of truth. Audio is an enhancement.
 * No coaching content is ever skipped because of audio/mic failure.
 *
 * Live playback resilience lives in useVoiceMode.playTTS().
 * This module provides the token system and telemetry that useVoiceMode consumes.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveAudioResilience');

// ── Delivery Mode ──────────────────────────────────────────────────

export type AudioDeliveryMode = 'full' | 'quiet' | 'text';

export function describeMode(mode: AudioDeliveryMode): { label: string; icon: string } {
  switch (mode) {
    case 'full': return { label: 'Audio + mic', icon: '🔊' };
    case 'quiet': return { label: 'Audio — typed input', icon: '🔈' };
    case 'text': return { label: 'Text only', icon: '📝' };
  }
}

// ── Coaching Step Model ────────────────────────────────────────────

export type AudioStatus = 'pending' | 'playing' | 'completed' | 'failed' | 'skipped';
export type MicStatus = 'idle' | 'requested' | 'granted' | 'denied' | 'fallback';

export interface CoachingStep {
  id: string;
  text: string;
  audioStatus: AudioStatus;
  audioUrl: string | null;
  micStatus: MicStatus;
  renderedAt: number | null;
  audioRequestedAt: number | null;
  audioStartedAt: number | null;
  audioEndedAt: number | null;
  retryAttempted: boolean;
  fallbackActivated: boolean;
}

export function createCoachingStep(id: string, text: string): CoachingStep {
  return {
    id,
    text,
    audioStatus: 'pending',
    audioUrl: null,
    micStatus: 'idle',
    renderedAt: null,
    audioRequestedAt: null,
    audioStartedAt: null,
    audioEndedAt: null,
    retryAttempted: false,
    fallbackActivated: false,
  };
}

// ── Playback Token System ──────────────────────────────────────────

let _activePlaybackId: string | null = null;
let _playbackCounter = 0;

/** Generate a new playback token. Invalidates any previous token. */
export function nextPlaybackId(): string {
  const prevId = _activePlaybackId;
  _playbackCounter++;
  const id = `pb-${_playbackCounter}-${Date.now()}`;
  _activePlaybackId = id;
  if (prevId) {
    logger.info('[token] playbackId transition', { from: prevId.slice(-12), to: id.slice(-12) });
  }
  return id;
}

/** Check if a playback token is still the active one. */
export function isActivePlayback(id: string): boolean {
  const active = _activePlaybackId === id;
  if (!active) {
    logger.info('[guard] stale callback suppressed', { staleId: id.slice(-12), currentId: _activePlaybackId?.slice(-12) ?? 'none' });
  }
  return active;
}

/** Get the current active playback ID (for debug). */
export function getActivePlaybackId(): string | null {
  return _activePlaybackId;
}

/** Clear the active playback (e.g. on session end). */
export function clearActivePlayback(): void {
  if (_activePlaybackId) {
    logger.info('[token] active playback cleared', { clearedId: _activePlaybackId.slice(-12) });
  }
  _activePlaybackId = null;
}

// ── Audio Unlock (Mobile/Safari) ───────────────────────────────────

let _audioUnlocked = false;
let _audioContext: AudioContext | null = null;

export function isAudioUnlocked(): boolean {
  return _audioUnlocked;
}

/**
 * Unlock audio playback via user gesture.
 * Must be called from a click/tap handler to satisfy Safari autoplay policy.
 */
export async function unlockAudio(): Promise<boolean> {
  if (_audioUnlocked) return true;

  try {
    if (!_audioContext || _audioContext.state === 'closed') {
      _audioContext = new AudioContext();
    }
    if (_audioContext.state === 'suspended') {
      await _audioContext.resume();
    }

    const buffer = _audioContext.createBuffer(1, 1, 22050);
    const source = _audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(_audioContext.destination);
    source.start(0);

    const audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.volume = 0;
    await audio.play().catch(() => {});
    audio.pause();
    audio.removeAttribute('src');

    _audioUnlocked = true;
    logger.info('Audio unlocked successfully');
    emitStepTelemetry('audio_unlock', 'session', { success: true });
    return true;
  } catch (err) {
    logger.warn('Audio unlock failed', { error: err });
    emitStepTelemetry('audio_unlock', 'session', { success: false, error: String(err) });
    return false;
  }
}

// ── Mic Handoff ────────────────────────────────────────────────────

const MIC_HANDOFF_DELAY_MS = 300;

export interface MicHandoffResult {
  granted: boolean;
  stream: MediaStream | null;
  fallbackToTyped: boolean;
  error?: string;
}

export async function attemptMicHandoff(stepId: string): Promise<MicHandoffResult> {
  await new Promise(r => setTimeout(r, MIC_HANDOFF_DELAY_MS));

  emitStepTelemetry('mic_requested', stepId, {});

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    emitStepTelemetry('mic_granted', stepId, {});
    return { granted: true, stream, fallbackToTyped: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emitStepTelemetry('mic_denied', stepId, { error });
    return { granted: false, stream: null, fallbackToTyped: true, error };
  }
}

// ── Telemetry ──────────────────────────────────────────────────────

type TelemetryEvent =
  | 'step_rendered'
  | 'audio_requested'
  | 'audio_started'
  | 'audio_ended'
  | 'audio_failed'
  | 'audio_timeout'
  | 'audio_stalled'
  | 'audio_interrupt'
  | 'retry_attempted'
  | 'mic_requested'
  | 'mic_granted'
  | 'mic_denied'
  | 'fallback_activated'
  | 'audio_unlock'
  | 'mode_downgraded';

export interface AudioTelemetryEntry {
  event: TelemetryEvent;
  stepId: string;
  ts: number;
  data?: Record<string, unknown>;
}

const _telemetryLog: AudioTelemetryEntry[] = [];
const MAX_TELEMETRY = 200;

export function emitStepTelemetry(
  event: TelemetryEvent,
  stepId: string,
  data?: Record<string, unknown>,
): void {
  const entry: AudioTelemetryEntry = { event, stepId, ts: Date.now(), data };
  _telemetryLog.push(entry);
  if (_telemetryLog.length > MAX_TELEMETRY) {
    _telemetryLog.splice(0, _telemetryLog.length - MAX_TELEMETRY);
  }
  logger.info(`[telemetry] ${event}`, { stepId, ...data });
}

/** Get telemetry log for debugging */
export function getAudioTelemetryLog(): readonly AudioTelemetryEntry[] {
  return [..._telemetryLog];
}

/** Get last N telemetry entries */
export function getRecentAudioTelemetry(count = 10): AudioTelemetryEntry[] {
  return _telemetryLog.slice(-count);
}

/** Clear telemetry (on session end) */
export function clearAudioTelemetry() {
  _telemetryLog.length = 0;
}

// ── Mode Downgrade Logic ───────────────────────────────────────────

export function evaluateModeDowngrade(
  currentMode: AudioDeliveryMode,
  recentFailures: number,
): AudioDeliveryMode {
  if (currentMode === 'text') return 'text';

  if (recentFailures >= 3) {
    const to = 'text';
    logger.info('[downgrade] mode downgraded', { from: currentMode, to, failures: recentFailures, reason: '3+ consecutive failures' });
    emitStepTelemetry('mode_downgraded', 'session', { from: currentMode, to, failures: recentFailures });
    return to;
  }
  if (recentFailures >= 2 && currentMode === 'full') {
    const to = 'quiet';
    logger.info('[downgrade] mode downgraded', { from: 'full', to, failures: recentFailures, reason: '2+ failures in full mode' });
    emitStepTelemetry('mode_downgraded', 'session', { from: 'full', to, failures: recentFailures });
    return to;
  }
  return currentMode;
}

// ── Debug State Snapshot ───────────────────────────────────────────

export interface AudioDebugState {
  activePlaybackId: string | null;
  audioUnlocked: boolean;
  failureCount: number;
  mode: AudioDeliveryMode;
  micStatus: string;
  recentEvents: AudioTelemetryEntry[];
}

export function getAudioDebugState(
  mode: AudioDeliveryMode,
  failureCount: number,
  micStatus: string,
): AudioDebugState {
  return {
    activePlaybackId: getActivePlaybackId(),
    audioUnlocked: isAudioUnlocked(),
    failureCount,
    mode,
    micStatus,
    recentEvents: getRecentAudioTelemetry(5),
  };
}
