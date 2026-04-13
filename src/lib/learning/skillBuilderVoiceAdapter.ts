/**
 * Skill Builder Voice Adapter
 *
 * Converts structured Skill Builder sessions (mental model + KI blocks + reps)
 * into a voice-driven training flow powered by Dave's shared runtime.
 *
 * Pacing: slower than Dojo, more explanation, repetition allowed.
 *
 * Does NOT contain audio logic — delegates to daveVoiceRuntime.
 */

import type { SpeechQueueItem, TurnConfig, VoiceSession, TtsConfig, ActivePlayback } from '@/lib/daveVoiceRuntime';
import {
  speakQueue,
  runTurn,
  createVoiceSession,
  logTranscript,
  parseVoiceCommand,
} from '@/lib/daveVoiceRuntime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SkillBuilderVoiceAdapter');

// ── Block Types ────────────────────────────────────────────────────

export type SkillBuilderBlockType =
  | 'mental_model'
  | 'ki_explanation'
  | 'rep'
  | 'coaching_snippet'
  | 'recap';

export interface SkillBuilderBlock {
  type: SkillBuilderBlockType;
  /** Text content for narration blocks */
  text?: string;
  /** Title for display/logging */
  title?: string;
  /** For rep blocks: the scenario prompt */
  scenarioPrompt?: string;
  /** For rep blocks: handler to process user response */
  onResponse?: (transcript: string) => Promise<string>;
}

// ── Content Formatting ─────────────────────────────────────────────

function formatMentalModel(text: string): SpeechQueueItem[] {
  // Split into digestible sentences for slower pacing
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const items: SpeechQueueItem[] = [];

  for (let i = 0; i < sentences.length; i++) {
    items.push({
      text: sentences[i].trim(),
      pauseAfter: 1000, // Slower pacing for comprehension
    });
  }

  return items;
}

function formatKiExplanation(text: string): SpeechQueueItem[] {
  return [
    { text: `Here's the key insight. ${text}`, pauseAfter: 1200 },
  ];
}

function formatCoachingSnippet(text: string): SpeechQueueItem[] {
  return [
    { text, pauseAfter: 800 },
  ];
}

function formatRecap(text: string): SpeechQueueItem[] {
  return [
    { text: `Let's recap. ${text}`, pauseAfter: 1000 },
  ];
}

// ── Session Flow ───────────────────────────────────────────────────

export interface SkillBuilderVoiceSessionConfig {
  blocks: SkillBuilderBlock[];
  sessionTitle: string;
  ttsConfig: TtsConfig;
  playbackRef: { current: ActivePlayback };
  onBlockStart?: (index: number, block: SkillBuilderBlock) => void;
  onBlockEnd?: (index: number) => void;
  onRepComplete?: (index: number, transcript: string, feedback: string) => void;
  onStateChange?: (patch: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

/**
 * Run a complete Skill Builder session via voice.
 * Iterates through blocks: narration, explanation, reps, coaching.
 */
export async function runSkillBuilderVoiceSession(
  config: SkillBuilderVoiceSessionConfig,
): Promise<VoiceSession> {
  let session = createVoiceSession('skill_builder');

  // Session intro
  await speakQueue(
    [
      { text: `Let's begin. ${config.sessionTitle}.`, pauseAfter: 1000 },
      { text: "I'll walk you through the concept, then we'll practice.", pauseAfter: 800 },
    ],
    config.ttsConfig,
    config.playbackRef,
    { signal: config.signal },
  );

  session = logTranscript(session, 'dave', `Let's begin. ${config.sessionTitle}.`);

  for (let i = 0; i < config.blocks.length; i++) {
    if (config.signal?.aborted) break;

    const block = config.blocks[i];
    config.onBlockStart?.(i, block);
    config.onStateChange?.({ currentBlock: i, blockType: block.type });

    switch (block.type) {
      case 'mental_model': {
        if (!block.text) break;
        const items = formatMentalModel(block.text);
        await speakQueue(items, config.ttsConfig, config.playbackRef, {
          signal: config.signal,
        });
        for (const item of items) {
          session = logTranscript(session, 'dave', item.text);
        }
        break;
      }

      case 'ki_explanation': {
        if (!block.text) break;
        const items = formatKiExplanation(block.text);
        await speakQueue(items, config.ttsConfig, config.playbackRef, {
          signal: config.signal,
        });
        for (const item of items) {
          session = logTranscript(session, 'dave', item.text);
        }
        break;
      }

      case 'rep': {
        if (!block.scenarioPrompt || !block.onResponse) break;
        config.onStateChange?.({ phase: 'rep' });

        const turnResult = await runTurn(
          {
            prompt: block.scenarioPrompt,
            onUserResponse: block.onResponse,
          },
          config.ttsConfig,
          config.playbackRef,
          (patch) => config.onStateChange?.(patch),
        );

        session = logTranscript(session, 'dave', block.scenarioPrompt);
        session = logTranscript(session, 'user', turnResult.transcript);
        session = logTranscript(session, 'dave', turnResult.feedback);

        // Handle commands
        if (turnResult.command === 'stop') {
          config.signal = undefined; // break loop
          break;
        }
        if (turnResult.command === 'retry') {
          i--; // repeat this block
          continue;
        }

        config.onRepComplete?.(i, turnResult.transcript, turnResult.feedback);
        break;
      }

      case 'coaching_snippet': {
        if (!block.text) break;
        const items = formatCoachingSnippet(block.text);
        await speakQueue(items, config.ttsConfig, config.playbackRef, {
          signal: config.signal,
        });
        for (const item of items) {
          session = logTranscript(session, 'dave', item.text);
        }
        break;
      }

      case 'recap': {
        if (!block.text) break;
        const items = formatRecap(block.text);
        await speakQueue(items, config.ttsConfig, config.playbackRef, {
          signal: config.signal,
        });
        for (const item of items) {
          session = logTranscript(session, 'dave', item.text);
        }
        break;
      }
    }

    config.onBlockEnd?.(i);
    session = { ...session, position: i + 1 };

    // Inter-block pause (generous for Skill Builder)
    if (i < config.blocks.length - 1 && !config.signal?.aborted) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // Session outro
  if (!config.signal?.aborted) {
    await speakQueue(
      [{ text: "Good work. That's the end of this session.", pauseAfter: 0 }],
      config.ttsConfig,
      config.playbackRef,
    );
    session = logTranscript(session, 'dave', "Good work. That's the end of this session.");
  }

  return session;
}
