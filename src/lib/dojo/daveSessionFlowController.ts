/**
 * Dave Session Flow Controller — Audio-First Session Orchestrator
 *
 * Central controller for BOTH Dojo and Learn audio-first sessions.
 * Dave sequences every step. No screen interaction required.
 *
 * CONTRACTS (enforced by daveAudioFirstRuntime):
 * 1. Dave's speech NEVER overlaps with mic listening.
 * 2. Recording begins ONLY after playback resolves.
 * 3. TTS failure = session error, NOT silent visual degrade.
 * 4. No content is silently skipped.
 * 5. Retry loops cannot skip instruction.
 *
 * BARGE-IN: Interruptible phases support mid-playback commands.
 * CHECKPOINT REPLAY: "repeat" replays the active segment deterministically.
 * COMPRESSED LEARN: Shorter driving-safe lesson mode.
 * AUTO HANDOFF: Learn → Dojo chains automatically.
 *
 * Entry points:
 * - runAudioFirstDojoSession() — practice reps with scoring
 * - runAudioFirstLearnSession() — full lesson teaching with application
 * - runCompressedLearnSession() — highway-safe compressed lesson
 */

import type { DojoScenario } from './scenarios';
import type { DojoScoreResult } from './types';
import type { TtsConfig, ActivePlayback, SpeechQueueItem } from '@/lib/daveVoiceRuntime';
import {
  type AudioFirstContext,
  type InterruptionCommand,
  type SessionRecap,
  type BargeInAction,
  type BargeInDetection,
  createAudioFirstContext,
  speakStrict,
  speakQueueStrict,
  speakWithBargeIn,
  listenStrict,
  interruptPlayback,
  waitForPlaybackDrain,
  handleBargeInCommand,
  replayCurrentCheckpoint,
  buildSessionRecapSpeech,
  AudioFirstSessionError,
} from '@/lib/daveAudioFirstRuntime';
import { SessionTelemetryTracker } from '@/lib/daveSessionTelemetry';
import { getDrivingModeConfig, type DrivingMode } from '@/hooks/useDrivingMode';
import { buildAudioScript, buildRetryScript, buildFeedbackScript, buildAudioLessonScript } from './audioScenarioScript';
import type { AudioSessionPhase } from './audioSessionFlow';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveSessionFlowController');

// ══════════════════════════════════════════════════════════════════
// DOJO SESSION
// ══════════════════════════════════════════════════════════════════

export interface DojoSessionConfig {
  scenario: DojoScenario;
  ttsConfig: TtsConfig;
  playbackRef: React.MutableRefObject<ActivePlayback>;
  onScore: (transcript: string) => Promise<DojoScoreResult>;
  onPhaseChange?: (phase: AudioSessionPhase) => void;
  onStateChange?: (patch: Record<string, unknown>) => void;
  onRepComplete?: (result: DojoScoreResult, transcript: string, isRetry: boolean) => void;
  onSessionComplete?: (recap: SessionRecap) => void;
  onHandoffToDojo?: (skillFocus: string) => void;
  onError?: (error: AudioFirstSessionError) => void;
  maxRetries?: number;
  signal?: AbortSignal;
  /** Driving mode for config overrides */
  drivingMode?: DrivingMode;
}

export interface DojoSessionResult {
  phase: AudioSessionPhase;
  retryCount: number;
  lastScore: DojoScoreResult | null;
  lastTranscript: string;
  aborted: boolean;
  recap: SessionRecap | null;
}

/**
 * Run a complete audio-first Dojo session with barge-in support.
 */
export async function runAudioFirstDojoSession(config: DojoSessionConfig): Promise<DojoSessionResult> {
  const maxRetries = config.maxRetries ?? 2;
  const script = buildAudioScript(config.scenario);
  const dm = config.drivingMode ?? 'audio-first';
  const dmConfig = getDrivingModeConfig(dm);
  const ctx = createAudioFirstContext(
    config.ttsConfig, config.playbackRef, config.signal, config.onStateChange,
    {
      drivingMode: dm,
      silenceTimeoutMs: dmConfig.silenceTimeoutMs,
      silenceRetries: dmConfig.silenceRetries,
      bargeInWindowMs: dmConfig.bargeInWindowMs,
    },
  );
  const telemetry = new SessionTelemetryTracker('dojo', 'full', dm);

  const result: DojoSessionResult = {
    phase: 'intro',
    retryCount: 0,
    lastScore: null,
    lastTranscript: '',
    aborted: false,
    recap: null,
  };

  const setPhase = (phase: AudioSessionPhase) => {
    result.phase = phase;
    ctx.currentPhase = phase;
    config.onPhaseChange?.(phase);
    config.onStateChange?.({ phase });
  };

  try {
    // ── Intro (protected) ────────────────────────────────────
    setPhase('intro');
    await speakStrict(script.intro, ctx, { role: 'intro' });
    if (ctx.signal?.aborted) return abort(result);

    // ── Context + Framing (interruptible with barge-in) ──────
    setPhase('prompt');
    const bargeIn = await speakQueueStrict([
      { text: script.context, pauseAfter: 800 },
      { text: script.whatGoodSoundsLike, pauseAfter: 600 },
      { text: script.evaluationCriteria, pauseAfter: 600 },
      { text: script.objection, pauseAfter: 600 },
    ], ctx, { roles: ['context', 'what_good_sounds_like', 'evaluation_criteria', 'objection'] });

    if (bargeIn) {
      const action = await handleBargeInCommand(bargeIn.command, ctx, bargeIn.transcript);
      if (bargeIn.command) telemetry.trackInterruption(bargeIn.command);
      if (action === 'stop') { telemetry.finalize(false); return abort(result); }
      if (action === 'skip') { /* skip to instruction */ }
    }
    if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }

    // ── Instruction (protected) — reinforces what to do ──────
    setPhase('instruction');
    await speakStrict(
      `${script.instruction} Focus on re-anchoring to value. Go.`,
      ctx, { role: 'instruction' },
    );
    if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }

    // ── Listen ───────────────────────────────────────────────
    setPhase('listening');
    const listenResult = await listenStrict(ctx, {
      requireResponse: true,
    });
    telemetry.trackFirstResponse();

    if (listenResult.command) {
      if (listenResult.command) telemetry.trackInterruption(listenResult.command);
      const action = await handleBargeInCommand(listenResult.command, ctx, listenResult.transcript);
      if (action === 'stop') { telemetry.finalize(false); return abort(result); }
      if (action === 'repeat') {
        telemetry.trackInterruption('repeat');
        const reListen = await listenStrict(ctx, { requireResponse: true });
        listenResult.transcript = reListen.transcript;
        listenResult.command = reListen.command;
      }
    }

    if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }
    result.lastTranscript = listenResult.transcript;

    // ── Scoring ──────────────────────────────────────────────
    setPhase('scoring');
    config.onStateChange?.({ isProcessing: true });
    const scoreResult = await config.onScore(listenResult.transcript);
    config.onStateChange?.({ isProcessing: false });
    if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }
    result.lastScore = scoreResult;

    // ── Feedback (interruptible) ─────────────────────────────
    setPhase('feedback');
    const fbBargeIn = await deliverFeedback(scoreResult, ctx);
    if (fbBargeIn) {
      if (fbBargeIn.command) telemetry.trackInterruption(fbBargeIn.command);
      const action = await handleBargeInCommand(fbBargeIn.command, ctx, fbBargeIn.transcript);
      if (action === 'stop') { telemetry.finalize(false); return abort(result); }
    }
    if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }

    config.onRepComplete?.(scoreResult, listenResult.transcript, false);

    // ── Auto Retry Loop ──────────────────────────────────────
    let retryCount = 0;
    let latestScore = scoreResult;
    let currentScore = scoreResult.score ?? 0;

    while (currentScore < 7 && retryCount < maxRetries && !ctx.signal?.aborted) {
      retryCount++;
      result.retryCount = retryCount;
      telemetry.trackRetryLoop();

      const retryScript = buildRetryScript(latestScore.practiceCue || latestScore.topMistake);

      setPhase('retry_prompt');
      const retryBargeIn = await speakWithBargeIn(retryScript.retryPrompt, ctx, { role: 'retry_prompt' });
      if (retryBargeIn) {
        if (retryBargeIn.command) telemetry.trackInterruption(retryBargeIn.command);
        const action = await handleBargeInCommand(retryBargeIn.command, ctx, retryBargeIn.transcript);
        if (action === 'stop') { telemetry.finalize(false); return abort(result); }
        if (action === 'skip') break;
      }
      if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }

      setPhase('retry_instruction');
      await speakStrict(
        `${retryScript.retryInstruction} Let's sharpen that. Go.`,
        ctx, { role: 'retry_instruction' },
      );
      if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }

      setPhase('retry_listening');
      const retryListen = await listenStrict(ctx, {
        requireResponse: true,
      });

      if (retryListen.command === 'stop') { telemetry.finalize(false); return abort(result); }
      if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }

      result.lastTranscript = retryListen.transcript;

      setPhase('retry_scoring');
      config.onStateChange?.({ isProcessing: true });
      latestScore = await config.onScore(retryListen.transcript);
      config.onStateChange?.({ isProcessing: false });
      if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }
      result.lastScore = latestScore;

      setPhase('retry_feedback');
      await deliverFeedback(latestScore, ctx);
      if (ctx.signal?.aborted) { telemetry.finalize(false); return abort(result); }

      config.onRepComplete?.(latestScore, retryListen.transcript, true);
      currentScore = latestScore.score ?? 0;
    }

    // ── Recap + Complete ─────────────────────────────────────
    setPhase('complete');
    ctx.currentPhase = 'recap';
    const recap = buildDojoRecap(result);
    result.recap = recap;
    await speakQueueStrict(buildSessionRecapSpeech(recap), ctx);

    telemetry.setFinalScore(result.lastScore?.score ?? null);
    telemetry.finalize(true);
    config.onSessionComplete?.(recap);
    return result;

  } catch (err) {
    if (err instanceof AudioFirstSessionError) {
      config.onError?.(err);
      logger.error('Audio-first session error', { error: err.message, phase: err.phase });
    } else {
      logger.error('Unexpected session error', { error: err });
    }
    result.aborted = true;
    result.phase = 'complete';
    return result;
  }
}

// ══════════════════════════════════════════════════════════════════
// LEARN SESSION
// ══════════════════════════════════════════════════════════════════

export type LearnSessionPhase =
  | 'intro'
  | 'concept'
  | 'what_good_looks_like'
  | 'breakdown'
  | 'when_to_use'
  | 'when_to_avoid'
  | 'expected_response_framing'
  | 'example_response'
  | 'application_prompt'
  | 'listening'
  | 'grading'
  | 'feedback'
  | 'recap'
  | 'handoff'
  | 'complete';

export type LearnMode = 'full' | 'compressed';

export interface LearnSessionConfig {
  lesson: {
    id: string;
    title: string;
    topic: string;
    lesson_content: {
      concept: string;
      what_good_looks_like: string;
      breakdown: string;
      when_to_use: string;
      when_not_to_use: string;
    };
    quiz_content?: {
      open_ended_prompt?: string;
      rubric?: string;
    } | null;
  };
  ttsConfig: TtsConfig;
  playbackRef: React.MutableRefObject<ActivePlayback>;
  onGrade?: (response: string) => Promise<{ feedback: string; score: number }>;
  onPhaseChange?: (phase: LearnSessionPhase) => void;
  onStateChange?: (patch: Record<string, unknown>) => void;
  onComplete?: (recap: SessionRecap) => void;
  /** When set, auto-chains into a Dojo rep after lesson */
  onHandoffToDojo?: (skillFocus: string) => void;
  onError?: (error: AudioFirstSessionError) => void;
  exampleResponse?: string;
  /** 'full' = all 7 sections; 'compressed' = concept + criteria + prompt (driving mode) */
  mode?: LearnMode;
  signal?: AbortSignal;
}

export interface LearnSessionResult {
  phase: LearnSessionPhase;
  userResponse: string;
  gradeFeedback: string;
  gradeScore: number;
  aborted: boolean;
  recap: SessionRecap | null;
  handedOffToDojo: boolean;
}

/**
 * Run a complete audio-first Learn session.
 * Dispatches to full or compressed mode.
 */
export async function runAudioFirstLearnSession(config: LearnSessionConfig): Promise<LearnSessionResult> {
  const mode = config.mode ?? 'full';
  if (mode === 'compressed') {
    return runCompressedLearnSession(config);
  }
  return runFullLearnSession(config);
}

/**
 * Full Learn session — all lesson sections with barge-in.
 */
async function runFullLearnSession(config: LearnSessionConfig): Promise<LearnSessionResult> {
  const script = buildAudioLessonScript(config.lesson);
  if (config.exampleResponse) script.exampleResponse = config.exampleResponse;

  const ctx = createAudioFirstContext(
    config.ttsConfig, config.playbackRef, config.signal, config.onStateChange,
  );

  const result: LearnSessionResult = {
    phase: 'intro',
    userResponse: '',
    gradeFeedback: '',
    gradeScore: 0,
    aborted: false,
    recap: null,
    handedOffToDojo: false,
  };

  const setPhase = (phase: LearnSessionPhase) => {
    result.phase = phase;
    ctx.currentPhase = phase;
    config.onPhaseChange?.(phase);
    config.onStateChange?.({ phase });
  };

  try {
    // Teaching segments — each interruptible
    const teachingSegments: { phase: LearnSessionPhase; text: string; role: string }[] = [
      { phase: 'intro', text: script.intro, role: 'intro' },
      { phase: 'concept', text: script.concept, role: 'concept' },
      { phase: 'what_good_looks_like', text: script.whatGoodLooksLike, role: 'what_good_looks_like' },
      { phase: 'breakdown', text: script.breakdown, role: 'breakdown' },
      { phase: 'when_to_use', text: script.whenToUse, role: 'when_to_use' },
      { phase: 'when_to_avoid', text: script.whenToAvoid, role: 'when_to_avoid' },
      { phase: 'expected_response_framing', text: script.expectedResponseFraming, role: 'expected_response_framing' },
    ];

    if (script.exampleResponse) {
      teachingSegments.push({
        phase: 'example_response',
        text: `Here's an example of what a strong response sounds like: ${script.exampleResponse}`,
        role: 'example_response',
      });
    }

    for (const seg of teachingSegments) {
      setPhase(seg.phase);
      const bargeIn = await speakWithBargeIn(seg.text, ctx, { role: seg.role });
      if (bargeIn) {
        const action = await handleBargeInCommand(bargeIn.command, ctx, bargeIn.transcript);
        if (action === 'stop') return abortLearn(result);
        if (action === 'skip') continue;
      }
      if (ctx.signal?.aborted) return abortLearn(result);
    }

    // Application prompt (protected)
    setPhase('application_prompt');
    await speakStrict(script.applicationPrompt, ctx, { role: 'application_prompt' });
    if (ctx.signal?.aborted) return abortLearn(result);

    // Listen
    setPhase('listening');
    const listenResult = await listenStrict(ctx, {
      timeoutMs: 60_000,
      requireResponse: false,
      retryOnSilence: 1,
    });

    if (listenResult.command === 'stop') return abortLearn(result);
    if (listenResult.command === 'skip') {
      // Skip to recap
    } else if (listenResult.command === 'repeat') {
      await replayCurrentCheckpoint(ctx);
      // Re-listen after replay
      const reListen = await listenStrict(ctx, { timeoutMs: 60_000 });
      result.userResponse = reListen.transcript;
    } else {
      result.userResponse = listenResult.transcript;
    }

    if (ctx.signal?.aborted) return abortLearn(result);

    // Grading
    if (config.onGrade && result.userResponse.trim()) {
      setPhase('grading');
      config.onStateChange?.({ isProcessing: true });
      const gradeResult = await config.onGrade(result.userResponse);
      config.onStateChange?.({ isProcessing: false });
      result.gradeFeedback = gradeResult.feedback;
      result.gradeScore = gradeResult.score;

      setPhase('feedback');
      await speakWithBargeIn(gradeResult.feedback, ctx, { role: 'feedback' });
    }

    if (ctx.signal?.aborted) return abortLearn(result);

    // Recap
    setPhase('recap');
    const recap = buildLearnRecap(result, config.lesson.topic);
    result.recap = recap;
    await speakQueueStrict(buildSessionRecapSpeech(recap), ctx);

    // Handoff — automatic Learn → Dojo chain (or clean close)
    if (config.onHandoffToDojo) {
      setPhase('handoff');
      await speakStrict(
        "Good — now let's put this into practice. I'm going to give you a scenario. Respond like you would on a real call.",
        ctx,
        { role: 'handoff' },
      );
      // Transfer audio ownership cleanly — the Dojo session will create its own context
      // using the same ttsConfig + playbackRef, so we just signal completion here.
      interruptPlayback(ctx);
      result.handedOffToDojo = true;
      config.onHandoffToDojo(config.lesson.topic);
    } else {
      setPhase('handoff');
      await speakStrict(
        "That wraps up this lesson. Great work today.",
        ctx,
        { role: 'closing' },
      );
    }

    setPhase('complete');
    config.onComplete?.(recap);
    return result;

  } catch (err) {
    if (err instanceof AudioFirstSessionError) {
      config.onError?.(err);
      logger.error('Audio-first learn error', { error: err.message, phase: err.phase });
    } else {
      logger.error('Unexpected learn error', { error: err });
    }
    result.aborted = true;
    result.phase = 'complete';
    return result;
  }
}

// ══════════════════════════════════════════════════════════════════
// COMPRESSED LEARN (DRIVING MODE)
// ══════════════════════════════════════════════════════════════════

/**
 * Compressed Learn session for highway use.
 * Merges concept + what good looks like + criteria into a single tight flow:
 *   1. Quick intro
 *   2. Concept (compressed)
 *   3. Key criteria
 *   4. Prompt → Listen → Feedback
 *   5. Auto handoff to Dojo
 *
 * Total speaking time: ~60–90 seconds before asking user to respond.
 */
async function runCompressedLearnSession(config: LearnSessionConfig): Promise<LearnSessionResult> {
  const content = config.lesson.lesson_content;
  const topic = config.lesson.topic.replace(/_/g, ' ');

  const ctx = createAudioFirstContext(
    config.ttsConfig, config.playbackRef, config.signal, config.onStateChange,
  );

  const result: LearnSessionResult = {
    phase: 'intro',
    userResponse: '',
    gradeFeedback: '',
    gradeScore: 0,
    aborted: false,
    recap: null,
    handedOffToDojo: false,
  };

  const setPhase = (phase: LearnSessionPhase) => {
    result.phase = phase;
    ctx.currentPhase = phase;
    config.onPhaseChange?.(phase);
    config.onStateChange?.({ phase });
  };

  try {
    // ── Compressed intro + concept ───────────────────────────
    setPhase('intro');
    const compressedIntro = `Quick lesson on ${topic}. ${config.lesson.title}.`;
    await speakStrict(compressedIntro, ctx, { role: 'intro' });
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Core concept (interruptible) ─────────────────────────
    setPhase('concept');
    const bargeIn1 = await speakWithBargeIn(content.concept, ctx, { role: 'concept' });
    if (bargeIn1) {
      const action = await handleBargeInCommand(bargeIn1.command, ctx, bargeIn1.transcript);
      if (action === 'stop') return abortLearn(result);
    }
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── What good looks like + criteria (merged, interruptible)
    setPhase('what_good_looks_like');
    const rubric = config.lesson.quiz_content?.rubric;
    const mergedCriteria = rubric
      ? `Here's what I'm looking for: ${rubric}`
      : `Here's what good looks like: ${content.what_good_looks_like}`;
    const bargeIn2 = await speakWithBargeIn(mergedCriteria, ctx, { role: 'criteria' });
    if (bargeIn2) {
      const action = await handleBargeInCommand(bargeIn2.command, ctx, bargeIn2.transcript);
      if (action === 'stop') return abortLearn(result);
    }
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Prompt (protected) ───────────────────────────────────
    setPhase('application_prompt');
    const prompt = config.lesson.quiz_content?.open_ended_prompt
      ?? `Now apply this. Give me your best ${topic} response. Go.`;
    await speakStrict(prompt, ctx, { role: 'application_prompt' });
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Listen ───────────────────────────────────────────────
    setPhase('listening');
    const listenResult = await listenStrict(ctx, {
      timeoutMs: 60_000,
      requireResponse: false,
      retryOnSilence: 1,
    });

    if (listenResult.command === 'stop') return abortLearn(result);
    if (listenResult.command === 'repeat') {
      await replayCurrentCheckpoint(ctx);
      const reListen = await listenStrict(ctx, { timeoutMs: 60_000 });
      result.userResponse = reListen.transcript;
    } else {
      result.userResponse = listenResult.transcript;
    }
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Grade ────────────────────────────────────────────────
    if (config.onGrade && result.userResponse.trim()) {
      setPhase('grading');
      config.onStateChange?.({ isProcessing: true });
      const gradeResult = await config.onGrade(result.userResponse);
      config.onStateChange?.({ isProcessing: false });
      result.gradeFeedback = gradeResult.feedback;
      result.gradeScore = gradeResult.score;

      setPhase('feedback');
      await speakStrict(gradeResult.feedback, ctx, { role: 'feedback' });
    }
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Quick recap ──────────────────────────────────────────
    setPhase('recap');
    const recap = buildLearnRecap(result, config.lesson.topic);
    result.recap = recap;
    // Compressed recap — single sentence
    const quickRecap = recap.whatImproved
      ? `${recap.whatImproved} ${recap.whatStillNeedsWork ? `Work on: ${recap.whatStillNeedsWork}` : ''}`
      : "Let's lock this in with a live rep.";
    await speakStrict(quickRecap, ctx, { role: 'recap' });

    // ── Auto handoff ─────────────────────────────────────────
    if (config.onHandoffToDojo) {
      setPhase('handoff');
      await speakStrict("Let's put this into practice right now. Here comes a scenario.", ctx, { role: 'handoff' });
      interruptPlayback(ctx);
      result.handedOffToDojo = true;
      config.onHandoffToDojo(config.lesson.topic);
    }

    setPhase('complete');
    config.onComplete?.(recap);
    return result;

  } catch (err) {
    if (err instanceof AudioFirstSessionError) {
      config.onError?.(err);
    }
    result.aborted = true;
    result.phase = 'complete';
    return result;
  }
}

// ══════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════

async function deliverFeedback(
  scoreResult: DojoScoreResult,
  ctx: AudioFirstContext,
): Promise<BargeInDetection | null> {
  const segments = buildFeedbackScript(scoreResult);
  const items: SpeechQueueItem[] = segments.map((text, i) => ({
    text,
    pauseAfter: i < segments.length - 1 ? 500 : 800,
  }));
  return speakQueueStrict(items, ctx, {
    roles: segments.map((_, i) => `feedback_${i}`),
  });
}

function abort(result: DojoSessionResult): DojoSessionResult {
  result.aborted = true;
  result.phase = 'complete';
  return result;
}

function abortLearn(result: LearnSessionResult): LearnSessionResult {
  result.aborted = true;
  result.phase = 'complete';
  return result;
}

function buildDojoRecap(result: DojoSessionResult): SessionRecap {
  const score = result.lastScore?.score ?? 0;

  let whatImproved = '';
  if (result.retryCount > 0 && score >= 6) {
    whatImproved = result.lastScore?.focusAppliedReason ?? 'Your retry showed improvement in the focus area.';
  } else if (score >= 7) {
    whatImproved = 'Strong response structure and value framing.';
  }

  const whatStillNeedsWork = result.lastScore?.topMistake ?? '';
  const whatWeWorkOnNext = result.lastScore?.practiceCue ?? result.lastScore?.focusPattern ?? '';

  return { whatImproved, whatStillNeedsWork, whatWeWorkOnNext };
}

function buildLearnRecap(result: LearnSessionResult, topic: string): SessionRecap {
  const score = result.gradeScore;

  let whatImproved = '';
  if (score >= 70) {
    whatImproved = `You showed solid application of ${topic.replace(/_/g, ' ')} concepts.`;
  } else if (score >= 40) {
    whatImproved = "You're building the foundation. The core idea is clicking.";
  }

  const whatStillNeedsWork = score < 70
    ? (result.gradeFeedback ? extractImprovementFromFeedback(result.gradeFeedback) : `Keep practicing ${topic.replace(/_/g, ' ')} application.`)
    : '';

  const whatWeWorkOnNext = `We'll test this in a live rep next to lock it in.`;

  return { whatImproved, whatStillNeedsWork, whatWeWorkOnNext };
}

function extractImprovementFromFeedback(feedback: string): string {
  const sentences = feedback.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const improvementSentence = sentences.find(s =>
    /improve|missing|need|should|could|try|focus|work on/i.test(s)
  );
  return improvementSentence?.trim() ?? sentences[0]?.trim() ?? '';
}
