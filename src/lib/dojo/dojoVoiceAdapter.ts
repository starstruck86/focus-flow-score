/**
 * Dojo Voice Adapter
 *
 * Plugs Dojo practice reps into Dave's shared voice runtime.
 * Provides scenario prompts, processes responses through scoring, formats audio feedback.
 *
 * Does NOT contain audio logic — delegates entirely to daveVoiceRuntime.
 */

import type { TtsConfig, TurnConfig, SpeechQueueItem, VoiceSession } from '@/lib/daveVoiceRuntime';
import { runTurn, speakQueue, createVoiceSession, logTranscript } from '@/lib/daveVoiceRuntime';
import type { ActivePlayback } from '@/lib/daveVoiceRuntime';
import type { DojoScenario } from './scenarios';
import type { DojoScoreResult } from './types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DojoVoiceAdapter');

// ── Feedback Formatting ────────────────────────────────────────────

/**
 * Format scoring result into concise audio-friendly feedback.
 * Rule: short sentences, one idea at a time, no UI labels.
 */
export function formatAudioFeedback(result: DojoScoreResult): SpeechQueueItem[] {
  const items: SpeechQueueItem[] = [];

  // 1. Summary (1 sentence)
  const score = result.score ?? 0;
  const summaryLine = score >= 8
    ? "That was strong."
    : score >= 6
    ? "Solid effort. Let's sharpen a couple things."
    : score >= 4
    ? "There's something to build on here."
    : "Let's work on this together.";

  items.push({ text: summaryLine, pauseAfter: 600 });

  // 2. What worked (1-2 points)
  if (result.feedback) {
    // Extract first positive signal from feedback
    const positiveMatch = result.feedback.match(/(?:strength|well|good|strong)[^.]*\./i);
    if (positiveMatch) {
      items.push({ text: `What worked: ${positiveMatch[0]}`, pauseAfter: 500 });
    }
  }

  // 3. What to improve (1-2 points)
  if (result.top_mistake) {
    items.push({
      text: `Key area to improve: ${result.top_mistake}.`,
      pauseAfter: 500,
    });
  }

  // 4. Improved version (if available)
  if (result.improved_version) {
    items.push({
      text: `Here's how a top rep would say it: ${result.improved_version}`,
      pauseAfter: 800,
    });
  }

  return items;
}

// ── Scenario Introduction ──────────────────────────────────────────

export function buildScenarioIntro(scenario: DojoScenario): SpeechQueueItem[] {
  return [
    { text: `Here's the situation. ${scenario.context}`, pauseAfter: 1000 },
    { text: `The buyer says: "${scenario.objection}". How do you respond?`, pauseAfter: 0 },
  ];
}

// ── Session Flow ───────────────────────────────────────────────────

export interface DojoVoiceSessionConfig {
  scenario: DojoScenario;
  ttsConfig: TtsConfig;
  playbackRef: { current: ActivePlayback };
  onScore: (transcript: string) => Promise<DojoScoreResult>;
  onStateChange?: (patch: Record<string, unknown>) => void;
  onComplete?: (result: DojoScoreResult, transcript: string) => void;
  signal?: AbortSignal;
}

/**
 * Run a complete Dojo rep via voice:
 * 1. Introduce scenario
 * 2. Listen for response
 * 3. Score it
 * 4. Deliver feedback
 */
export async function runDojoVoiceRep(config: DojoVoiceSessionConfig): Promise<{
  session: VoiceSession;
  scoreResult: DojoScoreResult | null;
}> {
  let session = createVoiceSession('dojo');

  // 1. Introduce scenario
  const intro = buildScenarioIntro(config.scenario);
  await speakQueue(intro, config.ttsConfig, config.playbackRef, {
    signal: config.signal,
    onSegmentStart: () => config.onStateChange?.({ phase: 'intro' }),
  });

  for (const item of intro) {
    session = logTranscript(session, 'dave', item.text);
  }

  if (config.signal?.aborted) return { session, scoreResult: null };

  // 2. Run the turn (listen → score → feedback)
  let scoreResult: DojoScoreResult | null = null;

  const turnResult = await runTurn(
    {
      prompt: '', // Prompt already spoken in intro
      onUserResponse: async (transcript) => {
        config.onStateChange?.({ phase: 'scoring' });
        scoreResult = await config.onScore(transcript);
        const feedbackItems = formatAudioFeedback(scoreResult);
        return feedbackItems.map(i => i.text).join(' ');
      },
    },
    config.ttsConfig,
    config.playbackRef,
    (patch) => config.onStateChange?.(patch),
  );

  session = logTranscript(session, 'user', turnResult.transcript);
  session = logTranscript(session, 'dave', turnResult.feedback);

  // 3. Handle commands
  if (turnResult.command === 'retry') {
    config.onStateChange?.({ phase: 'retry_prompt' });
    // Surface handles retry logic
  }

  if (scoreResult) {
    config.onComplete?.(scoreResult, turnResult.transcript);
  }

  return { session, scoreResult };
}
