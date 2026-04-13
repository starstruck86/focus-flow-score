/**
 * Learn Voice Adapter
 *
 * Converts Learn content (KIs, playbooks, mental models) into
 * a coaching stream that Dave delivers via the shared voice runtime.
 *
 * Structure per unit:
 *   concept (20-40s) → example → counterexample → cheat → reflection
 *
 * Does NOT contain audio logic — delegates to daveVoiceRuntime.
 */

import type { SpeechQueueItem, VoiceSession } from '@/lib/daveVoiceRuntime';
import { speakQueue, createVoiceSession, logTranscript, listen, parseVoiceCommand } from '@/lib/daveVoiceRuntime';
import type { TtsConfig, ActivePlayback } from '@/lib/daveVoiceRuntime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('LearnVoiceAdapter');

// ── Content Types ──────────────────────────────────────────────────

export interface LearnAudioUnit {
  /** Short title for the concept */
  title: string;
  /** Core concept explanation (20-40s of speech) */
  concept: string;
  /** Concrete example */
  example?: string;
  /** What NOT to do */
  counterexample?: string;
  /** Quick actionable tip */
  cheat?: string;
  /** Reflection question for the user */
  reflectionQuestion?: string;
}

// ── Content Formatting ─────────────────────────────────────────────

/**
 * Convert a learn unit into a speakable queue.
 * Follows voice UX rules: short sentences, one idea at a time, pauses between.
 */
export function formatLearnUnit(unit: LearnAudioUnit): SpeechQueueItem[] {
  const items: SpeechQueueItem[] = [];

  // Concept (core teaching)
  items.push({ text: unit.concept, pauseAfter: 1200 });

  // Example
  if (unit.example) {
    items.push({
      text: `Here's an example. ${unit.example}`,
      pauseAfter: 1000,
    });
  }

  // Counterexample
  if (unit.counterexample) {
    items.push({
      text: `Now, what NOT to do. ${unit.counterexample}`,
      pauseAfter: 1000,
    });
  }

  // Cheat
  if (unit.cheat) {
    items.push({
      text: `Quick tip: ${unit.cheat}`,
      pauseAfter: 800,
    });
  }

  // Reflection
  if (unit.reflectionQuestion) {
    items.push({
      text: unit.reflectionQuestion,
      pauseAfter: 0, // Will wait for user response if interactive
    });
  }

  return items;
}

// ── Session Flow ───────────────────────────────────────────────────

export interface LearnVoiceSessionConfig {
  units: LearnAudioUnit[];
  ttsConfig: TtsConfig;
  playbackRef: { current: ActivePlayback };
  /** Whether to pause for reflection after each unit */
  interactive?: boolean;
  onUnitStart?: (index: number, title: string) => void;
  onUnitEnd?: (index: number) => void;
  onReflection?: (unitIndex: number, transcript: string) => void;
  onStateChange?: (patch: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

/**
 * Run a Learn coaching stream: deliver units sequentially with optional
 * interactive reflection pauses.
 */
export async function runLearnCoachingStream(config: LearnVoiceSessionConfig): Promise<VoiceSession> {
  let session = createVoiceSession('learn');

  for (let i = 0; i < config.units.length; i++) {
    if (config.signal?.aborted) break;

    const unit = config.units[i];
    config.onUnitStart?.(i, unit.title);
    config.onStateChange?.({ currentUnit: i, phase: 'teaching' });

    // Format and speak the unit
    const queue = formatLearnUnit(unit);
    await speakQueue(queue, config.ttsConfig, config.playbackRef, {
      signal: config.signal,
      onSegmentStart: (si) => config.onStateChange?.({ segment: si }),
    });

    // Log what was spoken
    for (const item of queue) {
      session = logTranscript(session, 'dave', item.text);
    }

    // Interactive reflection pause
    if (config.interactive && unit.reflectionQuestion && !config.signal?.aborted) {
      config.onStateChange?.({ phase: 'reflection', isListening: true });
      try {
        const transcript = await listen(config.ttsConfig, {
          timeoutMs: 20_000,
          signal: config.signal,
        });

        // Check for voice commands
        const cmd = parseVoiceCommand(transcript);
        if (cmd === 'stop') break;
        if (cmd === 'skip') { config.onUnitEnd?.(i); continue; }
        if (cmd === 'repeat') { i--; config.onUnitEnd?.(i); continue; }

        session = logTranscript(session, 'user', transcript);
        config.onReflection?.(i, transcript);
      } catch {
        // STT failure — continue without interaction
        logger.warn('Reflection listen failed, continuing', { unit: i });
      }
      config.onStateChange?.({ isListening: false });
    }

    config.onUnitEnd?.(i);
    session = { ...session, position: i + 1 };

    // Brief pause between units
    if (i < config.units.length - 1 && !config.signal?.aborted) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  return session;
}

// ── Handoff to Dojo ────────────────────────────────────────────────

/**
 * Generate the coaching transition speech when handing off from Learn to Dojo.
 */
export function buildDojoHandoffSpeech(skill: string, subSkill?: string): SpeechQueueItem[] {
  const focus = subSkill ? `${subSkill} within ${skill}` : skill;
  return [
    {
      text: `Good. Now let's put this into practice. We're going to do a live rep focused on ${focus}.`,
      pauseAfter: 800,
    },
    {
      text: "Listen to the scenario, then respond naturally. I'll coach you after.",
      pauseAfter: 0,
    },
  ];
}
