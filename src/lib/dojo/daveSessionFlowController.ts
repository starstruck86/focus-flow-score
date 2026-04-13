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
 * Entry points:
 * - runAudioFirstDojoSession() — practice reps with scoring
 * - runAudioFirstLearnSession() — lesson teaching with application
 */

import type { DojoScenario } from './scenarios';
import type { DojoScoreResult } from './types';
import type { TtsConfig, ActivePlayback, SpeechQueueItem } from '@/lib/daveVoiceRuntime';
import {
  type AudioFirstContext,
  type InterruptionCommand,
  type SessionRecap,
  speakStrict,
  speakQueueStrict,
  listenStrict,
  interruptPlayback,
  buildSessionRecapSpeech,
  AudioFirstSessionError,
} from '@/lib/daveAudioFirstRuntime';
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
  onError?: (error: AudioFirstSessionError) => void;
  maxRetries?: number;
  signal?: AbortSignal;
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
 * Run a complete audio-first Dojo session.
 * Fully hands-free: intro → context → what good sounds like →
 * evaluation criteria → objection → instruction → auto-record →
 * feedback → auto-retry → recap.
 */
export async function runAudioFirstDojoSession(config: DojoSessionConfig): Promise<DojoSessionResult> {
  const maxRetries = config.maxRetries ?? 2;
  const script = buildAudioScript(config.scenario);
  const ctx: AudioFirstContext = {
    ttsConfig: config.ttsConfig,
    playbackRef: config.playbackRef,
    signal: config.signal,
    onStateChange: config.onStateChange,
  };

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
    config.onPhaseChange?.(phase);
    config.onStateChange?.({ phase });
  };

  try {
    // ── Phase 1: Intro ───────────────────────────────────────
    setPhase('intro');
    await speakStrict(script.intro, ctx);
    if (ctx.signal?.aborted) return abort(result);

    // ── Phase 2: Context + What Good Sounds Like + Evaluation Criteria + Objection
    setPhase('prompt');
    await speakQueueStrict([
      { text: script.context, pauseAfter: 800 },
      { text: script.whatGoodSoundsLike, pauseAfter: 600 },
      { text: script.evaluationCriteria, pauseAfter: 600 },
      { text: script.objection, pauseAfter: 600 },
    ], ctx);
    if (ctx.signal?.aborted) return abort(result);

    // ── Phase 3: Instruction (explicit verbal cue) ───────────
    setPhase('instruction');
    await speakStrict(script.instruction, ctx);
    if (ctx.signal?.aborted) return abort(result);

    // ── Phase 4: Listen ──────────────────────────────────────
    setPhase('listening');
    const listenResult = await listenStrict(ctx, {
      timeoutMs: 60_000,
      requireResponse: true,
      retryOnSilence: 1,
    });

    // Handle interruption commands during listening
    if (listenResult.command) {
      const handled = await handleInterruption(listenResult.command, ctx, result, config);
      if (handled) return result;
    }

    if (ctx.signal?.aborted) return abort(result);
    result.lastTranscript = listenResult.transcript;

    // ── Phase 5: Scoring ─────────────────────────────────────
    setPhase('scoring');
    config.onStateChange?.({ isProcessing: true });
    const scoreResult = await config.onScore(listenResult.transcript);
    config.onStateChange?.({ isProcessing: false });
    if (ctx.signal?.aborted) return abort(result);
    result.lastScore = scoreResult;

    // ── Phase 6: Feedback ────────────────────────────────────
    setPhase('feedback');
    await deliverFeedback(scoreResult, ctx);
    if (ctx.signal?.aborted) return abort(result);

    config.onRepComplete?.(scoreResult, listenResult.transcript, false);

    // ── Phase 7+: Auto Retry Loop ────────────────────────────
    const score = scoreResult.score ?? 0;
    let retryCount = 0;
    let latestScore = scoreResult;

    while (score < 7 && retryCount < maxRetries && !ctx.signal?.aborted) {
      retryCount++;
      result.retryCount = retryCount;

      const retryScript = buildRetryScript(latestScore.practiceCue || latestScore.topMistake);

      // Retry prompt (NEVER skipped)
      setPhase('retry_prompt');
      await speakStrict(retryScript.retryPrompt, ctx);
      if (ctx.signal?.aborted) return abort(result);

      // Retry instruction (NEVER skipped)
      setPhase('retry_instruction');
      await speakStrict(retryScript.retryInstruction, ctx);
      if (ctx.signal?.aborted) return abort(result);

      // Retry listen
      setPhase('retry_listening');
      const retryListen = await listenStrict(ctx, {
        timeoutMs: 60_000,
        requireResponse: true,
        retryOnSilence: 1,
      });

      if (retryListen.command === 'stop') return abort(result);
      if (ctx.signal?.aborted) return abort(result);

      result.lastTranscript = retryListen.transcript;

      // Retry scoring
      setPhase('retry_scoring');
      config.onStateChange?.({ isProcessing: true });
      latestScore = await config.onScore(retryListen.transcript);
      config.onStateChange?.({ isProcessing: false });
      if (ctx.signal?.aborted) return abort(result);
      result.lastScore = latestScore;

      // Retry feedback
      setPhase('retry_feedback');
      await deliverFeedback(latestScore, ctx);
      if (ctx.signal?.aborted) return abort(result);

      config.onRepComplete?.(latestScore, retryListen.transcript, true);

      if ((latestScore.score ?? 0) >= 7) break;
    }

    // ── Recap + Complete ─────────────────────────────────────
    setPhase('complete');
    const recap = buildDojoRecap(result);
    result.recap = recap;
    await speakQueueStrict(buildSessionRecapSpeech(recap), ctx);

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
  /** Grade the user's application response */
  onGrade?: (response: string) => Promise<{ feedback: string; score: number }>;
  onPhaseChange?: (phase: LearnSessionPhase) => void;
  onStateChange?: (patch: Record<string, unknown>) => void;
  onComplete?: (recap: SessionRecap) => void;
  onError?: (error: AudioFirstSessionError) => void;
  /** Optional example response to speak before asking the user */
  exampleResponse?: string;
  signal?: AbortSignal;
}

export interface LearnSessionResult {
  phase: LearnSessionPhase;
  userResponse: string;
  gradeFeedback: string;
  gradeScore: number;
  aborted: boolean;
  recap: SessionRecap | null;
}

/**
 * Run a complete audio-first Learn session.
 * Fully hands-free: intro → concept → what good looks like → breakdown →
 * when to use → when to avoid → expected response framing → (example) →
 * application prompt → auto-record → grade → feedback → recap.
 */
export async function runAudioFirstLearnSession(config: LearnSessionConfig): Promise<LearnSessionResult> {
  const script = buildAudioLessonScript(config.lesson);
  if (config.exampleResponse) {
    script.exampleResponse = config.exampleResponse;
  }

  const ctx: AudioFirstContext = {
    ttsConfig: config.ttsConfig,
    playbackRef: config.playbackRef,
    signal: config.signal,
    onStateChange: config.onStateChange,
  };

  const result: LearnSessionResult = {
    phase: 'intro',
    userResponse: '',
    gradeFeedback: '',
    gradeScore: 0,
    aborted: false,
    recap: null,
  };

  const setPhase = (phase: LearnSessionPhase) => {
    result.phase = phase;
    config.onPhaseChange?.(phase);
    config.onStateChange?.({ phase });
  };

  try {
    // ── Intro ────────────────────────────────────────────────
    setPhase('intro');
    await speakStrict(script.intro, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Concept ──────────────────────────────────────────────
    setPhase('concept');
    await speakStrict(script.concept, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── What Good Looks Like ─────────────────────────────────
    setPhase('what_good_looks_like');
    await speakStrict(script.whatGoodLooksLike, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Breakdown ────────────────────────────────────────────
    setPhase('breakdown');
    await speakStrict(script.breakdown, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── When to Use ──────────────────────────────────────────
    setPhase('when_to_use');
    await speakStrict(script.whenToUse, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── When to Avoid ────────────────────────────────────────
    setPhase('when_to_avoid');
    await speakStrict(script.whenToAvoid, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Expected Response Framing ────────────────────────────
    setPhase('expected_response_framing');
    await speakStrict(script.expectedResponseFraming, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Example Response (optional) ──────────────────────────
    if (script.exampleResponse) {
      setPhase('example_response');
      await speakStrict(
        `Here's an example of what a strong response sounds like: ${script.exampleResponse}`,
        ctx,
      );
      if (ctx.signal?.aborted) return abortLearn(result);
    }

    // ── Application Prompt ───────────────────────────────────
    setPhase('application_prompt');
    await speakStrict(script.applicationPrompt, ctx);
    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Listen ───────────────────────────────────────────────
    setPhase('listening');
    const listenResult = await listenStrict(ctx, {
      timeoutMs: 60_000,
      requireResponse: false,
      retryOnSilence: 1,
    });

    if (listenResult.command === 'stop') return abortLearn(result);
    if (listenResult.command === 'skip') {
      // Skip application but still do recap
      setPhase('recap');
      const recap = buildLearnRecap(result, config.lesson.topic);
      result.recap = recap;
      await speakQueueStrict(buildSessionRecapSpeech(recap), ctx);
      setPhase('complete');
      config.onComplete?.(recap);
      return result;
    }

    if (ctx.signal?.aborted) return abortLearn(result);
    result.userResponse = listenResult.transcript;

    // ── Grading ──────────────────────────────────────────────
    if (config.onGrade && listenResult.transcript.trim()) {
      setPhase('grading');
      config.onStateChange?.({ isProcessing: true });
      const gradeResult = await config.onGrade(listenResult.transcript);
      config.onStateChange?.({ isProcessing: false });
      result.gradeFeedback = gradeResult.feedback;
      result.gradeScore = gradeResult.score;

      // ── Feedback ─────────────────────────────────────────
      setPhase('feedback');
      await speakStrict(gradeResult.feedback, ctx);
    }

    if (ctx.signal?.aborted) return abortLearn(result);

    // ── Recap ────────────────────────────────────────────────
    setPhase('recap');
    const recap = buildLearnRecap(result, config.lesson.topic);
    result.recap = recap;
    await speakQueueStrict(buildSessionRecapSpeech(recap), ctx);

    // ── Handoff ──────────────────────────────────────────────
    setPhase('handoff');
    await speakStrict(
      "Good — now let's put this into practice. I'm going to give you a scenario. Respond like you would on a real call.",
      ctx,
    );

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
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════

async function deliverFeedback(
  scoreResult: DojoScoreResult,
  ctx: AudioFirstContext,
): Promise<void> {
  const segments = buildFeedbackScript(scoreResult);
  const items: SpeechQueueItem[] = segments.map((text, i) => ({
    text,
    pauseAfter: i < segments.length - 1 ? 500 : 800,
  }));
  await speakQueueStrict(items, ctx);
}

async function handleInterruption(
  command: InterruptionCommand,
  ctx: AudioFirstContext,
  result: DojoSessionResult,
  config: DojoSessionConfig,
): Promise<boolean> {
  switch (command) {
    case 'stop':
      result.aborted = true;
      result.phase = 'complete';
      await speakStrict("Got it. Ending session.", ctx);
      return true;
    case 'repeat':
      // Caller should re-run the current phase — return false to continue flow
      return false;
    case 'pause':
      await speakStrict("Paused. Say 'go ahead' when you're ready.", ctx);
      // Wait for resume command
      const resumed = await listenStrict(ctx, { timeoutMs: 120_000 });
      if (resumed.command === 'stop') {
        result.aborted = true;
        result.phase = 'complete';
        return true;
      }
      return false;
    default:
      return false;
  }
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
  // Extract the most actionable sentence from grading feedback
  const sentences = feedback.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const improvementSentence = sentences.find(s =>
    /improve|missing|need|should|could|try|focus|work on/i.test(s)
  );
  return improvementSentence?.trim() ?? sentences[0]?.trim() ?? '';
}
