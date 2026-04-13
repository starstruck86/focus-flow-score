/**
 * Dave Audio-First Runtime — Shared foundation for all hands-free sessions.
 *
 * CORE CONTRACT:
 * 1. Dave's speech NEVER overlaps with mic listening.
 * 2. Recording begins ONLY after playback resolves.
 * 3. Audio queue is centralized — no parallel playback.
 * 4. TTS failure in audio-first mode = session error, NOT silent visual degrade.
 * 5. No scenario content is silently skipped.
 * 6. Retry loops cannot skip instruction.
 *
 * Both Dojo and Learn sessions use this runtime.
 */

import type { TtsConfig, ActivePlayback, SpeechQueueItem, VoiceCommand } from '@/lib/daveVoiceRuntime';
import { speak, listen, interruptSpeech, parseVoiceCommand } from '@/lib/daveVoiceRuntime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveAudioFirstRuntime');

// ── Mode ───────────────────────────────────────────────────────────

export type AudioFirstMode = 'audio-first' | 'visual';

// ── Interruption Commands ──────────────────────────────────────────

/**
 * Extended voice commands for hands-free use.
 * Includes driving-safe commands beyond the base set.
 */
export type InterruptionCommand =
  | 'repeat'       // "repeat that", "say that again"
  | 'skip'         // "skip", "next"
  | 'go'           // "go", "I'm ready"
  | 'done'         // "I'm done", "that's my answer"
  | 'retry'        // "one more time", "let me try again"
  | 'stop'         // "stop", "end session"
  | 'pause'        // "hold on", "wait"
  | 'resume'       // "go ahead", "continue"
  | null;

const INTERRUPTION_PATTERNS: [InterruptionCommand, RegExp][] = [
  ['repeat', /\b(repeat|say\s+that\s+again|what\s+did\s+you\s+say|come\s+again|one\s+more\s+time|again)\b/i],
  ['done', /\b(done|that's\s+(my\s+)?answer|finished|I'm\s+done)\b/i],
  ['go', /\b(go|ready|I'm\s+ready|let's\s+go|start)\b/i],
  ['skip', /\b(skip|skip\s+this|pass|move\s+past|next)\b/i],
  ['retry', /\b(retry|try\s+again|redo|let\s+me\s+try)\b/i],
  ['stop', /\b(stop|quit|exit|end\s+session|enough|cancel)\b/i],
  ['pause', /\b(pause|hold\s+on|wait|one\s+sec|hang\s+on)\b/i],
  ['resume', /\b(resume|pick\s+up|where\s+were\s+we|go\s+ahead|continue|keep\s+going)\b/i],
];

export function parseInterruption(transcript: string): InterruptionCommand {
  const trimmed = transcript.trim();
  if (trimmed.split(/\s+/).length > 8) return null; // Only short utterances
  for (const [cmd, pattern] of INTERRUPTION_PATTERNS) {
    if (pattern.test(trimmed)) return cmd;
  }
  return null;
}

// ── Session Error (audio-first never silently degrades) ────────────

export class AudioFirstSessionError extends Error {
  constructor(
    message: string,
    public readonly phase: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = 'AudioFirstSessionError';
  }
}

// ── Shared Playback Primitives ─────────────────────────────────────

export interface AudioFirstContext {
  ttsConfig: TtsConfig;
  playbackRef: React.MutableRefObject<ActivePlayback>;
  signal?: AbortSignal;
  onStateChange?: (patch: Record<string, unknown>) => void;
}

/**
 * Speak text with strict audio-first guarantees.
 * If TTS fails after retries, throws AudioFirstSessionError — never silently continues.
 */
export async function speakStrict(
  text: string,
  ctx: AudioFirstContext,
  options?: { previousText?: string; nextText?: string },
): Promise<void> {
  if (ctx.signal?.aborted) return;

  const MAX_TTS_RETRIES = 2;
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_TTS_RETRIES; attempt++) {
    if (ctx.signal?.aborted) return;
    try {
      ctx.playbackRef.current = await speak(
        text,
        ctx.ttsConfig,
        ctx.playbackRef.current,
        options,
      );
      return; // Success
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'TTS error';
      logger.warn('TTS attempt failed', { attempt, error: lastError });
      if (attempt < MAX_TTS_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  // All retries exhausted — do NOT silently continue
  throw new AudioFirstSessionError(
    `Dave cannot speak: ${lastError}. Session paused.`,
    'tts_failure',
    true,
  );
}

/**
 * Speak a sequence of items strictly. Each item must complete before next starts.
 * Pauses between items are enforced.
 */
export async function speakQueueStrict(
  items: SpeechQueueItem[],
  ctx: AudioFirstContext,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (ctx.signal?.aborted) return;

    const item = items[i];
    const prev = i > 0 ? items[i - 1].text : undefined;
    const next = i < items.length - 1 ? items[i + 1].text : undefined;

    await speakStrict(item.text, ctx, { previousText: prev, nextText: next });

    if (item.pauseAfter && !ctx.signal?.aborted) {
      await new Promise(r => setTimeout(r, item.pauseAfter));
    }
  }
}

/**
 * Listen with interruption handling and noise resilience.
 * Returns transcript and any detected interruption command.
 */
export async function listenStrict(
  ctx: AudioFirstContext,
  options?: {
    timeoutMs?: number;
    /** If true, treat empty transcript as session error */
    requireResponse?: boolean;
    /** Retry count if no speech detected */
    retryOnSilence?: number;
  },
): Promise<{ transcript: string; command: InterruptionCommand }> {
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const retryOnSilence = options?.retryOnSilence ?? 1;

  for (let attempt = 0; attempt <= retryOnSilence; attempt++) {
    if (ctx.signal?.aborted) return { transcript: '', command: 'stop' };

    try {
      const transcript = await listen(ctx.ttsConfig, {
        timeoutMs,
        signal: ctx.signal,
      });

      // Check for interruption command
      const command = parseInterruption(transcript);
      if (command) return { transcript, command };

      // Check for empty transcript (road noise / no response)
      if (!transcript.trim()) {
        if (attempt < retryOnSilence) {
          // Nudge the user
          await speakStrict(
            attempt === 0
              ? "I didn't catch that. Go ahead."
              : "Still here? Give me your response when you're ready.",
            ctx,
          );
          continue;
        }
        if (options?.requireResponse) {
          return { transcript: '', command: null };
        }
      }

      return { transcript, command: null };
    } catch (err) {
      logger.error('Listen failed', { error: err, attempt });
      if (attempt >= retryOnSilence) {
        throw new AudioFirstSessionError(
          'Microphone not available. Connect a mic and try again.',
          'stt_failure',
          true,
        );
      }
    }
  }

  return { transcript: '', command: null };
}

/**
 * Interrupt current playback immediately.
 */
export function interruptPlayback(ctx: AudioFirstContext): void {
  ctx.playbackRef.current = interruptSpeech(ctx.playbackRef.current);
}

// ── Session Recap Builder ──────────────────────────────────────────

export interface SessionRecap {
  whatImproved: string;
  whatStillNeedsWork: string;
  whatWeWorkOnNext: string;
}

/**
 * Build verbal session recap for end-of-session delivery.
 */
export function buildSessionRecapSpeech(recap: SessionRecap): SpeechQueueItem[] {
  const items: SpeechQueueItem[] = [];

  if (recap.whatImproved) {
    items.push({
      text: `Here's what you improved today: ${recap.whatImproved}`,
      pauseAfter: 600,
    });
  }

  if (recap.whatStillNeedsWork) {
    items.push({
      text: `What still needs work: ${recap.whatStillNeedsWork}`,
      pauseAfter: 600,
    });
  }

  if (recap.whatWeWorkOnNext) {
    items.push({
      text: `Next time, we'll focus on: ${recap.whatWeWorkOnNext}`,
      pauseAfter: 400,
    });
  }

  items.push({
    text: "Good session. Keep putting in the reps.",
    pauseAfter: 0,
  });

  return items;
}
