import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import {
  nextPlaybackId,
  isActivePlayback,
  clearActivePlayback,
  emitStepTelemetry,
} from '@/lib/daveAudioResilience';
import { startLifecycle, recordLifecycleEvent } from '@/lib/playbackLifecycle';

// ElevenLabs TTS has a 5000 char limit per request
const TTS_CHUNK_LIMIT = 4500;
/** Max time to wait for a single audio element to finish playing */
const PLAYBACK_TIMEOUT_MS = 120_000; // 2 minutes

/** Split text into chunks at sentence boundaries, respecting the char limit */
export function splitTextForTTS(text: string): string[] {
  if (text.length <= TTS_CHUNK_LIMIT) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > TTS_CHUNK_LIMIT && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Diagnostics (exported for QA/debug surfaces) ─────────────────

export interface VoiceModeDiagnostics {
  activeTtsAbortControllers: number;
  activeSttAbortControllers: number;
  activeObjectUrls: number;
  isPlaying: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  mounted: boolean;
  activePlaybackId: string | null;
}

export function useVoiceMode() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackAbortRef = useRef(false);
  const mountedRef = useRef(true);

  // Token-guarded playback: only the latest playbackId can mutate state
  const activePlaybackIdRef = useRef<string | null>(null);

  // Separate tracking for TTS vs STT abort controllers to prevent cross-contamination
  const ttsAbortControllersRef = useRef<Set<AbortController>>(new Set());
  const sttAbortControllersRef = useRef<Set<AbortController>>(new Set());
  /** Tracks object URLs that need cleanup */
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());

  // Unmount guard
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort all in-flight fetches (both TTS and STT)
      ttsAbortControllersRef.current.forEach((ac) => ac.abort());
      ttsAbortControllersRef.current.clear();
      sttAbortControllersRef.current.forEach((ac) => ac.abort());
      sttAbortControllersRef.current.clear();
      // Revoke all object URLs
      activeObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      activeObjectUrlsRef.current.clear();
      // Stop any playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src) {
          URL.revokeObjectURL(audioRef.current.src);
          activeObjectUrlsRef.current.delete(audioRef.current.src);
        }
        audioRef.current = null;
      }
      // Stop media stream
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // Clear playback token (global + local)
      clearActivePlayback();
      activePlaybackIdRef.current = null;
    };
  }, []);

  const safeSetIsPlaying = useCallback((v: boolean) => {
    if (mountedRef.current) setIsPlaying(v);
  }, []);

  const safeSetIsTranscribing = useCallback((v: boolean) => {
    if (mountedRef.current) setIsTranscribing(v);
  }, []);

  const safeSetIsRecording = useCallback((v: boolean) => {
    if (mountedRef.current) setIsRecording(v);
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.start(100);
      safeSetIsRecording(true);
    } catch (err) {
      toast.error('Microphone access denied', {
        description: 'Please enable microphone access to use voice mode.',
      });
      throw err;
    }
  }, [safeSetIsRecording]);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        safeSetIsRecording(false);
        reject(new Error('No active recording'));
        return;
      }

      mediaRecorder.onstop = async () => {
        safeSetIsRecording(false);
        streamRef.current?.getTracks().forEach((t) => t.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size < 1000) {
          reject(new Error('Recording too short'));
          return;
        }

        safeSetIsTranscribing(true);
        try {
          const text = await transcribeWithRetry(audioBlob);
          resolve(text);
        } catch (err) {
          reject(err);
        } finally {
          safeSetIsTranscribing(false);
        }
      };

      mediaRecorder.stop();
    });
  }, [safeSetIsRecording, safeSetIsTranscribing]);

  /** Transcribe audio with per-attempt abort isolation (tracked separately from TTS) */
  const transcribeWithRetry = async (audioBlob: Blob): Promise<string> => {
    const ac = new AbortController();
    sttAbortControllersRef.current.add(ac);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const resp = await authenticatedFetch({
        functionName: 'elevenlabs-stt',
        body: formData,
        retry: { maxAttempts: 3, baseDelayMs: 500 },
        timeoutMs: 30_000,
        componentName: 'VoiceMode-STT',
        signal: ac.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Transcription failed' }));
        throw new Error(err.error || `STT error ${resp.status}`);
      }

      const data = await resp.json();
      const text = data.text?.trim();
      if (!text) throw new Error('No speech detected');
      return text;
    } finally {
      sttAbortControllersRef.current.delete(ac);
    }
  };

  const cancelRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    // Abort any in-flight STT requests
    sttAbortControllersRef.current.forEach((ac) => ac.abort());
    sttAbortControllersRef.current.clear();
    safeSetIsRecording(false);
    safeSetIsTranscribing(false);
    audioChunksRef.current = [];
  }, [safeSetIsRecording, safeSetIsTranscribing]);

  /** Fetch a single TTS chunk with abort isolation and return an Audio element */
  const fetchTTSChunk = async (
    text: string,
    voiceId: string | undefined,
    signal: AbortSignal,
  ): Promise<HTMLAudioElement> => {
    const resp = await authenticatedFetch({
      functionName: 'elevenlabs-tts-stream',
      body: { text, voiceId },
      retry: { maxAttempts: 2, baseDelayMs: 1_000 },
      timeoutMs: 30_000,
      componentName: 'VoiceMode-TTS',
      signal,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'TTS failed' }));
      throw new Error(err.error || `TTS error ${resp.status}`);
    }

    const audioBlob = await resp.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    activeObjectUrlsRef.current.add(audioUrl);

    const audio = new Audio(audioUrl);
    return audio;
  };

  /** Safely revoke an object URL and remove from tracking */
  const revokeUrl = (url: string) => {
    URL.revokeObjectURL(url);
    activeObjectUrlsRef.current.delete(url);
  };

  /** Play a single audio element with settle handlers for ended/error/stalled/timeout */
  const playAudioWithTimeout = (audio: HTMLAudioElement, playbackId: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(stallTimer);
        audio.onended = null;
        audio.onerror = null;
        audio.onstalled = null;
        audio.onplaying = null;
        audio.onpause = null;
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          audio.pause();
          revokeUrl(audio.src);
          reject(new Error('Audio playback timed out'));
        });
      }, PLAYBACK_TIMEOUT_MS);

      audio.onended = () => settle(() => {
        revokeUrl(audio.src);
        resolve();
      });

      audio.onerror = () => settle(() => {
        revokeUrl(audio.src);
        reject(new Error('Audio playback failed'));
      });

      // Stall detection: wait 10s before giving up
      audio.onstalled = () => {
        stallTimer = setTimeout(() => {
          settle(() => {
            audio.pause();
            revokeUrl(audio.src);
            reject(new Error('Audio playback stalled'));
          });
        }, 10_000);
      };

      audio.onplaying = () => {
        clearTimeout(stallTimer);
      };

      // Detect external pause (from stopPlayback or token invalidation)
      audio.onpause = () => {
        if (!audio.ended) {
          settle(() => {
            revokeUrl(audio.src);
            // If paused because token became stale, resolve silently
            if (!isActivePlayback(playbackId)) {
              resolve();
            } else {
              resolve();
            }
          });
        }
      };

      audio.play().catch((err) => settle(() => {
        revokeUrl(audio.src);
        reject(err);
      }));
    });
  };

  /**
   * Stop any currently active playback — cleanly cancels previous clip,
   * fires interrupt telemetry, and ensures stale callbacks are ignored.
   */
  const interruptCurrentPlayback = useCallback((source?: string) => {
    const prevId = activePlaybackIdRef.current;

    // Abort only TTS fetches — do NOT touch STT
    ttsAbortControllersRef.current.forEach((ac) => ac.abort());
    ttsAbortControllersRef.current.clear();
    playbackAbortRef.current = true;

    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src) revokeUrl(audioRef.current.src);
      audioRef.current = null;
    }

    if (prevId) {
      emitStepTelemetry('audio_interrupt', 'playback', {
        interruptedId: prevId,
        source: source ?? 'unknown',
      });
    }

    safeSetIsPlaying(false);
  }, [safeSetIsPlaying]);

  /** Play TTS with sequential chunk delivery, token-guarded — stale clips cannot mutate state */
  const playTTS = useCallback(async (text: string, voiceId?: string): Promise<void> => {
    // Interrupt any existing playback cleanly (source: new playTTS call)
    interruptCurrentPlayback('playTTS');

    // Mint a new playback token — only this token can control state
    const playbackId = nextPlaybackId();
    activePlaybackIdRef.current = playbackId;
    playbackAbortRef.current = false;

    // Start lifecycle tracking
    startLifecycle(playbackId, 'tts');

    const ac = new AbortController();
    ttsAbortControllersRef.current.add(ac);

    const chunks = splitTextForTTS(text);
    safeSetIsPlaying(true);

    try {
      for (let i = 0; i < chunks.length; i++) {
        // Token guard: if we're no longer the active playback, bail silently
        if (!isActivePlayback(playbackId) || playbackAbortRef.current || ac.signal.aborted) {
          recordLifecycleEvent(playbackId, 'suppressed', 'stale token before fetch');
          break;
        }

        // Fetch current chunk
        const audio = await fetchTTSChunk(chunks[i], voiceId, ac.signal);

        // Re-check token after async fetch
        if (!isActivePlayback(playbackId) || playbackAbortRef.current) {
          revokeUrl(audio.src);
          recordLifecycleEvent(playbackId, 'suppressed', 'stale token after fetch');
          break;
        }

        if (i === 0) recordLifecycleEvent(playbackId, 'started');
        audioRef.current = audio;
        await playAudioWithTimeout(audio, playbackId);
      }
      if (isActivePlayback(playbackId)) {
        recordLifecycleEvent(playbackId, 'ended');
      }
    } catch (err) {
      // Only throw if this is still the active playback (not interrupted)
      if (isActivePlayback(playbackId) && !playbackAbortRef.current && !(err instanceof DOMException && err.name === 'AbortError')) {
        recordLifecycleEvent(playbackId, 'failed', err instanceof Error ? err.message : 'unknown');
        throw err;
      } else {
        recordLifecycleEvent(playbackId, 'interrupted', 'aborted or stale');
      }
    } finally {
      ttsAbortControllersRef.current.delete(ac);
      // Only clear playing state if we're still the active playback
      if (isActivePlayback(playbackId)) {
        safeSetIsPlaying(false);
      }
    }
  }, [safeSetIsPlaying, interruptCurrentPlayback]);

  const stopPlayback = useCallback(() => {
    interruptCurrentPlayback('stopPlayback');
    // Invalidate the token so no stale callbacks can fire
    activePlaybackIdRef.current = null;
  }, [interruptCurrentPlayback]);

  /** Diagnostics snapshot for debug/QA surfaces */
  const getDiagnostics = useCallback((): VoiceModeDiagnostics => ({
    activeTtsAbortControllers: ttsAbortControllersRef.current.size,
    activeSttAbortControllers: sttAbortControllersRef.current.size,
    activeObjectUrls: activeObjectUrlsRef.current.size,
    isPlaying,
    isRecording,
    isTranscribing,
    mounted: mountedRef.current,
    activePlaybackId: activePlaybackIdRef.current,
  }), [isPlaying, isRecording, isTranscribing]);

  return {
    isRecording,
    isPlaying,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelRecording,
    playTTS,
    stopPlayback,
    getDiagnostics,
  };
}
