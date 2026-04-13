/**
 * Dave Voice Runtime — Shared Audio OS
 *
 * Single voice interaction layer that powers Dojo, Learn, and Skill Builder.
 * Handles: speaking (TTS), listening (STT), turn lifecycle, voice commands.
 *
 * Surfaces provide content; Dave handles delivery.
 * This file has ZERO coupling to any specific surface.
 */

import { createLogger } from '@/lib/logger';
import { requestMicrophoneAccess, releaseMicrophoneStream } from '@/lib/microphoneAccess';

const logger = createLogger('DaveVoiceRuntime');

// ── Voice Commands ────────────────────────────────────────────────

export type VoiceCommand =
  | 'retry'
  | 'next'
  | 'repeat'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'skip'
  | 'slower'
  | 'faster'
  | null;

const COMMAND_PATTERNS: [VoiceCommand, RegExp][] = [
  ['retry', /\b(retry|try\s+again|redo|one\s+more\s+time|let\s+me\s+try)\b/i],
  ['next', /\b(next|move\s+on|continue|keep\s+going|go\s+on)\b/i],
  ['repeat', /\b(repeat|say\s+that\s+again|what\s+did\s+you\s+say|come\s+again)\b/i],
  ['pause', /\b(pause|hold\s+on|wait|one\s+sec|hang\s+on)\b/i],
  ['resume', /\b(resume|pick\s+up|where\s+were\s+we|go\s+ahead)\b/i],
  ['stop', /\b(stop|quit|exit|done|that's\s+enough|enough|cancel|end\s+session)\b/i],
  ['skip', /\b(skip|skip\s+this|pass|move\s+past)\b/i],
  ['slower', /\b(slower|slow\s+down|too\s+fast)\b/i],
  ['faster', /\b(faster|speed\s+up|hurry|quicker)\b/i],
];

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const trimmed = transcript.trim();
  // Only match commands in short utterances (≤6 words) to avoid false positives
  if (trimmed.split(/\s+/).length > 6) return null;
  for (const [cmd, pattern] of COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) return cmd;
  }
  return null;
}

// ── Voice State ───────────────────────────────────────────────────

export interface DaveVoiceState {
  isSpeaking: boolean;
  isListening: boolean;
  isPaused: boolean;
  isProcessing: boolean;
  lastTranscript: string | null;
  error: string | null;
  /** Current surface using the runtime */
  activeSurface: VoiceSurface | null;
  /** Whether TTS is available (false = text fallback) */
  ttsAvailable: boolean;
  /** Whether STT is available (false = text input fallback) */
  sttAvailable: boolean;
}

export type VoiceSurface = 'dojo' | 'learn' | 'skill_builder' | 'dave_general';

export function createInitialVoiceState(): DaveVoiceState {
  return {
    isSpeaking: false,
    isListening: false,
    isPaused: false,
    isProcessing: false,
    lastTranscript: null,
    error: null,
    activeSurface: null,
    ttsAvailable: true,
    sttAvailable: true,
  };
}

// ── TTS Engine (shared across all surfaces) ────────────────────────

export interface TtsConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  voiceId?: string;
}

const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George
const TTS_FETCH_TIMEOUT_MS = 25_000;
const TTS_MAX_RETRIES = 2;

interface ActivePlayback {
  audio: HTMLAudioElement | null;
  objectUrl: string | null;
  abortController: AbortController | null;
  _cleaned: boolean;
}

function createPlayback(): ActivePlayback {
  return { audio: null, objectUrl: null, abortController: null, _cleaned: false };
}

function cleanupPlayback(p: ActivePlayback): ActivePlayback {
  if (p._cleaned) return createPlayback();
  if (p.abortController) p.abortController.abort();
  if (p.audio) { p.audio.pause(); p.audio.removeAttribute('src'); }
  if (p.objectUrl) URL.revokeObjectURL(p.objectUrl);
  return createPlayback();
}

/**
 * Speak a text segment via ElevenLabs TTS.
 * Returns a promise that resolves when speech completes or rejects on failure.
 */
export async function speak(
  text: string,
  config: TtsConfig,
  playback: ActivePlayback,
  options?: { previousText?: string; nextText?: string },
): Promise<ActivePlayback> {
  const clean = cleanupPlayback(playback);
  const abortController = new AbortController();
  const active: ActivePlayback = { ...clean, abortController, _cleaned: false };

  // Fetch TTS with retry
  let blob: Blob | null = null;
  let lastError = '';

  for (let attempt = 0; attempt <= TTS_MAX_RETRIES; attempt++) {
    if (abortController.signal.aborted) return active;
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));

    const attemptAbort = new AbortController();
    const onOuter = () => attemptAbort.abort();
    abortController.signal.addEventListener('abort', onOuter, { once: true });

    try {
      const body: Record<string, unknown> = {
        text,
        voiceId: config.voiceId ?? DEFAULT_VOICE_ID,
      };
      if (options?.previousText) body.previous_text = options.previousText;
      if (options?.nextText) body.next_text = options.nextText;

      const timeoutId = setTimeout(() => attemptAbort.abort(), TTS_FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(
          `${config.supabaseUrl}/functions/v1/elevenlabs-tts-stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: config.supabaseAnonKey,
              Authorization: `Bearer ${config.supabaseAnonKey}`,
            },
            body: JSON.stringify(body),
            signal: attemptAbort.signal,
          },
        );
      } finally {
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', onOuter);
      }

      if (!response.ok) {
        lastError = `TTS HTTP ${response.status}`;
        continue;
      }
      blob = await response.blob();
      break;
    } catch (err) {
      abortController.signal.removeEventListener('abort', onOuter);
      if (abortController.signal.aborted) return active;
      lastError = err instanceof Error ? err.message : 'TTS fetch error';
    }
  }

  if (!blob) {
    logger.warn('TTS failed after retries', { lastError });
    throw new Error(`TTS failed: ${lastError}`);
  }

  // Play audio
  return new Promise<ActivePlayback>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob!);
    const audio = new Audio(objectUrl);
    active.audio = audio;
    active.objectUrl = objectUrl;

    audio.addEventListener('ended', () => resolve(active), { once: true });
    audio.addEventListener('error', () => {
      const msg = audio.error?.message ?? 'Audio playback error';
      reject(new Error(msg));
    }, { once: true });

    audio.play().catch(err => {
      reject(new Error(err instanceof Error ? err.message : 'play() failed'));
    });
  });
}

/** Stop current speech immediately. */
export function interruptSpeech(playback: ActivePlayback): ActivePlayback {
  return cleanupPlayback(playback);
}

// ── STT Engine (shared across all surfaces) ────────────────────────

export interface ListenOptions {
  timeoutMs?: number;
  /** Abort signal to cancel listening externally */
  signal?: AbortSignal;
}

/**
 * Listen for user speech using browser MediaRecorder + ElevenLabs STT.
 * Returns the transcript string.
 */
export async function listen(
  config: TtsConfig,
  options?: ListenOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  let stream: MediaStream | null = null;

  try {
    stream = await requestMicrophoneAccess();
  } catch (err) {
    throw new Error(`Microphone access failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Blob[] = [];
    const mediaRecorder = new MediaRecorder(stream!, { mimeType: getSupportedMimeType() });

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      mediaRecorder.stop();
      releaseMicrophoneStream(stream);
    };

    // Timeout
    const timer = setTimeout(() => {
      cleanup();
      if (chunks.length > 0) {
        transcribeAudio(new Blob(chunks, { type: mediaRecorder.mimeType }), config)
          .then(resolve)
          .catch(reject);
      } else {
        resolve('');
      }
    }, timeoutMs);

    // External abort
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        cleanup();
        resolve('');
      }, { once: true });
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    // Silence detection via AudioContext analyser
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    const source = audioCtx.createMediaStreamSource(stream!);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let silenceStart = 0;
    const SILENCE_THRESHOLD = 15;
    const SILENCE_DURATION_MS = 1500;

    const checkSilence = () => {
      if (resolved) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;

      if (avg < SILENCE_THRESHOLD) {
        if (silenceStart === 0) silenceStart = Date.now();
        else if (Date.now() - silenceStart > SILENCE_DURATION_MS && chunks.length > 0) {
          clearTimeout(timer);
          cleanup();
          audioCtx.close();
          transcribeAudio(new Blob(chunks, { type: mediaRecorder.mimeType }), config)
            .then(resolve)
            .catch(reject);
          return;
        }
      } else {
        silenceStart = 0;
      }
      requestAnimationFrame(checkSilence);
    };

    mediaRecorder.onstart = () => {
      checkSilence();
    };

    mediaRecorder.start(250); // collect in 250ms chunks
  });
}

function getSupportedMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

async function transcribeAudio(audioBlob: Blob, config: TtsConfig): Promise<string> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  const response = await fetch(
    `${config.supabaseUrl}/functions/v1/elevenlabs-transcribe`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(`STT failed: HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.text ?? '';
}

// ── Turn Lifecycle ────────────────────────────────────────────────

export interface TurnConfig {
  /** Text Dave speaks as a prompt */
  prompt: string;
  /** Handler for user's spoken response — returns Dave's feedback text */
  onUserResponse: (transcript: string) => Promise<string>;
  /** Optional: called before feedback is spoken */
  onFeedbackReady?: (feedback: string) => void;
  /** Previous text for TTS stitching */
  previousText?: string;
}

export interface TurnResult {
  transcript: string;
  feedback: string;
  command: VoiceCommand;
  /** Whether the turn completed normally */
  completed: boolean;
}

/**
 * Execute a complete turn: speak → listen → process → speak feedback.
 * Returns the result. Surfaces call this for each practice rep.
 */
export async function runTurn(
  turn: TurnConfig,
  ttsConfig: TtsConfig,
  playbackRef: { current: ActivePlayback },
  onStateChange?: (patch: Partial<DaveVoiceState>) => void,
): Promise<TurnResult> {
  const update = (p: Partial<DaveVoiceState>) => onStateChange?.(p);

  // 1. Speak prompt
  update({ isSpeaking: true, isListening: false });
  try {
    playbackRef.current = await speak(turn.prompt, ttsConfig, playbackRef.current, {
      previousText: turn.previousText,
    });
  } catch {
    update({ isSpeaking: false, ttsAvailable: false });
    // TTS failed — continue without voice, surface will show text
  }
  update({ isSpeaking: false });

  // 2. Listen
  update({ isListening: true });
  let transcript = '';
  try {
    transcript = await listen(ttsConfig, { timeoutMs: 30_000 });
  } catch {
    update({ isListening: false, sttAvailable: false });
    return { transcript: '', feedback: '', command: null, completed: false };
  }
  update({ isListening: false, lastTranscript: transcript });

  // 3. Check for voice command
  const command = parseVoiceCommand(transcript);
  if (command) {
    return { transcript, feedback: '', command, completed: false };
  }

  // 4. Process response
  update({ isProcessing: true });
  let feedback = '';
  try {
    feedback = await turn.onUserResponse(transcript);
  } catch (err) {
    logger.error('Turn handler failed', { error: err });
    feedback = "I couldn't process that response. Let's try again.";
  }
  update({ isProcessing: false });
  turn.onFeedbackReady?.(feedback);

  // 5. Speak feedback
  update({ isSpeaking: true });
  try {
    playbackRef.current = await speak(feedback, ttsConfig, playbackRef.current, {
      previousText: turn.prompt,
    });
  } catch {
    update({ isSpeaking: false, ttsAvailable: false });
  }
  update({ isSpeaking: false });

  return { transcript, feedback, command: null, completed: true };
}

// ── Speech Queue (for multi-segment narration) ─────────────────────

export interface SpeechQueueItem {
  text: string;
  /** Pause in ms after this segment */
  pauseAfter?: number;
}

/**
 * Speak a sequence of text segments with pauses between them.
 * Used by Learn and Skill Builder for narration flow.
 */
export async function speakQueue(
  items: SpeechQueueItem[],
  ttsConfig: TtsConfig,
  playbackRef: { current: ActivePlayback },
  options?: {
    onSegmentStart?: (index: number) => void;
    onSegmentEnd?: (index: number) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (options?.signal?.aborted) return;

    options?.onSegmentStart?.(i);

    const item = items[i];
    const prev = i > 0 ? items[i - 1].text : undefined;
    const next = i < items.length - 1 ? items[i + 1].text : undefined;

    try {
      playbackRef.current = await speak(item.text, ttsConfig, playbackRef.current, {
        previousText: prev,
        nextText: next,
      });
    } catch {
      // TTS failed — skip but don't break the queue
      logger.warn('Speech queue segment failed', { index: i });
    }

    options?.onSegmentEnd?.(i);

    if (item.pauseAfter && !options?.signal?.aborted) {
      await new Promise(r => setTimeout(r, item.pauseAfter));
    }
  }
}

// ── Session Management ────────────────────────────────────────────

export interface VoiceSession {
  id: string;
  surface: VoiceSurface;
  startedAt: number;
  /** Transcript log for continuity across mode switches */
  transcriptLog: Array<{ role: 'dave' | 'user'; text: string; timestamp: number }>;
  /** Current position in the session (surface-specific) */
  position: number;
  /** Whether the session is paused */
  paused: boolean;
}

export function createVoiceSession(surface: VoiceSurface): VoiceSession {
  return {
    id: crypto.randomUUID(),
    surface,
    startedAt: Date.now(),
    transcriptLog: [],
    position: 0,
    paused: false,
  };
}

export function logTranscript(
  session: VoiceSession,
  role: 'dave' | 'user',
  text: string,
): VoiceSession {
  return {
    ...session,
    transcriptLog: [
      ...session.transcriptLog,
      { role, text, timestamp: Date.now() },
    ],
  };
}
