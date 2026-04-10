/**
 * ElevenLabs Transport Adapter for Sales Dojo — v2 (hardened)
 *
 * Thin integration layer that:
 * - Calls the existing elevenlabs-tts-stream edge function
 * - Translates real browser Audio events into dojoAudioController events
 * - Handles only TTS transport — no business logic, no scoring, no session mgmt
 * - Includes transport-level retry/backoff for network fetch failures
 * - Distinguishes failure phases for debugging
 * - Handles autoplay rejection gracefully
 *
 * Scoped exclusively to Dave coaching inside Dojo sessions.
 */

import type { SpeechChunk } from './conversationEngine';
import type { AudioControllerState, ControllerResult } from './dojoAudioController';
import {
  onTtsRequested,
  onTtsStarted,
  onTtsCompleted,
  onTtsFailed,
} from './dojoAudioController';

// ── Config ─────────────────────────────────────────────────────────

export interface TransportConfig {
  /** Voice ID for ElevenLabs. Default: George (professional male). */
  voiceId?: string;
  /** Supabase project URL (from env). */
  supabaseUrl: string;
  /** Supabase anon key (from env). */
  supabaseAnonKey: string;
}

const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George

// ── Transport-level retry config ───────────────────────────────────

const TRANSPORT_MAX_RETRIES = 2;
const TRANSPORT_BACKOFF_BASE_MS = 500;

// ── Failure phases (for debugging/analytics) ───────────────────────

export type TransportFailurePhase =
  | 'before_response'    // fetch threw or was aborted before response
  | 'during_response'    // got response but read/blob failed
  | 'before_audio_play'  // audio element setup failed
  | 'during_playback'    // audio.play() or playback event error
  | 'autoplay_blocked';  // browser blocked autoplay

// ── Transport State ────────────────────────────────────────────────

export interface TransportHandle {
  /** Currently playing Audio element, if any. */
  audio: HTMLAudioElement | null;
  /** Object URL to revoke on cleanup. */
  objectUrl: string | null;
  /** The chunk ID currently being transported. */
  activeChunkId: string | null;
  /** AbortController for the fetch request. */
  abortController: AbortController | null;
  /** Whether cleanup has been called (idempotency guard). */
  _cleaned: boolean;
}

export function createTransportHandle(): TransportHandle {
  return { audio: null, objectUrl: null, activeChunkId: null, abortController: null, _cleaned: false };
}

// ── Core: speak a chunk ────────────────────────────────────────────

/**
 * Fetch TTS audio for a chunk and play it.
 * Includes transport-level retry with backoff before handing failure
 * up to the controller's degradation logic.
 */
export async function speakChunk(
  chunk: SpeechChunk,
  ctrl: AudioControllerState,
  config: TransportConfig,
  handle: TransportHandle,
  onStateUpdate: (result: ControllerResult) => void,
  options?: { previousText?: string; nextText?: string }
): Promise<TransportHandle> {
  // Clean up any previous playback (idempotent)
  const cleanHandle = cleanupHandle(handle);

  const abortController = new AbortController();
  const activeHandle: TransportHandle = {
    ...cleanHandle,
    activeChunkId: chunk.id,
    abortController,
    _cleaned: false,
  };

  // Mark requested
  onStateUpdate(onTtsRequested(ctrl, chunk.id));

  // ── Fetch with transport-level retry ─────────────────────────
  let blob: Blob | null = null;
  let lastError: string = '';
  let failurePhase: TransportFailurePhase = 'before_response';

  for (let attempt = 0; attempt <= TRANSPORT_MAX_RETRIES; attempt++) {
    if (abortController.signal.aborted) {
      return activeHandle; // cancelled intentionally
    }

    if (attempt > 0) {
      const backoff = TRANSPORT_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
      if (abortController.signal.aborted) return activeHandle;
    }

    try {
      failurePhase = 'before_response';
      const body: Record<string, unknown> = {
        text: chunk.text,
        voiceId: config.voiceId ?? DEFAULT_VOICE_ID,
      };
      if (options?.previousText) body.previous_text = options.previousText;
      if (options?.nextText) body.next_text = options.nextText;

      const response = await fetch(
        `${config.supabaseUrl}/functions/v1/elevenlabs-tts-stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: config.supabaseAnonKey,
            Authorization: `Bearer ${config.supabaseAnonKey}`,
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
        }
      );

      if (!response.ok) {
        failurePhase = 'during_response';
        lastError = `TTS HTTP ${response.status}`;
        const errText = await response.text().catch(() => '');
        if (errText) lastError += `: ${errText}`;
        continue; // retry
      }

      failurePhase = 'during_response';
      blob = await response.blob();
      break; // success
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return activeHandle; // cancelled intentionally
      }
      lastError = err instanceof Error ? err.message : 'Unknown fetch error';
      failurePhase = 'before_response';
    }
  }

  // All retries exhausted without blob
  if (!blob) {
    onStateUpdate(onTtsFailed(ctrl, chunk.id, `[${failurePhase}] ${lastError}`));
    return activeHandle;
  }

  // ── Audio playback setup ─────────────────────────────────────
  try {
    failurePhase = 'before_audio_play';
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);

    activeHandle.audio = audio;
    activeHandle.objectUrl = objectUrl;

    // Wire browser audio events → controller events
    // GUARD: All callbacks check activeChunkId to prevent stale emissions
    audio.addEventListener('playing', () => {
      if (activeHandle.activeChunkId === chunk.id && !activeHandle._cleaned) {
        onStateUpdate(onTtsStarted(ctrl, chunk.id));
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      if (activeHandle.activeChunkId === chunk.id && !activeHandle._cleaned) {
        onStateUpdate(onTtsCompleted(ctrl, chunk.id));
        activeHandle.activeChunkId = null;
      }
    }, { once: true });

    audio.addEventListener('error', () => {
      if (activeHandle.activeChunkId === chunk.id && !activeHandle._cleaned) {
        const msg = audio.error?.message ?? 'Audio playback error';
        onStateUpdate(onTtsFailed(ctrl, chunk.id, `[during_playback] ${msg}`));
        activeHandle.activeChunkId = null;
      }
    }, { once: true });

    // ── Attempt play — handle autoplay rejection ──────────────
    failurePhase = 'during_playback';
    try {
      await audio.play();
    } catch (playErr) {
      // Autoplay was blocked or play failed
      if (activeHandle.activeChunkId === chunk.id && !activeHandle._cleaned) {
        const isAutoplay = playErr instanceof DOMException && playErr.name === 'NotAllowedError';
        const phase: TransportFailurePhase = isAutoplay ? 'autoplay_blocked' : 'during_playback';
        const msg = playErr instanceof Error ? playErr.message : 'play() failed';
        onStateUpdate(onTtsFailed(ctrl, chunk.id, `[${phase}] ${msg}`));
        activeHandle.activeChunkId = null;
      }
    }
  } catch (err) {
    if (activeHandle.activeChunkId === chunk.id && !activeHandle._cleaned) {
      const msg = err instanceof Error ? err.message : 'Audio setup error';
      onStateUpdate(onTtsFailed(ctrl, chunk.id, `[${failurePhase}] ${msg}`));
      activeHandle.activeChunkId = null;
    }
  }

  return activeHandle;
}

// ── Stop / Interrupt ───────────────────────────────────────────────

/** Stop current playback immediately (e.g. user interrupted). */
export function stopPlayback(handle: TransportHandle): TransportHandle {
  if (handle.abortController) {
    handle.abortController.abort();
  }
  if (handle.audio) {
    handle.audio.pause();
    handle.audio.currentTime = 0;
  }
  return cleanupHandle(handle);
}

// ── Cleanup (idempotent) ───────────────────────────────────────────

function cleanupHandle(handle: TransportHandle): TransportHandle {
  if (handle._cleaned) {
    return { audio: null, objectUrl: null, activeChunkId: null, abortController: null, _cleaned: true };
  }
  if (handle.objectUrl) {
    URL.revokeObjectURL(handle.objectUrl);
  }
  if (handle.audio) {
    handle.audio.pause();
    handle.audio.removeAttribute('src');
  }
  return {
    audio: null,
    objectUrl: null,
    activeChunkId: null,
    abortController: null,
    _cleaned: true,
  };
}

/** Full teardown — call on unmount. */
export function destroyTransport(handle: TransportHandle): void {
  stopPlayback(handle);
}
