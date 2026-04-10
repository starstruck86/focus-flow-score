/**
 * ElevenLabs Transport Adapter for Sales Dojo
 *
 * Thin integration layer that:
 * - Calls the existing elevenlabs-tts-stream edge function
 * - Translates real browser Audio events into dojoAudioController events
 * - Handles only TTS transport — no business logic, no scoring, no session mgmt
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
}

export function createTransportHandle(): TransportHandle {
  return { audio: null, objectUrl: null, activeChunkId: null, abortController: null };
}

// ── Core: speak a chunk ────────────────────────────────────────────

/**
 * Fetch TTS audio for a chunk and play it.
 * Returns updated controller state through event callbacks.
 *
 * The `onStateUpdate` callback is called for each state transition so the
 * caller (React hook or similar) can apply updates.
 */
export async function speakChunk(
  chunk: SpeechChunk,
  ctrl: AudioControllerState,
  config: TransportConfig,
  handle: TransportHandle,
  onStateUpdate: (result: ControllerResult) => void,
  options?: { previousText?: string; nextText?: string }
): Promise<TransportHandle> {
  // Clean up any previous playback
  const cleanHandle = cleanupHandle(handle);

  const abortController = new AbortController();
  const activeHandle: TransportHandle = {
    ...cleanHandle,
    activeChunkId: chunk.id,
    abortController,
  };

  // Mark requested
  onStateUpdate(onTtsRequested(ctrl, chunk.id));

  try {
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
      const errText = await response.text().catch(() => 'Unknown error');
      onStateUpdate(onTtsFailed(ctrl, chunk.id, `TTS HTTP ${response.status}: ${errText}`));
      return activeHandle;
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);

    activeHandle.audio = audio;
    activeHandle.objectUrl = objectUrl;

    // Wire browser audio events → controller events
    audio.addEventListener('playing', () => {
      if (activeHandle.activeChunkId === chunk.id) {
        onStateUpdate(onTtsStarted(ctrl, chunk.id));
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      if (activeHandle.activeChunkId === chunk.id) {
        onStateUpdate(onTtsCompleted(ctrl, chunk.id));
        activeHandle.activeChunkId = null;
      }
    }, { once: true });

    audio.addEventListener('error', () => {
      if (activeHandle.activeChunkId === chunk.id) {
        const msg = audio.error?.message ?? 'Audio playback error';
        onStateUpdate(onTtsFailed(ctrl, chunk.id, msg));
        activeHandle.activeChunkId = null;
      }
    }, { once: true });

    await audio.play();
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Cancelled intentionally — not a failure
      return activeHandle;
    }
    onStateUpdate(
      onTtsFailed(ctrl, chunk.id, err instanceof Error ? err.message : 'Unknown TTS error')
    );
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

// ── Cleanup ────────────────────────────────────────────────────────

function cleanupHandle(handle: TransportHandle): TransportHandle {
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
  };
}

/** Full teardown — call on unmount. */
export function destroyTransport(handle: TransportHandle): void {
  stopPlayback(handle);
}
