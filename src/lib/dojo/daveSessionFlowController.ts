/**
 * Dave Session Flow Controller — Audio-First Session Orchestrator
 *
 * Central controller that owns the FULL session lifecycle in audio-first mode.
 * Dave sequences every step: intro → context → objection → instruction →
 * auto-record → feedback → retry. No screen interaction required.
 *
 * Delegates to:
 * - daveVoiceRuntime.ts for TTS/STT
 * - audioScenarioScript.ts for verbal scripts
 * - audioSessionFlow.ts for phase state machine
 *
 * This controller is deterministic: given a scenario and config, it produces
 * a complete hands-free training session.
 */

import type { DojoScenario } from './scenarios';
import type { DojoScoreResult } from './types';
import type { TtsConfig, ActivePlayback, SpeechQueueItem } from '@/lib/daveVoiceRuntime';
import { speak, listen, speakQueue, interruptSpeech } from '@/lib/daveVoiceRuntime';
import { buildAudioScript, buildRetryScript, buildFeedbackScript } from './audioScenarioScript';
import {
  type AudioSessionPhase,
  nextPhase,
  isSpeakingPhase,
  isListeningPhase,
  isProcessingPhase,
  isFeedbackPhase,
} from './audioSessionFlow';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveSessionFlowController');

// ── Configuration ──────────────────────────────────────────────────

export interface SessionFlowConfig {
  scenario: DojoScenario;
  ttsConfig: TtsConfig;
  playbackRef: React.MutableRefObject<ActivePlayback>;

  /** Score the user's spoken response — returns scoring result */
  onScore: (transcript: string) => Promise<DojoScoreResult>;

  /** Called on every phase transition */
  onPhaseChange?: (phase: AudioSessionPhase) => void;

  /** Called with state patches for UI sync (optional in audio-first) */
  onStateChange?: (patch: Record<string, unknown>) => void;

  /** Called when a rep is complete (score + transcript) */
  onRepComplete?: (result: DojoScoreResult, transcript: string, isRetry: boolean) => void;

  /** Called when the full session (including retries) is done */
  onSessionComplete?: () => void;

  /** Max retries before session ends */
  maxRetries?: number;

  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

// ── Session State ──────────────────────────────────────────────────

export interface SessionFlowState {
  phase: AudioSessionPhase;
  retryCount: number;
  lastScore: DojoScoreResult | null;
  lastTranscript: string;
  aborted: boolean;
}

// ── Main Controller ────────────────────────────────────────────────

/**
 * Run a complete audio-first Dojo session.
 *
 * This is the top-level entry point. It:
 * 1. Speaks the full scenario intro (intro → context → objection → instruction)
 * 2. Auto-activates the mic
 * 3. Transcribes + scores the response
 * 4. Delivers verbal feedback
 * 5. Auto-retries if score < threshold (up to maxRetries)
 * 6. Completes the session
 *
 * The user NEVER needs to touch the screen.
 */
export async function runAudioFirstSession(config: SessionFlowConfig): Promise<SessionFlowState> {
  const maxRetries = config.maxRetries ?? 2;
  const script = buildAudioScript(config.scenario);

  const state: SessionFlowState = {
    phase: 'intro',
    retryCount: 0,
    lastScore: null,
    lastTranscript: '',
    aborted: false,
  };

  const setPhase = (phase: AudioSessionPhase) => {
    state.phase = phase;
    config.onPhaseChange?.(phase);
    config.onStateChange?.({ phase });
    logger.info('Phase transition', { phase, retry: state.retryCount });
  };

  const isAborted = () => config.signal?.aborted || state.aborted;

  // ── Phase 1: Intro ─────────────────────────────────────────────
  setPhase('intro');
  await speakText(script.intro, config);
  if (isAborted()) return abort(state);

  // ── Phase 2: Context + Objection (Prompt) ──────────────────────
  setPhase('prompt');
  await speakSequence([
    { text: script.context, pauseAfter: 800 },
    { text: script.objection, pauseAfter: 600 },
  ], config);
  if (isAborted()) return abort(state);

  // ── Phase 3: Instruction (explicit verbal cue) ─────────────────
  setPhase('instruction');
  await speakText(script.instruction, config);
  if (isAborted()) return abort(state);

  // ── Phase 4: Listen (mic auto-activates) ───────────────────────
  setPhase('listening');
  const transcript = await listenForResponse(config);
  if (isAborted()) return abort(state);

  state.lastTranscript = transcript;

  // ── Phase 5: Transcribing → Scoring ────────────────────────────
  setPhase('scoring');
  const scoreResult = await scoreResponse(transcript, config);
  if (isAborted()) return abort(state);

  state.lastScore = scoreResult;

  // ── Phase 6: Feedback ──────────────────────────────────────────
  setPhase('feedback');
  await deliverFeedback(scoreResult, config);
  if (isAborted()) return abort(state);

  config.onRepComplete?.(scoreResult, transcript, false);

  // ── Phase 7-8: Auto Retry Loop ─────────────────────────────────
  const score = scoreResult.score ?? 0;
  let retryCount = 0;

  while (score < 7 && retryCount < maxRetries && !isAborted()) {
    retryCount++;
    state.retryCount = retryCount;

    const retryScript = buildRetryScript(scoreResult.topMistake ?? undefined);

    // Retry prompt
    setPhase('retry_prompt');
    await speakText(retryScript.retryPrompt, config);
    if (isAborted()) return abort(state);

    // Retry instruction
    setPhase('retry_instruction');
    await speakText(retryScript.retryInstruction, config);
    if (isAborted()) return abort(state);

    // Retry listen
    setPhase('retry_listening');
    const retryTranscript = await listenForResponse(config);
    if (isAborted()) return abort(state);

    state.lastTranscript = retryTranscript;

    // Retry scoring
    setPhase('retry_scoring');
    const retryScore = await scoreResponse(retryTranscript, config);
    if (isAborted()) return abort(state);

    state.lastScore = retryScore;

    // Retry feedback
    setPhase('retry_feedback');
    await deliverFeedback(retryScore, config);
    if (isAborted()) return abort(state);

    config.onRepComplete?.(retryScore, retryTranscript, true);

    // Check if improved enough to stop retrying
    const retryScoreVal = retryScore.score ?? 0;
    if (retryScoreVal >= 7) break;
  }

  // ── Complete ───────────────────────────────────────────────────
  setPhase('complete');

  // Closing remark
  const closingText = buildClosingRemark(state);
  await speakText(closingText, config);

  config.onSessionComplete?.();
  return state;
}

// ── Internal Helpers ───────────────────────────────────────────────

async function speakText(
  text: string,
  config: SessionFlowConfig,
): Promise<void> {
  try {
    config.playbackRef.current = await speak(
      text,
      config.ttsConfig,
      config.playbackRef.current,
    );
  } catch (err) {
    logger.warn('TTS failed, continuing without voice', { error: err });
    // In audio-first, TTS failure is critical but we degrade gracefully
    config.onStateChange?.({ ttsError: true });
  }
}

async function speakSequence(
  items: SpeechQueueItem[],
  config: SessionFlowConfig,
): Promise<void> {
  await speakQueue(items, config.ttsConfig, config.playbackRef, {
    signal: config.signal,
  });
}

async function listenForResponse(
  config: SessionFlowConfig,
): Promise<string> {
  try {
    const transcript = await listen(config.ttsConfig, {
      timeoutMs: 60_000, // 60s for practice responses
      signal: config.signal,
    });
    config.onStateChange?.({ lastTranscript: transcript });
    return transcript;
  } catch (err) {
    logger.error('STT failed', { error: err });
    config.onStateChange?.({ sttError: true });
    return '';
  }
}

async function scoreResponse(
  transcript: string,
  config: SessionFlowConfig,
): Promise<DojoScoreResult> {
  try {
    return await config.onScore(transcript);
  } catch (err) {
    logger.error('Scoring failed', { error: err });
    return {
      score: 0,
      feedback: 'Scoring temporarily unavailable.',
      topMistake: '',
      improvedVersion: '',
      worldClassResponse: '',
      whyItWorks: [],
      moveSequence: [],
      patternTags: [],
      focusPattern: '',
      focusReason: '',
      practiceCue: '',
      teachingNote: '',
      deltaNote: '',
    };
  }
}

async function deliverFeedback(
  result: DojoScoreResult,
  config: SessionFlowConfig,
): Promise<void> {
  const segments = buildFeedbackScript(result);
  const items: SpeechQueueItem[] = segments.map((text, i) => ({
    text,
    pauseAfter: i < segments.length - 1 ? 500 : 800,
  }));
  await speakSequence(items, config);
}

function buildClosingRemark(state: SessionFlowState): string {
  const score = state.lastScore?.score ?? 0;
  if (state.retryCount > 0 && score >= 7) {
    return "Nice — you leveled up on that retry. That's the work. Let's keep building.";
  }
  if (score >= 8) {
    return "Strong rep. You're dialed in.";
  }
  if (score >= 6) {
    return "Good work. Keep sharpening that edge.";
  }
  return "We'll keep working on this. Every rep counts.";
}

function abort(state: SessionFlowState): SessionFlowState {
  state.aborted = true;
  state.phase = 'complete';
  return state;
}
