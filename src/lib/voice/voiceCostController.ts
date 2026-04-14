/**
 * Voice Cost Controller — Model routing, voice modes, utterance optimization.
 *
 * Controls:
 * - Which TTS model to use based on context
 * - Voice verbosity mode (minimal / balanced / full)
 * - Utterance batching (combine short consecutive utterances)
 * - Auto-downgrade when credits are high
 */

import { getUsageLevel, type UsageLevel } from './voiceUsageTracker';

// ── Voice Modes ────────────────────────────────────────────────────

export type VoiceMode = 'minimal' | 'balanced' | 'full';

let currentMode: VoiceMode = 'balanced';

export function setVoiceMode(mode: VoiceMode): void {
  currentMode = mode;
  try { localStorage.setItem('dave-voice-mode', mode); } catch { /* noop */ }
}

export function getVoiceMode(): VoiceMode {
  return currentMode;
}

// Initialize from storage
try {
  const stored = localStorage.getItem('dave-voice-mode') as VoiceMode | null;
  if (stored && ['minimal', 'balanced', 'full'].includes(stored)) currentMode = stored;
} catch { /* noop */ }

// ── Utterance Classification ───────────────────────────────────────

export type UtteranceType = 'static' | 'semi_dynamic' | 'dynamic';

/** Static phrases that are always the same */
const STATIC_PATTERNS = [
  /^(alright|okay|good|great|nice|let'?s)/i,
  /give me your best shot/i,
  /here'?s what (good|great) looks like/i,
  /let'?s (get into it|do this|try|practice|move on)/i,
  /now it'?s your turn/i,
  /listen to the scenario/i,
  /i'?ll coach you after/i,
  /ready\?? go/i,
  /quick tip:/i,
  /here'?s an example/i,
  /what NOT to do/i,
];

export function classifyUtterance(text: string): UtteranceType {
  const trimmed = text.trim();
  // Short phrases that match static patterns
  if (trimmed.length < 100 && STATIC_PATTERNS.some(p => p.test(trimmed))) {
    return 'static';
  }
  // Longer text with user-specific content is dynamic
  if (trimmed.length > 200) return 'dynamic';
  return 'semi_dynamic';
}

// ── Model Routing ──────────────────────────────────────────────────

export interface ModelSelection {
  /** Model ID to pass to ElevenLabs */
  modelId: string;
  /** Readable label for debug panel */
  label: string;
}

// eleven_turbo_v2_5 is ~2x cheaper than eleven_multilingual_v2
const FAST_MODEL: ModelSelection = { modelId: 'eleven_turbo_v2_5', label: 'Turbo (fast/cheap)' };
const PREMIUM_MODEL: ModelSelection = { modelId: 'eleven_multilingual_v2', label: 'Multilingual (premium)' };

export function selectModel(_utteranceType: UtteranceType): ModelSelection {
  const usage = getUsageLevel();

  // If credits are high, always use fast model
  if (usage === 'critical' || usage === 'warning') return FAST_MODEL;

  // For English coaching, turbo v2.5 is sufficient and faster
  // Only use premium if explicitly set to 'full' mode AND it's a dynamic utterance
  if (currentMode === 'full' && _utteranceType === 'dynamic') return PREMIUM_MODEL;

  return FAST_MODEL;
}

export function getActiveModel(): ModelSelection {
  return selectModel('semi_dynamic');
}

// ── Utterance Batching ─────────────────────────────────────────────

const MIN_BATCH_LENGTH = 15; // Don't speak anything under 15 chars alone
const MAX_BATCH_LENGTH = 500;

/**
 * Combine consecutive short utterances into fewer TTS calls.
 * Reduces API call count without degrading quality.
 */
export function batchUtterances(texts: string[]): string[] {
  if (texts.length <= 1) return texts;

  const batched: string[] = [];
  let current = '';

  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) continue;

    if (current.length === 0) {
      current = trimmed;
    } else if (current.length + trimmed.length + 1 <= MAX_BATCH_LENGTH
      && (current.length < MIN_BATCH_LENGTH || trimmed.length < MIN_BATCH_LENGTH)) {
      current += ' ' + trimmed;
    } else {
      batched.push(current);
      current = trimmed;
    }
  }
  if (current) batched.push(current);

  return batched;
}

// ── Verbosity Filter ───────────────────────────────────────────────

/**
 * Filter speech queue items based on voice mode.
 * In 'minimal' mode, skip non-essential items.
 * In 'balanced' mode, skip only redundant transitions.
 */
export function filterByVerbosity<T extends { text: string }>(items: T[]): T[] {
  if (currentMode === 'full') return items;

  return items.filter(item => {
    const t = item.text.trim().toLowerCase();

    // Always keep: questions, core teaching, user-specific feedback
    if (t.endsWith('?')) return true;
    if (t.length > 100) return true;

    // In minimal mode, skip transitional phrases
    if (currentMode === 'minimal') {
      if (/^(alright|okay|good|great|nice|now)[,.]?\s/i.test(t) && t.length < 40) return false;
      if (/let'?s (move on|continue|keep going)/i.test(t)) return false;
    }

    return true;
  });
}

// ── Auto-downgrade on high usage ───────────────────────────────────

export function checkAutoDowngrade(): boolean {
  const usage = getUsageLevel();
  if (usage === 'critical' && currentMode !== 'minimal') {
    setVoiceMode('minimal');
    return true;
  }
  if (usage === 'warning' && currentMode === 'full') {
    setVoiceMode('balanced');
    return true;
  }
  return false;
}

// ── Session Cost Estimator ─────────────────────────────────────────

export interface SessionEstimate {
  estimatedTtsCharacters: number;
  estimatedSttSeconds: number;
  estimatedCredits: number;
  mode: VoiceMode;
}

export function estimateSessionCost(
  expectedTurns: number = 5,
  avgCharsPerTurn: number = 400,
  avgSttSecondsPerTurn: number = 15,
): SessionEstimate {
  const modeMultiplier = currentMode === 'minimal' ? 0.5 : currentMode === 'balanced' ? 0.75 : 1.0;
  const ttsChars = Math.round(expectedTurns * avgCharsPerTurn * modeMultiplier);
  const sttSeconds = expectedTurns * avgSttSecondsPerTurn;
  const credits = ttsChars + (sttSeconds * 10);

  return {
    estimatedTtsCharacters: ttsChars,
    estimatedSttSeconds: sttSeconds,
    estimatedCredits: credits,
    mode: currentMode,
  };
}
