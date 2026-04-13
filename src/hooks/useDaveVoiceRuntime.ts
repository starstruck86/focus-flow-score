/**
 * useDaveVoiceRuntime — React hook wrapping the shared Dave Voice Runtime.
 *
 * Provides:
 * - Voice state management
 * - TTS config from env
 * - Playback ref lifecycle
 * - Mode switching (visual ↔ audio) with session continuity
 * - Fallback handling
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  type DaveVoiceState,
  type VoiceSurface,
  type VoiceSession,
  type TtsConfig,
  type ActivePlayback,
  createInitialVoiceState,
  createVoiceSession,
  interruptSpeech,
} from '@/lib/daveVoiceRuntime';
import { useAudioPreference, type DeliveryMode } from '@/hooks/useAudioPreference';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDaveVoiceRuntime');

export interface UseDaveVoiceRuntime {
  /** Current voice state */
  state: DaveVoiceState;
  /** Audio/text mode */
  mode: DeliveryMode;
  /** Toggle between audio and text mode */
  toggleMode: () => void;
  /** Set mode explicitly */
  setMode: (m: DeliveryMode) => void;
  /** Whether audio mode is active */
  isAudio: boolean;
  /** TTS config for passing to adapters */
  ttsConfig: TtsConfig;
  /** Mutable playback ref for adapters */
  playbackRef: React.MutableRefObject<ActivePlayback>;
  /** Current voice session (persists across mode switches) */
  session: VoiceSession | null;
  /** Start a new voice session for a surface */
  startSession: (surface: VoiceSurface) => VoiceSession;
  /** End the current session */
  endSession: () => void;
  /** Update state from adapters */
  updateState: (patch: Partial<DaveVoiceState>) => void;
  /** Interrupt current speech */
  interrupt: () => void;
  /** Abort controller for cancelling operations */
  abortRef: React.MutableRefObject<AbortController>;
}

export function useDaveVoiceRuntime(): UseDaveVoiceRuntime {
  const [state, setState] = useState<DaveVoiceState>(createInitialVoiceState);
  const { mode, setMode, toggleMode, isAudio } = useAudioPreference();
  const [session, setSession] = useState<VoiceSession | null>(null);

  const playbackRef = useRef<ActivePlayback>({
    audio: null, objectUrl: null, abortController: null, _cleaned: true,
  });
  const abortRef = useRef<AbortController>(new AbortController());

  // TTS config from env
  const ttsConfig: TtsConfig = {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  };

  const updateState = useCallback((patch: Partial<DaveVoiceState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  const startSession = useCallback((surface: VoiceSurface): VoiceSession => {
    // Abort any existing session operations
    abortRef.current.abort();
    abortRef.current = new AbortController();

    const newSession = createVoiceSession(surface);
    setSession(newSession);
    updateState({ activeSurface: surface, error: null });
    logger.info('Voice session started', { surface, sessionId: newSession.id });
    return newSession;
  }, [updateState]);

  const endSession = useCallback(() => {
    abortRef.current.abort();
    playbackRef.current = interruptSpeech(playbackRef.current);
    setSession(null);
    setState(createInitialVoiceState());
    logger.info('Voice session ended');
  }, []);

  const interrupt = useCallback(() => {
    playbackRef.current = interruptSpeech(playbackRef.current);
    updateState({ isSpeaking: false });
  }, [updateState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current.abort();
      playbackRef.current = interruptSpeech(playbackRef.current);
    };
  }, []);

  return {
    state,
    mode,
    toggleMode,
    setMode,
    isAudio,
    ttsConfig,
    playbackRef,
    session,
    startSession,
    endSession,
    updateState,
    interrupt,
    abortRef,
  };
}
