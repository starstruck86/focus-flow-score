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
 * BARGE-IN IMPLEMENTATION (v1 — post-segment):
 * Current implementation is POST-SEGMENT interruption detection, NOT true
 * live mid-playback barge-in. After each interruptible segment finishes
 * playing, a brief (~1.5s) listen window opens to detect voice commands.
 *
 * True real-time barge-in (stopping Dave mid-sentence) would require:
 * - Always-on VAD running in parallel with TTS playback
 * - Simultaneous audio output + mic monitoring (Web Audio API duplex)
 * - This is a future upgrade tracked separately.
 *
 * PHASE POLICIES:
 * - 'protected': No post-segment listen window. Dave plays through.
 *   Used for: intro, instruction cues, application prompts.
 * - 'interruptible': Post-segment listen window enabled.
 *   Used for: context, breakdown, feedback, recap — longer teaching segments.
 *
 * CHECKPOINT REPLAY:
 * - "repeat" replays the CURRENT (most recently spoken) checkpoint.
 * - Targeted commands ("repeat objection") replay by role name.
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

export type InterruptionCommand =
  | 'repeat'
  | 'skip'
  | 'go'
  | 'done'
  | 'retry'
  | 'stop'
  | 'pause'
  | 'resume'
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
  if (trimmed.split(/\s+/).length > 12) return null;
  for (const [cmd, pattern] of INTERRUPTION_PATTERNS) {
    if (pattern.test(trimmed)) return cmd;
  }
  return null;
}

// ── Targeted Replay Parsing ────────────────────────────────────────

/**
 * Parse targeted replay commands like "repeat objection", "repeat scenario",
 * "repeat rubric", "repeat example". Returns the checkpoint role to replay,
 * or null for a generic "repeat" (replay current).
 */
const TARGETED_REPLAY_PATTERNS: [string, RegExp][] = [
  ['context', /\brepeat\s+(the\s+)?(scenario|context|situation)\b/i],
  ['objection', /\brepeat\s+(the\s+)?(objection|what\s+(the|they)\s+said)\b/i],
  ['what_good_sounds_like', /\brepeat\s+(the\s+)?(rubric|criteria|what\s+good\s+(sounds|looks)\s+like|expectations)\b/i],
  ['example_response', /\brepeat\s+(the\s+)?(example|model\s+answer|sample)\b/i],
  ['concept', /\brepeat\s+(the\s+)?(concept|lesson|teaching)\b/i],
  ['instruction', /\brepeat\s+(the\s+)?(instruction|prompt|question)\b/i],
  ['feedback', /\brepeat\s+(the\s+)?(feedback|coaching|what\s+you\s+said)\b/i],
];

export function parseTargetedReplay(transcript: string): string | null {
  const trimmed = transcript.trim();
  for (const [role, pattern] of TARGETED_REPLAY_PATTERNS) {
    if (pattern.test(trimmed)) return role;
  }
  return null;
}

// ── Barge-In Phase Rules ───────────────────────────────────────────

/**
 * Barge-in behaviour per phase category:
 * - 'protected': Dave ignores user speech. Used for critical instructions
 *   (intro, objection delivery, instruction cues). User must wait.
 * - 'interruptible': Dave stops on user speech, parses command, acts.
 *   Used for context, breakdown, feedback, recap — longer teaching segments.
 */
export type BargeInPolicy = 'protected' | 'interruptible';

const PHASE_BARGE_IN_MAP: Record<string, BargeInPolicy> = {
  // Dojo phases
  intro: 'protected',
  prompt: 'interruptible',
  instruction: 'protected',
  listening: 'protected',
  scoring: 'protected',
  feedback: 'interruptible',
  retry_prompt: 'interruptible',
  retry_instruction: 'protected',
  retry_listening: 'protected',
  retry_feedback: 'interruptible',
  complete: 'protected',

  // Learn phases
  concept: 'interruptible',
  what_good_looks_like: 'interruptible',
  breakdown: 'interruptible',
  when_to_use: 'interruptible',
  when_to_avoid: 'interruptible',
  expected_response_framing: 'interruptible',
  example_response: 'interruptible',
  application_prompt: 'protected',
  grading: 'protected',
  recap: 'interruptible',
  handoff: 'protected',
};

export function getBargeInPolicy(phase: string): BargeInPolicy {
  return PHASE_BARGE_IN_MAP[phase] ?? 'interruptible';
}

// ── Checkpoint Replay ──────────────────────────────────────────────

/**
 * A spoken checkpoint — the text that was last spoken in a given role.
 * Used for deterministic "repeat" commands.
 */
export interface SpokenCheckpoint {
  role: string;
  text: string;
  timestamp: number;
}

export class CheckpointTracker {
  private checkpoints: SpokenCheckpoint[] = [];
  private currentIndex = -1;

  /** Record that we spoke this segment */
  record(role: string, text: string): void {
    this.checkpoints.push({ role, text, timestamp: Date.now() });
    this.currentIndex = this.checkpoints.length - 1;
  }

  /** Get the current (most recently spoken) checkpoint for replay */
  getCurrent(): SpokenCheckpoint | null {
    if (this.currentIndex < 0) return null;
    return this.checkpoints[this.currentIndex];
  }

  /** Get a checkpoint by role (e.g. 'objection', 'what_good_sounds_like') */
  getByRole(role: string): SpokenCheckpoint | null {
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      if (this.checkpoints[i].role === role) return this.checkpoints[i];
    }
    return null;
  }

  /** Reset tracker for new session */
  reset(): void {
    this.checkpoints = [];
    this.currentIndex = -1;
  }
}

// ── Session Error ──────────────────────────────────────────────────

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

// ── Audio-First Context ────────────────────────────────────────────

export interface AudioFirstContext {
  ttsConfig: TtsConfig;
  playbackRef: React.MutableRefObject<ActivePlayback>;
  signal?: AbortSignal;
  onStateChange?: (patch: Record<string, unknown>) => void;
  /** Checkpoint tracker for replay support */
  checkpoints: CheckpointTracker;
  /** Current phase — used for barge-in policy */
  currentPhase?: string;
}

/**
 * Create a fresh AudioFirstContext (call once per session).
 */
export function createAudioFirstContext(
  ttsConfig: TtsConfig,
  playbackRef: React.MutableRefObject<ActivePlayback>,
  signal?: AbortSignal,
  onStateChange?: (patch: Record<string, unknown>) => void,
): AudioFirstContext {
  return {
    ttsConfig,
    playbackRef,
    signal,
    onStateChange,
    checkpoints: new CheckpointTracker(),
  };
}

// ── Speak Strict (with checkpoint recording) ───────────────────────

/**
 * Speak text with strict audio-first guarantees.
 * Records the segment as a checkpoint for replay.
 * If TTS fails after retries, throws AudioFirstSessionError.
 */
export async function speakStrict(
  text: string,
  ctx: AudioFirstContext,
  options?: { previousText?: string; nextText?: string; role?: string },
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
      // Record checkpoint on success
      ctx.checkpoints.record(options?.role ?? ctx.currentPhase ?? 'unknown', text);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'TTS error';
      logger.warn('TTS attempt failed', { attempt, error: lastError });
      if (attempt < MAX_TTS_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw new AudioFirstSessionError(
    `Dave cannot speak: ${lastError}. Session paused.`,
    'tts_failure',
    true,
  );
}

/**
 * Speak with barge-in detection on interruptible phases.
 * On protected phases, behaves identically to speakStrict.
 * On interruptible phases, monitors for user speech during playback.
 *
 * Returns the barge-in command if one was detected, or null.
 */
export async function speakWithBargeIn(
  text: string,
  ctx: AudioFirstContext,
  options?: { role?: string },
): Promise<InterruptionCommand> {
  const policy = getBargeInPolicy(ctx.currentPhase ?? '');

  if (policy === 'protected') {
    await speakStrict(text, ctx, { role: options?.role });
    return null;
  }

  // For interruptible phases: speak, but if user interrupts we catch it
  // The browser SpeechRecognition won't fire during audio playback in most
  // environments, so we rely on post-playback command detection.
  // True real-time barge-in requires always-on VAD which is a future upgrade.
  // For now: speak → brief listen window → check for command.
  await speakStrict(text, ctx, { role: options?.role });

  // Quick listen window (1.5s) for commands after interruptible segments
  if (ctx.signal?.aborted) return null;
  try {
    const quickResult = await listen(ctx.ttsConfig, {
      timeoutMs: 1500,
      signal: ctx.signal,
    });
    if (quickResult.trim()) {
      const cmd = parseInterruption(quickResult);
      if (cmd) {
        logger.info('Barge-in command detected', { command: cmd, phase: ctx.currentPhase });
        return cmd;
      }
    }
  } catch {
    // Timeout / no speech — continue normally
  }
  return null;
}

/**
 * Speak a sequence of items strictly with checkpoint tracking.
 * Each item must complete before next starts.
 * Supports barge-in on interruptible phases.
 *
 * Returns the command that interrupted the queue, or null if completed.
 */
export async function speakQueueStrict(
  items: SpeechQueueItem[],
  ctx: AudioFirstContext,
  options?: { roles?: string[] },
): Promise<InterruptionCommand> {
  for (let i = 0; i < items.length; i++) {
    if (ctx.signal?.aborted) return null;

    const item = items[i];
    const role = options?.roles?.[i] ?? ctx.currentPhase ?? `queue_${i}`;

    const bargeIn = await speakWithBargeIn(item.text, ctx, { role });
    if (bargeIn) return bargeIn;

    if (item.pauseAfter && !ctx.signal?.aborted) {
      await new Promise(r => setTimeout(r, item.pauseAfter));
    }
  }
  return null;
}

/**
 * Replay the current checkpoint — deterministic replay of the last spoken segment.
 */
export async function replayCurrentCheckpoint(ctx: AudioFirstContext): Promise<void> {
  const checkpoint = ctx.checkpoints.getCurrent();
  if (!checkpoint) {
    await speakStrict("Nothing to repeat yet.", ctx);
    return;
  }
  logger.info('Replaying checkpoint', { role: checkpoint.role });
  await speakStrict(checkpoint.text, ctx, { role: checkpoint.role });
}

/**
 * Replay a specific named checkpoint (e.g. 'objection', 'what_good_sounds_like').
 */
export async function replayCheckpointByRole(role: string, ctx: AudioFirstContext): Promise<void> {
  const checkpoint = ctx.checkpoints.getByRole(role);
  if (!checkpoint) {
    await speakStrict(`I don't have that segment to replay.`, ctx);
    return;
  }
  logger.info('Replaying checkpoint by role', { role });
  await speakStrict(checkpoint.text, ctx, { role });
}

// ── Listen Strict ──────────────────────────────────────────────────

/**
 * Listen with interruption handling and noise resilience.
 */
export async function listenStrict(
  ctx: AudioFirstContext,
  options?: {
    timeoutMs?: number;
    requireResponse?: boolean;
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

      const command = parseInterruption(transcript);
      if (command) return { transcript, command };

      if (!transcript.trim()) {
        if (attempt < retryOnSilence) {
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

// ── Interrupt + Playback ───────────────────────────────────────────

export function interruptPlayback(ctx: AudioFirstContext): void {
  ctx.playbackRef.current = interruptSpeech(ctx.playbackRef.current);
}

// ── Barge-In Handler ───────────────────────────────────────────────

/**
 * Central handler for barge-in commands during a session flow.
 * Returns true if the command was fully handled (caller should continue flow),
 * or an action string indicating what the caller should do.
 */
export type BargeInAction =
  | 'continue'    // Command handled, resume normal flow
  | 'repeat'      // Replay current checkpoint, then resume
  | 'skip'        // Skip to next phase
  | 'stop'        // End session
  | 'pause_resume'; // Was paused, now resumed — continue

export async function handleBargeInCommand(
  command: InterruptionCommand,
  ctx: AudioFirstContext,
): Promise<BargeInAction> {
  if (!command) return 'continue';

  switch (command) {
    case 'repeat':
      await replayCurrentCheckpoint(ctx);
      return 'repeat';

    case 'skip':
      await speakStrict("Skipping ahead.", ctx);
      return 'skip';

    case 'stop':
      await speakStrict("Got it. Ending session.", ctx);
      return 'stop';

    case 'pause': {
      await speakStrict("Paused. Say 'go ahead' when you're ready.", ctx);
      const resumed = await listenStrict(ctx, { timeoutMs: 120_000 });
      if (resumed.command === 'stop') return 'stop';
      return 'pause_resume';
    }

    case 'go':
    case 'resume':
    case 'done':
    case 'retry':
    default:
      return 'continue';
  }
}

// ── Session Recap Builder ──────────────────────────────────────────

export interface SessionRecap {
  whatImproved: string;
  whatStillNeedsWork: string;
  whatWeWorkOnNext: string;
}

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
