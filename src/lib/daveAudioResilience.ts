/**
 * Dave Audio Resilience Layer
 *
 * Text-first coaching step model, audio unlock, playback resilience,
 * mic fallback, playback token system, and per-step telemetry.
 *
 * Architecture: text is the source of truth. Audio is an enhancement.
 * No coaching content is ever skipped because of audio/mic failure.
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
  _playbackCounter++;
  const id = `pb-${_playbackCounter}-${Date.now()}`;
  _activePlaybackId = id;
  return id;
}

/** Check if a playback token is still the active one. */
export function isActivePlayback(id: string): boolean {
  return _activePlaybackId === id;
}

/** Get the current active playback ID (for debug). */
export function getActivePlaybackId(): string | null {
  return _activePlaybackId;
}

/** Clear the active playback (e.g. on session end). */
export function clearActivePlayback(): void {
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

// ── Playback with Retry, Settle & Token Guard ──────────────────────

const PLAYBACK_SETTLE_TIMEOUT_MS = 60_000;
const STALL_TIMEOUT_MS = 10_000;
const MIC_HANDOFF_DELAY_MS = 300;
const MAX_TOTAL_ATTEMPTS = 2;

export interface PlaybackResult {
  success: boolean;
  retried: boolean;
  error?: string;
  tokenStale?: boolean;
}

/**
 * Play an audio blob with full settle handling + token guard.
 * - Fresh Audio element per clip
 * - One retry on failure (max 2 total attempts)
 * - Token check: stale clips resolve silently
 * - Hard 60s cap, stall detection
 */
export async function playWithResilience(
  blob: Blob,
  stepId: string,
  playbackId: string,
): Promise<PlaybackResult> {
  if (!isActivePlayback(playbackId)) {
    return { success: false, retried: false, tokenStale: true };
  }

  const result = await attemptPlayback(blob, stepId, playbackId);
  if (result.success || result.tokenStale) return result;

  // One retry with fresh state
  if (!isActivePlayback(playbackId)) {
    return { success: false, retried: false, tokenStale: true };
  }
  emitStepTelemetry('retry_attempted', stepId, { playbackId });
  const retryResult = await attemptPlayback(blob, stepId, playbackId);
  return { ...retryResult, retried: true };
}

async function attemptPlayback(blob: Blob, stepId: string, playbackId: string): Promise<PlaybackResult> {
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio();

  return new Promise<PlaybackResult>((resolve) => {
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (success: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      clearTimeout(stallTimer);

      audio.onended = null;
      audio.onerror = null;
      audio.onstalled = null;
      audio.onpause = null;
      audio.onplaying = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);

      const stale = !isActivePlayback(playbackId);
      if (stale) {
        resolve({ success: false, retried: false, tokenStale: true });
      } else {
        resolve({ success, retried: false, error });
      }
    };

    const overallTimer = setTimeout(() => {
      emitStepTelemetry('audio_timeout', stepId, { playbackId });
      settle(false, 'Playback timed out');
    }, PLAYBACK_SETTLE_TIMEOUT_MS);

    audio.onended = () => {
      emitStepTelemetry('audio_ended', stepId, { playbackId });
      settle(true);
    };

    audio.onerror = () => {
      const msg = audio.error?.message ?? 'Audio playback error';
      emitStepTelemetry('audio_failed', stepId, { error: msg, playbackId });
      settle(false, msg);
    };

    audio.onstalled = () => {
      stallTimer = setTimeout(() => {
        emitStepTelemetry('audio_stalled', stepId, { playbackId });
        settle(false, 'Audio stalled');
      }, STALL_TIMEOUT_MS);
    };

    audio.onplaying = () => {
      clearTimeout(stallTimer);
      emitStepTelemetry('audio_started', stepId, { playbackId });
    };

    audio.src = objectUrl;
    emitStepTelemetry('audio_requested', stepId, { playbackId });

    audio.play().catch((err) => {
      const msg = err instanceof Error ? err.message : 'play() rejected';
      emitStepTelemetry('audio_failed', stepId, { error: msg, playbackId });
      settle(false, msg);
    });
  });
}

// ── Mic Handoff ────────────────────────────────────────────────────

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
    emitStepTelemetry('mode_downgraded', 'session', { from: currentMode, to: 'text', failures: recentFailures });
    return 'text';
  }
  if (recentFailures >= 2 && currentMode === 'full') {
    emitStepTelemetry('mode_downgraded', 'session', { from: 'full', to: 'quiet', failures: recentFailures });
    return 'quiet';
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
