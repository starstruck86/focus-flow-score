/**
 * useAudioPreference — Persist audio/text mode preference.
 * Audio is the default. Text is the fallback.
 */

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'dojo-audio-mode';

export type DeliveryMode = 'audio' | 'text';

export function useAudioPreference() {
  const [mode, setModeState] = useState<DeliveryMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'text' ? 'text' : 'audio'; // default: audio
    } catch {
      return 'audio';
    }
  });

  const setMode = useCallback((m: DeliveryMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch { /* noop */ }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'audio' ? 'text' : 'audio');
  }, [mode, setMode]);

  return { mode, setMode, toggleMode, isAudio: mode === 'audio' };
}
