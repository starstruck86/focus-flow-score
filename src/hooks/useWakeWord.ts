import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface UseWakeWordOptions {
  onWake: () => void;
  enabled: boolean;
}

const WAKE_PHRASES = ['hey dave', 'ok dave', 'okay dave'];

/**
 * Listens for "Hey Dave" wake word using the Web Speech API.
 * Graceful no-op on unsupported browsers.
 * Pauses automatically when enabled=false (e.g. during active Dave session).
 */
export function useWakeWord({ onWake, enabled }: UseWakeWordOptions) {
  const recognitionRef = useRef<any>(null);
  const onWakeRef = useRef(onWake);
  const [lastError, setLastError] = useState<string | null>(null);
  onWakeRef.current = onWake;

  const isSupported = typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const startListening = useCallback(() => {
    if (!isSupported) {
      const msg = 'Speech recognition not supported in this browser';
      console.warn('[WakeWord]', msg);
      setLastError(msg);
      return;
    }
    if (recognitionRef.current) return;

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        if (WAKE_PHRASES.some(phrase => transcript.includes(phrase))) {
          console.log('[WakeWord] Wake phrase detected:', transcript);
          // Stop listening to release the mic for Dave
          recognition.stop();
          recognitionRef.current = null;
          // Small delay to ensure mic is released before Dave tries to acquire it
          setTimeout(() => {
            onWakeRef.current();
          }, 300);
          return;
        }
      }
    };

    recognition.onerror = (event: any) => {
      // 'no-speech' and 'aborted' are normal — restart
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      console.warn('[WakeWord] Error:', event.error);
      if (event.error === 'not-allowed') {
        recognition.stop();
        recognitionRef.current = null;
        const msg = 'Microphone permission denied — allow microphone access for "Hey Dave"';
        setLastError(msg);
        console.error('[WakeWord]', msg);
        toast.error('Hey Dave unavailable', { description: 'Microphone permission denied. Enable it in browser settings.', duration: 6000 });
      } else if (event.error === 'audio-capture') {
        recognition.stop();
        recognitionRef.current = null;
        const msg = 'No microphone found — connect a microphone for "Hey Dave"';
        setLastError(msg);
        console.error('[WakeWord]', msg);
        toast.error('Hey Dave unavailable', { description: 'No microphone detected on this device.', duration: 6000 });
      } else if (event.error === 'service-not-allowed' || event.error === 'language-not-supported') {
        recognition.stop();
        recognitionRef.current = null;
        const msg = `Speech recognition error: ${event.error}`;
        setLastError(msg);
        console.error('[WakeWord]', msg);
      } else {
        const msg = `Speech recognition error: ${event.error}`;
        setLastError(msg);
        console.error('[WakeWord]', msg);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still enabled and ref is still set
      if (recognitionRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started or disposed
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setLastError(null);
      console.log('[WakeWord] Listening for wake phrase...');
    } catch (e: any) {
      const msg = e?.message || 'Unknown error starting speech recognition';
      console.error('[WakeWord] Failed to start:', msg);
      setLastError(msg);
      recognitionRef.current = null;
      toast.error('Hey Dave failed to start', { description: msg, duration: 5000 });
    }
  }, [isSupported]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled && isSupported) {
      startListening();
    } else {
      stopListening();
    }
    return stopListening;
  }, [enabled, isSupported, startListening, stopListening]);

  return { isSupported, lastError };
}
