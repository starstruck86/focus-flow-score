/**
 * useDaveAudioLauncher — Hook for the voice-first entry flow.
 *
 * Manages the Dave greeting → listen → route → launch lifecycle.
 * Uses useDaveVoiceController for all audio operations.
 */

import { useState, useCallback, useRef } from 'react';
import { useDaveVoiceController, type DaveVoiceControllerConfig } from '@/hooks/useDaveVoiceController';
import {
  buildGreeting,
  processLaunchIntent,
  matchPreset,
  type LauncherPhase,
} from '@/lib/daveAudioLauncher';
import {
  evaluateTransition,
  buildResumeIntro,
  type SessionOutcome,
  type TransitionOffer,
  type ResumeContext,
} from '@/lib/daveSurfaceTransitions';
import type { DaveRecommendation } from '@/lib/daveTrainingRouter';
import { loadVoiceSessionBuffer } from '@/lib/daveSessionBuffer';
import { loadActiveLoop } from '@/lib/daveClosedLoopStore';
import { buildLoopResumeInfo } from '@/lib/daveClosedLoopResume';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDaveAudioLauncher');

export interface UseDaveAudioLauncher {
  /** Current phase of the launcher */
  phase: LauncherPhase;
  /** The chosen recommendation */
  recommendation: DaveRecommendation | null;
  /** Pending transition offer */
  transitionOffer: TransitionOffer | null;
  /** Start the voice-first entry flow */
  startLauncher: (userId: string) => Promise<void>;
  /** Process a user transcript for routing */
  handleUserInput: (transcript: string, userId: string) => Promise<void>;
  /** Evaluate a surface transition after session completion */
  offerTransition: (outcome: SessionOutcome) => TransitionOffer | null;
  /** Accept a transition offer */
  acceptTransition: () => void;
  /** Decline a transition offer */
  declineTransition: () => void;
  /** Build a spoken resume intro from buffer */
  getResumeIntro: () => string | null;
  /** The underlying Dave controller */
  dave: ReturnType<typeof useDaveVoiceController>;
}

export function useDaveAudioLauncher(): UseDaveAudioLauncher {
  const dave = useDaveVoiceController({
    surface: 'dave_general',
    sessionKey: 'launcher',
    mode: 'audio',
  });

  const [phase, setPhase] = useState<LauncherPhase>('idle');
  const [recommendation, setRecommendation] = useState<DaveRecommendation | null>(null);
  const [transitionOffer, setTransitionOffer] = useState<TransitionOffer | null>(null);

  const startLauncher = useCallback(async (userId: string) => {
    setPhase('greeting');
    const buffer = loadVoiceSessionBuffer();

    // Check for active coaching loop first
    const activeLoop = await loadActiveLoop(userId);
    if (activeLoop && activeLoop.status !== 'completed') {
      const info = buildLoopResumeInfo(activeLoop);
      const greeting = `Welcome back. ${info.spokenIntro}`;
      await dave.speak(greeting);
      // Set as recommendation so the user can immediately launch
      setRecommendation({
        type: info.nextSurface || 'dojo',
        reason: `Active coaching loop: ${activeLoop.taughtConcept}`,
        launchState: info.launchState,
        spokenIntro: info.spokenIntro,
      });
      setPhase('listening');
      return;
    }

    const greeting = buildGreeting(!!buffer);
    await dave.speak(greeting);
    setPhase('listening');
  }, [dave]);

  const handleUserInput = useCallback(async (transcript: string, userId: string) => {
    setPhase('routing');

    // Check for commute preset first
    const preset = matchPreset(transcript);
    if (preset) {
      const rec: DaveRecommendation = {
        type: preset.surface,
        reason: preset.description,
        launchState: preset.launchState,
        spokenIntro: `Starting ${preset.spokenLabel}. ${preset.description}`,
      };
      setRecommendation(rec);
      await dave.speak(rec.spokenIntro);
      setPhase('launching');
      return;
    }

    // Full intent routing
    try {
      const rec = await processLaunchIntent(transcript, userId);
      setRecommendation(rec);
      await dave.speak(rec.spokenIntro);
      setPhase('launching');
    } catch (err) {
      logger.error('Launch routing failed', { error: err });
      await dave.speak("I didn't catch that. Try saying 'quick rep' or 'teach me discovery'.");
      setPhase('listening');
    }
  }, [dave]);

  const offerTransition = useCallback((outcome: SessionOutcome): TransitionOffer | null => {
    const offer = evaluateTransition(outcome);
    if (offer) {
      setTransitionOffer(offer);
    }
    return offer;
  }, []);

  const acceptTransition = useCallback(() => {
    if (!transitionOffer) return;
    const rec: DaveRecommendation = {
      type: transitionOffer.to,
      reason: transitionOffer.reason,
      launchState: transitionOffer.launchState,
      spokenIntro: '',
    };
    setRecommendation(rec);
    setTransitionOffer(null);
    setPhase('launching');
  }, [transitionOffer]);

  const declineTransition = useCallback(() => {
    setTransitionOffer(null);
  }, []);

  const getResumeIntro = useCallback((): string | null => {
    const buffer = loadVoiceSessionBuffer();
    if (!buffer) return null;
    return buildResumeIntro({
      surface: buffer.surface,
      position: buffer.position,
      sessionId: buffer.sessionId,
      surfaceState: buffer.surfaceState,
    });
  }, []);

  return {
    phase,
    recommendation,
    transitionOffer,
    startLauncher,
    handleUserInput,
    offerTransition,
    acceptTransition,
    declineTransition,
    getResumeIntro,
    dave,
  };
}
