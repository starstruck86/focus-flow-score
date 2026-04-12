/**
 * Audio Session Flow — Pure state machine for audio-first Dojo training.
 *
 * Phases:
 * 1. intro       → Dave introduces the scenario (auto-play TTS)
 * 2. prompt      → Dave reads the objection (auto-play TTS)
 * 3. listening   → Mic is active, user speaks their response
 * 4. transcribing → Converting speech to text
 * 5. scoring     → System scores the response (no change to scoring logic)
 * 6. feedback    → Dave delivers feedback via existing chunk system
 * 7. retry_prompt → Dave prompts retry (optional)
 * 8. retry_listening → User speaks retry
 * 9. complete    → Session done
 *
 * All logic is deterministic. Dave reads system outputs only.
 */

import type { DojoScenario } from './scenarios';

export type AudioSessionPhase =
  | 'intro'
  | 'prompt'
  | 'listening'
  | 'transcribing'
  | 'scoring'
  | 'feedback'
  | 'retry_prompt'
  | 'retry_listening'
  | 'retry_transcribing'
  | 'retry_scoring'
  | 'retry_feedback'
  | 'complete';

export interface AudioSessionState {
  phase: AudioSessionPhase;
  scenario: DojoScenario;
  retryCount: number;
  micFallback: boolean; // true if mic unavailable, show text input
}

/** Build the intro speech text from scenario */
export function buildIntroText(scenario: DojoScenario): string {
  return `Here's the situation. ${scenario.context}`;
}

/** Build the prompt speech text from scenario */
export function buildPromptText(scenario: DojoScenario): string {
  return `The buyer says: "${scenario.objection}" — How do you respond?`;
}

/** Build retry prompt text */
export function buildRetryPromptText(feedback: string, practiceCue?: string): string {
  const cue = practiceCue ? ` Focus on this: ${practiceCue}` : '';
  return `Let's try that again.${cue} Give it another shot.`;
}

/** Determine next phase after current completes */
export function nextPhase(current: AudioSessionPhase): AudioSessionPhase {
  switch (current) {
    case 'intro': return 'prompt';
    case 'prompt': return 'listening';
    case 'listening': return 'transcribing';
    case 'transcribing': return 'scoring';
    case 'scoring': return 'feedback';
    case 'retry_prompt': return 'retry_listening';
    case 'retry_listening': return 'retry_transcribing';
    case 'retry_transcribing': return 'retry_scoring';
    case 'retry_scoring': return 'retry_feedback';
    default: return 'complete';
  }
}

/** Check if phase is a speaking phase (Dave talks) */
export function isSpeakingPhase(phase: AudioSessionPhase): boolean {
  return phase === 'intro' || phase === 'prompt' || phase === 'retry_prompt';
}

/** Check if phase is a listening phase (mic active) */
export function isListeningPhase(phase: AudioSessionPhase): boolean {
  return phase === 'listening' || phase === 'retry_listening';
}

/** Check if phase is a processing phase (show loading) */
export function isProcessingPhase(phase: AudioSessionPhase): boolean {
  return phase === 'transcribing' || phase === 'scoring' ||
         phase === 'retry_transcribing' || phase === 'retry_scoring';
}

/** Check if phase is a feedback phase */
export function isFeedbackPhase(phase: AudioSessionPhase): boolean {
  return phase === 'feedback' || phase === 'retry_feedback';
}
