/**
 * Dave Session Buffer — Local persistence for active voice sessions.
 *
 * Persists enough state to survive:
 * - Brief signal drops
 * - App backgrounding
 * - Mode switches (audio ↔ visual)
 *
 * Does NOT replace sessionDurability.ts — extends it for voice-specific state.
 */

import { createLogger } from '@/lib/logger';
import type { VoiceSurface } from '@/lib/daveVoiceRuntime';
import type { DeliveryMode } from '@/hooks/useAudioPreference';

const logger = createLogger('DaveSessionBuffer');
const BUFFER_KEY = 'dave_voice_session_buffer';
const EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Buffer Schema ─────────────────────────────────────────────

export interface VoiceSessionBuffer {
  /** Session identifier */
  sessionId: string;
  /** Which surface is active */
  surface: VoiceSurface;
  /** audio or text */
  mode: DeliveryMode;
  /** Current position (block index, rep number, unit index) */
  position: number;
  /** Transcript log entries */
  transcriptLog: Array<{ role: 'dave' | 'user'; text: string; ts: number }>;
  /** Pending user transcript not yet scored */
  pendingTranscript: string | null;
  /** Pending scoring request data */
  pendingScore: Record<string, unknown> | null;
  /** Whether session is paused */
  paused: boolean;
  /** Surface-specific metadata */
  surfaceState: Record<string, unknown>;
  /** Timestamp of last save */
  savedAt: number;
}

// ── Read / Write ──────────────────────────────────────────────

export function saveVoiceSessionBuffer(buffer: VoiceSessionBuffer): void {
  try {
    localStorage.setItem(BUFFER_KEY, JSON.stringify({
      ...buffer,
      savedAt: Date.now(),
    }));
  } catch {
    logger.warn('Failed to save voice session buffer');
  }
}

export function loadVoiceSessionBuffer(): VoiceSessionBuffer | null {
  try {
    const raw = localStorage.getItem(BUFFER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VoiceSessionBuffer;
    if (Date.now() - parsed.savedAt > EXPIRY_MS) {
      clearVoiceSessionBuffer();
      return null;
    }
    return parsed;
  } catch {
    clearVoiceSessionBuffer();
    return null;
  }
}

export function clearVoiceSessionBuffer(): void {
  try { localStorage.removeItem(BUFFER_KEY); } catch { /* noop */ }
}

// ── Buffer Helpers ────────────────────────────────────────────

export function createEmptyBuffer(
  sessionId: string,
  surface: VoiceSurface,
  mode: DeliveryMode,
): VoiceSessionBuffer {
  return {
    sessionId,
    surface,
    mode,
    position: 0,
    transcriptLog: [],
    pendingTranscript: null,
    pendingScore: null,
    paused: false,
    surfaceState: {},
    savedAt: Date.now(),
  };
}

export function appendToTranscriptLog(
  buffer: VoiceSessionBuffer,
  role: 'dave' | 'user',
  text: string,
): VoiceSessionBuffer {
  return {
    ...buffer,
    transcriptLog: [
      ...buffer.transcriptLog,
      { role, text, ts: Date.now() },
    ],
  };
}

export function updateBufferPosition(
  buffer: VoiceSessionBuffer,
  position: number,
  surfaceState?: Record<string, unknown>,
): VoiceSessionBuffer {
  return {
    ...buffer,
    position,
    ...(surfaceState ? { surfaceState: { ...buffer.surfaceState, ...surfaceState } } : {}),
  };
}

/**
 * Check if there's a resumable voice session for a given surface.
 */
export function hasResumableVoiceSession(surface?: VoiceSurface): boolean {
  const buffer = loadVoiceSessionBuffer();
  if (!buffer) return false;
  if (surface && buffer.surface !== surface) return false;
  return !buffer.paused || buffer.pendingTranscript != null;
}
