/**
 * Dave Audio Resilience Layer
 *
 * Text-first coaching step model, audio unlock, playback resilience,
 * mic fallback, and per-step telemetry.
 *
 * Architecture: text is the source of truth. Audio is an enhancement.
 * No coaching content is ever skipped because of audio/mic failure.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveAudioResilience');

// ── Delivery Mode ──────────────────────────────────────────────────

export type AudioDeliveryMode = 'full' | 'quiet' | 'text';

export function describeMode(mode: AudioDeliveryMode): string {
  switch (mode) {
    case 'full': return 'Audio + mic';
    case 'quiet': return 'Audio only — typed input';
    case 'text': return 'Text only';
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

// ── Audio Unlock (Mobile/Safari) ───────────────────────────────────

let _audioUnlocked = false;
let _audioContext: AudioContext | null = null;

export function isAudioUnlocked(): boolean {
  return _audioUnlocked;
}

/**
 * Unlock audio playback via user gesture.
 * Must be called from a click/tap handler to satisfy Safari autoplay policy.
 * Creates an AudioContext and plays a silent buffer to prime the audio path.
 */
export async function unlockAudio(): Promise<boolean> {
  if (_audioUnlocked) return true;

  try {
    // Create or resume AudioContext
    if (!_audioContext || _audioContext.state === 'closed') {
      _audioContext = new AudioContext();
    }
    if (_audioContext.state === 'suspended') {
      await _audioContext.resume();
    }

    // Play a silent buffer to prime playback
    const buffer = _audioContext.createBuffer(1, 1, 22050);
    const source = _audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(_audioContext.destination);
    source.start(0);

    // Also prime an Audio element
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

// ── Playback with Retry & Settle ───────────────────────────────────

const PLAYBACK_SETTLE_TIMEOUT_MS = 60_000;
const STALL_TIMEOUT_MS = 10_000;
const MIC_HANDOFF_DELAY_MS = 300;

export interface PlaybackResult {
  success: boolean;
  retried: boolean;
  error?: string;
}

/**
 * Play an audio blob with full settle handling:
 * - Fresh Audio element per clip
 * - Explicit handlers for ended/error/stalled/timeout
 * - One retry on failure
 * - Cleanup of object URLs and listeners
 */
export async function playWithResilience(
  blob: Blob,
  stepId: string,
): Promise<PlaybackResult> {
  const result = await attemptPlayback(blob, stepId);
  if (result.success) return result;

  // One retry with fresh state
  emitStepTelemetry('retry_attempted', stepId, {});
  const retryResult = await attemptPlayback(blob, stepId);
  return { ...retryResult, retried: true };
}

async function attemptPlayback(blob: Blob, stepId: string): Promise<PlaybackResult> {
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

      // Cleanup
      audio.onended = null;
      audio.onerror = null;
      audio.onstalled = null;
      audio.onpause = null;
      audio.onplaying = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load(); // force release
      URL.revokeObjectURL(objectUrl);

      resolve({ success, retried: false, error });
    };

    // Overall timeout
    const overallTimer = setTimeout(() => {
      emitStepTelemetry('audio_timeout', stepId, {});
      settle(false, 'Playback timed out');
    }, PLAYBACK_SETTLE_TIMEOUT_MS);

    audio.onended = () => {
      emitStepTelemetry('audio_ended', stepId, {});
      settle(true);
    };

    audio.onerror = () => {
      const msg = audio.error?.message ?? 'Audio playback error';
      emitStepTelemetry('audio_failed', stepId, { error: msg });
      settle(false, msg);
    };

    audio.onstalled = () => {
      // Give it a chance to recover
      stallTimer = setTimeout(() => {
        emitStepTelemetry('audio_stalled', stepId, {});
        settle(false, 'Audio stalled');
      }, STALL_TIMEOUT_MS);
    };

    audio.onplaying = () => {
      // Clear stall timer if playback resumes
      clearTimeout(stallTimer);
      emitStepTelemetry('audio_started', stepId, {});
    };

    audio.src = objectUrl;
    emitStepTelemetry('audio_requested', stepId, {});

    audio.play().catch((err) => {
      const msg = err instanceof Error ? err.message : 'play() rejected';
      emitStepTelemetry('audio_failed', stepId, { error: msg });
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

/**
 * Attempt mic acquisition after playback ends.
 * Waits a short handoff delay, then requests mic.
 * Falls back to typed input if mic is unavailable.
 */
export async function attemptMicHandoff(stepId: string): Promise<MicHandoffResult> {
  // Handoff delay for audio pipeline to settle
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
  | 'retry_attempted'
  | 'mic_requested'
  | 'mic_granted'
  | 'mic_denied'
  | 'fallback_activated'
  | 'audio_unlock'
  | 'mode_downgraded';

const _telemetryLog: Array<{ event: TelemetryEvent; stepId: string; ts: number; data?: Record<string, unknown> }> = [];

export function emitStepTelemetry(
  event: TelemetryEvent,
  stepId: string,
  data?: Record<string, unknown>,
): void {
  const entry = { event, stepId, ts: Date.now(), data };
  _telemetryLog.push(entry);
  logger.info(`[telemetry] ${event}`, { stepId, ...data });
}

/** Get telemetry log for debugging */
export function getAudioTelemetryLog() {
  return [..._telemetryLog];
}

/** Clear telemetry (on session end) */
export function clearAudioTelemetry() {
  _telemetryLog.length = 0;
}

// ── Mode Downgrade Logic ───────────────────────────────────────────

/**
 * Determine if mode should downgrade based on failures.
 * Returns the recommended mode after evaluating recent events.
 */
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
