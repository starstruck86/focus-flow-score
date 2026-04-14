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
import { ttsCacheKey, lookupMemoryCache, racePersistentCache, storeInCache, recordCacheHit, type TtsCacheKeyInputs } from '@/lib/voice/ttsCache';
import { validateSttRequest, checkSttDuplicate, shouldRetryStt, shouldRetryTts, getSttRetryDelay, getRetryDelay, isCircuitOpen, recordSttFailure, recordSttSuccess, recordSttCall, recordSttBlocked } from '@/lib/voice/sttGuard';
import { trackTtsCall, trackSttCall, trackSttRetry, trackSttMalformed } from '@/lib/voice/voiceUsageTracker';
import { classifyUtterance, selectModel, markTurnStart, markTurnEnd } from '@/lib/voice/voiceCostController';

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
  activeSurface: VoiceSurface | null;
  ttsAvailable: boolean;
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

export interface ActivePlayback {
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
 *
 * Hot path architecture:
 * 1. Memory cache lookup (synchronous, instant)
 * 2. If miss: start fetch IMMEDIATELY, race persistent cache in parallel
 * 3. If persistent cache wins the race, abort the fetch and use cached blob
 * 4. Otherwise use fetch result and write-behind to cache
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

  const voiceId = config.voiceId ?? DEFAULT_VOICE_ID;
  const utteranceType = classifyUtterance(text);
  const model = selectModel(utteranceType);

  const cacheKeyInputs: TtsCacheKeyInputs = { text, voiceId, modelId: model.modelId };
  const cacheKey = ttsCacheKey(cacheKeyInputs);

  // ── Step 1: Memory cache (synchronous, zero latency) ──
  const memResult = lookupMemoryCache(cacheKey);
  if (memResult.blob) {
    recordCacheHit('memory');
    trackTtsCall(text, 'memory');
    return playBlob(memResult.blob, active);
  }

  // ── Step 2: Memory miss — start fetch AND race persistent cache ──
  // Fetch starts IMMEDIATELY — persistent cache does NOT block it.
  const fetchAbort = new AbortController();
  const onOuterAbort = () => fetchAbort.abort();
  abortController.signal.addEventListener('abort', onOuterAbort, { once: true });

  const fetchPromise = fetchTtsWithRetry(text, voiceId, model.modelId, config, fetchAbort, options);
  const persistentPromise = racePersistentCache(cacheKey);

  // Race: persistent cache vs fetch
  let blob: Blob | null = null;
  let source: 'persistent' | 'miss' = 'miss';

  try {
    const winner = await Promise.race([
      persistentPromise.then(b => ({ type: 'persistent' as const, blob: b })),
      fetchPromise.then(b => ({ type: 'fetch' as const, blob: b })),
    ]);

    if (winner.type === 'persistent' && winner.blob) {
      // Persistent cache won — abort the fetch
      fetchAbort.abort();
      blob = winner.blob;
      source = 'persistent';
    } else if (winner.type === 'fetch' && winner.blob) {
      blob = winner.blob;
      source = 'miss';
      // Write-behind to cache
      storeInCache(cacheKey, blob);
    } else {
      // Winner returned null, wait for the other
      if (winner.type === 'persistent') {
        // Persistent was null, wait for fetch
        const fetchResult = await fetchPromise;
        blob = fetchResult;
        source = 'miss';
        if (blob) storeInCache(cacheKey, blob);
      } else {
        // Fetch was null (shouldn't happen — it throws), try persistent
        const persistResult = await persistentPromise;
        if (persistResult) {
          blob = persistResult;
          source = 'persistent';
        }
      }
    }
  } catch (err) {
    // Fetch threw — check if persistent cache has it
    const persistResult = await persistentPromise;
    if (persistResult) {
      blob = persistResult;
      source = 'persistent';
    } else {
      abortController.signal.removeEventListener('abort', onOuterAbort);
      throw err;
    }
  }

  abortController.signal.removeEventListener('abort', onOuterAbort);

  recordCacheHit(source);
  trackTtsCall(text, source);

  if (!blob) {
    throw new Error('TTS failed: no audio produced');
  }

  return playBlob(blob, active);
}

/**
 * Fetch TTS from API with retry logic and explicit retry classification.
 */
async function fetchTtsWithRetry(
  text: string,
  voiceId: string,
  modelId: string,
  config: TtsConfig,
  abortController: AbortController,
  options?: { previousText?: string; nextText?: string },
): Promise<Blob> {
  let lastError = '';

  for (let attempt = 0; attempt <= TTS_MAX_RETRIES; attempt++) {
    if (abortController.signal.aborted) throw new Error('TTS aborted');
    if (attempt > 0) {
      const decision = shouldRetryTts(lastStatus, attempt);
      if (!decision.shouldRetry) break;
      await new Promise(r => setTimeout(r, getRetryDelay(attempt)));
    }

    let lastStatus = 0;
    const attemptAbort = new AbortController();
    const onOuter = () => attemptAbort.abort();
    abortController.signal.addEventListener('abort', onOuter, { once: true });

    try {
      const body: Record<string, unknown> = { text, voiceId, model_id: modelId };
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

      lastStatus = response.status;

      if (!response.ok) {
        lastError = `TTS HTTP ${response.status}`;
        // Check if retryable using explicit classification
        const decision = shouldRetryTts(response.status, attempt);
        if (!decision.shouldRetry) break;
        continue;
      }

      return await response.blob();
    } catch (err) {
      abortController.signal.removeEventListener('abort', onOuter);
      if (abortController.signal.aborted) throw new Error('TTS aborted');
      lastError = err instanceof Error ? err.message : 'TTS fetch error';
    }
  }

  throw new Error(`TTS failed: ${lastError}`);
}

/** Play a blob and return when audio ends. */
function playBlob(blob: Blob, active: ActivePlayback): Promise<ActivePlayback> {
  return new Promise<ActivePlayback>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
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
  signal?: AbortSignal;
}

/**
 * Listen for user speech using browser MediaRecorder + ElevenLabs STT.
 * Returns the transcript string.
 * Uses actual recorder timing for duration tracking (not blob size).
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
    const recordingStartTime = Date.now();

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      mediaRecorder.stop();
      releaseMicrophoneStream(stream);
    };

    const finishAndTranscribe = () => {
      const actualDurationSeconds = (Date.now() - recordingStartTime) / 1000;
      if (chunks.length > 0) {
        transcribeAudio(
          new Blob(chunks, { type: mediaRecorder.mimeType }),
          config,
          actualDurationSeconds,
        ).then(resolve).catch(reject);
      } else {
        resolve('');
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      finishAndTranscribe();
    }, timeoutMs);

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
          finishAndTranscribe();
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

    mediaRecorder.start(250);
  });
}

function getSupportedMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

/**
 * Transcribe audio via ElevenLabs STT edge function.
 * Uses actual recording duration (from recorder timing), not blob size estimation.
 */
async function transcribeAudio(
  audioBlob: Blob,
  config: TtsConfig,
  actualDurationSeconds: number,
): Promise<string> {
  // ── Preflight validation ──
  const preflight = validateSttRequest(audioBlob);
  if (!preflight.valid) {
    trackSttMalformed();
    recordSttBlocked('preflight');
    logger.warn('STT preflight failed', { reason: preflight.reason });
    return '';
  }

  // ── Duplicate check (async, lightweight content fingerprint) ──
  const dupeCheck = await checkSttDuplicate(audioBlob);
  if (dupeCheck.isDuplicate) {
    recordSttBlocked('duplicate');
    logger.warn('STT duplicate submission blocked');
    return '';
  }

  // ── Circuit breaker ──
  if (isCircuitOpen()) {
    recordSttBlocked('circuit');
    throw new Error('STT circuit breaker open — too many recent failures');
  }

  trackSttCall(actualDurationSeconds);

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  let lastStatus = 0;
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) {
      const decision = shouldRetryStt(lastStatus, attempt);
      if (!decision.shouldRetry) break;
      trackSttRetry();
      await new Promise(r => setTimeout(r, getSttRetryDelay(attempt)));
    }

    try {
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

      lastStatus = response.status;

      if (!response.ok) {
        recordSttFailure();
        recordSttCall(false);
        continue;
      }

      recordSttSuccess();
      recordSttCall(true, actualDurationSeconds);
      const result = await response.json();
      return result.text ?? '';
    } catch (err) {
      recordSttFailure();
      recordSttCall(false);
      if (attempt === 0) continue;
      throw err;
    }
  }

  throw new Error(`STT failed: HTTP ${lastStatus}`);
}

// ── Turn Lifecycle ────────────────────────────────────────────────

export interface TurnConfig {
  prompt: string;
  onUserResponse: (transcript: string) => Promise<string>;
  onFeedbackReady?: (feedback: string) => void;
  previousText?: string;
}

export interface TurnResult {
  transcript: string;
  feedback: string;
  command: VoiceCommand;
  completed: boolean;
}

/**
 * Execute a complete turn: speak → listen → process → speak feedback.
 * Marks turn boundaries for UX-safe auto-downgrade.
 */
export async function runTurn(
  turn: TurnConfig,
  ttsConfig: TtsConfig,
  playbackRef: { current: ActivePlayback },
  onStateChange?: (patch: Partial<DaveVoiceState>) => void,
): Promise<TurnResult> {
  const update = (p: Partial<DaveVoiceState>) => onStateChange?.(p);

  markTurnStart();

  try {
    // 1. Speak prompt
    update({ isSpeaking: true, isListening: false });
    try {
      playbackRef.current = await speak(turn.prompt, ttsConfig, playbackRef.current, {
        previousText: turn.previousText,
      });
    } catch {
      update({ isSpeaking: false, ttsAvailable: false });
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
  } finally {
    markTurnEnd();
  }
}

// ── Speech Queue (for multi-segment narration) ─────────────────────

export interface SpeechQueueItem {
  text: string;
  pauseAfter?: number;
}

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
  transcriptLog: Array<{ role: 'dave' | 'user'; text: string; timestamp: number }>;
  position: number;
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
