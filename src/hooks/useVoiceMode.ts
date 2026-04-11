import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

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
  /** Tracks all active AbortControllers so we can abort on unmount/stop */
  const activeAbortControllersRef = useRef<Set<AbortController>>(new Set());
  /** Tracks object URLs that need cleanup */
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());

  // Unmount guard
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort all in-flight fetches
      activeAbortControllersRef.current.forEach((ac) => ac.abort());
      activeAbortControllersRef.current.clear();
      // Revoke all object URLs
      activeObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      activeObjectUrlsRef.current.clear();
      // Stop any playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      // Stop media stream
      streamRef.current?.getTracks().forEach((t) => t.stop());
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

  /** Transcribe audio with per-attempt abort isolation */
  const transcribeWithRetry = async (audioBlob: Blob): Promise<string> => {
    const ac = new AbortController();
    activeAbortControllersRef.current.add(ac);

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
      activeAbortControllersRef.current.delete(ac);
    }
  };

  const cancelRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    safeSetIsRecording(false);
    audioChunksRef.current = [];
  }, [safeSetIsRecording]);

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

  /** Play a single audio element with a hard timeout guard */
  const playAudioWithTimeout = (audio: HTMLAudioElement): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          audio.pause();
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

      audio.play().catch((err) => settle(() => {
        revokeUrl(audio.src);
        reject(err);
      }));
    });
  };

  /** Play TTS with sequential chunk delivery — no skip bugs */
  const playTTS = useCallback(async (text: string, voiceId?: string): Promise<void> => {
    // Stop any currently playing audio
    stopPlayback();
    playbackAbortRef.current = false;

    const ac = new AbortController();
    activeAbortControllersRef.current.add(ac);

    const chunks = splitTextForTTS(text);
    safeSetIsPlaying(true);

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (playbackAbortRef.current || ac.signal.aborted) break;

        // Fetch current chunk
        const audio = await fetchTTSChunk(chunks[i], voiceId, ac.signal);
        if (playbackAbortRef.current) {
          revokeUrl(audio.src);
          break;
        }

        audioRef.current = audio;
        await playAudioWithTimeout(audio);
      }
    } catch (err) {
      if (!playbackAbortRef.current && !(err instanceof DOMException && err.name === 'AbortError')) {
        throw err;
      }
    } finally {
      activeAbortControllersRef.current.delete(ac);
      safeSetIsPlaying(false);
    }
  }, [safeSetIsPlaying]);

  const stopPlayback = useCallback(() => {
    playbackAbortRef.current = true;
    // Abort all in-flight TTS fetches
    activeAbortControllersRef.current.forEach((ac) => ac.abort());
    activeAbortControllersRef.current.clear();
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src) revokeUrl(audioRef.current.src);
      audioRef.current = null;
    }
    safeSetIsPlaying(false);
  }, [safeSetIsPlaying]);

  return {
    isRecording,
    isPlaying,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelRecording,
    playTTS,
    stopPlayback,
  };
}
