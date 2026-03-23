import { useCallback, useEffect, useRef } from 'react';

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
  onWakeRef.current = onWake;

  const isSupported = typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const startListening = useCallback(() => {
    if (!isSupported || recognitionRef.current) return;

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
          // Stop listening before triggering to release mic
          recognition.stop();
          recognitionRef.current = null;
          onWakeRef.current();
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
      // On 'not-allowed', stop trying and notify user
      if (event.error === 'not-allowed') {
        recognition.stop();
        recognitionRef.current = null;
        console.error('[WakeWord] Microphone permission denied. Allow microphone access for this site to use "Hey Dave".');
      }
      // 'audio-capture' means no mic available
      if (event.error === 'audio-capture') {
        recognition.stop();
        recognitionRef.current = null;
        console.error('[WakeWord] No microphone found. Connect a microphone to use "Hey Dave".');
      }
    };

    recognition.onend = () => {
      // Auto-restart if still enabled
      if (recognitionRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      console.log('[WakeWord] Listening for wake phrase...');
    } catch {
      // Mic in use or permission denied
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

  return { isSupported };
}
