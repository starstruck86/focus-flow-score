import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

const TTS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts-stream`;
const STT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-stt`;

// ElevenLabs TTS has a 5000 char limit per request
const TTS_CHUNK_LIMIT = 4500;

/** Split text into chunks at sentence boundaries, respecting the char limit */
function splitTextForTTS(text: string): string[] {
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
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;

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
      setIsRecording(true);
    } catch (err) {
      toast.error('Microphone access denied', {
        description: 'Please enable microphone access to use voice mode.',
      });
      throw err;
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        setIsRecording(false);
        reject(new Error('No active recording'));
        return;
      }

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        streamRef.current?.getTracks().forEach((t) => t.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size < 1000) {
          reject(new Error('Recording too short'));
          return;
        }

        setIsTranscribing(true);
        try {
          const text = await transcribeWithRetry(audioBlob);
          resolve(text);
        } catch (err) {
          reject(err);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.stop();
    });
  }, []);

  /** Transcribe with automatic retry on failure */
  const transcribeWithRetry = async (audioBlob: Blob, attempt = 0): Promise<string> => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const resp = await fetch(STT_URL, {
        method: 'POST',
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Transcription failed' }));
        throw new Error(err.error || `STT error ${resp.status}`);
      }

      const data = await resp.json();
      const text = data.text?.trim();
      if (!text) throw new Error('No speech detected');
      retryCountRef.current = 0;
      return text;
    } catch (err: any) {
      if (attempt < MAX_RETRIES && !err.message?.includes('No speech detected')) {
        console.warn(`STT retry ${attempt + 1}/${MAX_RETRIES}:`, err.message);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        return transcribeWithRetry(audioBlob, attempt + 1);
      }
      throw err;
    }
  };

  const cancelRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
    audioChunksRef.current = [];
  }, []);

  /** Fetch a single TTS chunk and return an Audio element */
  const fetchTTSChunk = async (text: string, voiceId?: string): Promise<HTMLAudioElement> => {
    const resp = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ text, voiceId }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'TTS failed' }));
      throw new Error(err.error || `TTS error ${resp.status}`);
    }

    const audioBlob = await resp.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Clean up object URL when done
    audio.onended = () => URL.revokeObjectURL(audioUrl);
    audio.onerror = () => URL.revokeObjectURL(audioUrl);

    return audio;
  };

  /** Play TTS with chunking for long text and sequential playback */
  const playTTS = useCallback(async (text: string, voiceId?: string): Promise<void> => {
    // Stop any currently playing audio
    stopPlayback();
    playbackAbortRef.current = false;

    const chunks = splitTextForTTS(text);
    setIsPlaying(true);

    try {
      // For single chunks, simple playback
      if (chunks.length === 1) {
        const audio = await fetchTTSChunk(chunks[0], voiceId);
        if (playbackAbortRef.current) return;

        audioRef.current = audio;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => {
            URL.revokeObjectURL(audio.src);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audio.src);
            reject(new Error('Audio playback failed'));
          };
          audio.play().catch(reject);
        });
        return;
      }

      // For multiple chunks: prefetch next while playing current
      for (let i = 0; i < chunks.length; i++) {
        if (playbackAbortRef.current) break;

        // Fetch current chunk (and prefetch next)
        const [currentAudio, nextAudioPromise] = await Promise.all([
          fetchTTSChunk(chunks[i], voiceId),
          i + 1 < chunks.length ? fetchTTSChunk(chunks[i + 1], voiceId) : Promise.resolve(null),
        ]);

        if (playbackAbortRef.current) break;

        audioRef.current = currentAudio;
        await new Promise<void>((resolve, reject) => {
          currentAudio.onended = () => {
            URL.revokeObjectURL(currentAudio.src);
            resolve();
          };
          currentAudio.onerror = () => {
            URL.revokeObjectURL(currentAudio.src);
            reject(new Error('Audio playback failed'));
          };
          currentAudio.play().catch(reject);
        });

        // Skip next fetch since we prefetched it
        if (nextAudioPromise && i + 1 < chunks.length) {
          i++; // skip next iteration
          if (playbackAbortRef.current) break;
          const nextAudio = await nextAudioPromise;
          if (!nextAudio || playbackAbortRef.current) break;

          audioRef.current = nextAudio;
          await new Promise<void>((resolve, reject) => {
            nextAudio.onended = () => {
              URL.revokeObjectURL(nextAudio.src);
              resolve();
            };
            nextAudio.onerror = () => {
              URL.revokeObjectURL(nextAudio.src);
              reject(new Error('Audio playback failed'));
            };
            nextAudio.play().catch(reject);
          });
        }
      }
    } catch (err) {
      if (!playbackAbortRef.current) throw err;
    } finally {
      setIsPlaying(false);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    playbackAbortRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

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
