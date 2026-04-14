/**
 * Voice Cost Controller — Model routing, voice modes, utterance optimization.
 *
 * Controls:
 * - Which TTS model to use based on context
 * - Voice verbosity mode (minimal / balanced / full)
 * - Utterance batching (combine short consecutive utterances)
 * - UX-safe auto-downgrade (only between turns, never mid-turn)
 */

import { getUsageLevel, type UsageLevel } from './voiceUsageTracker';

// ── Voice Modes ────────────────────────────────────────────────────

export type VoiceMode = 'minimal' | 'balanced' | 'full';

let currentMode: VoiceMode = 'balanced';

/** Whether a coaching turn is currently in progress. Prevents mid-turn downgrades. */
let turnInProgress = false;
/** Pending downgrade to apply after the current turn ends. */
let pendingDowngrade: VoiceMode | null = null;

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

// ── Turn boundary guards ───────────────────────────────────────────

/** Call when a coaching turn begins. Locks mode changes. */
export function markTurnStart(): void {
  turnInProgress = true;
}

/** Call when a coaching turn ends. Applies any pending downgrade. */
export function markTurnEnd(): void {
  turnInProgress = false;
  if (pendingDowngrade) {
    setVoiceMode(pendingDowngrade);
    pendingDowngrade = null;
  }
}

// ── Utterance Classification ───────────────────────────────────────

export type UtteranceType = 'static' | 'semi_dynamic' | 'dynamic';

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
  if (trimmed.length < 100 && STATIC_PATTERNS.some(p => p.test(trimmed))) {
    return 'static';
  }
  if (trimmed.length > 200) return 'dynamic';
  return 'semi_dynamic';
}

// ── Model Routing ──────────────────────────────────────────────────

export interface ModelSelection {
  modelId: string;
  label: string;
}

const FAST_MODEL: ModelSelection = { modelId: 'eleven_turbo_v2_5', label: 'Turbo (fast/cheap)' };
const PREMIUM_MODEL: ModelSelection = { modelId: 'eleven_multilingual_v2', label: 'Multilingual (premium)' };

export function selectModel(_utteranceType: UtteranceType): ModelSelection {
  const usage = getUsageLevel();
  if (usage === 'critical' || usage === 'warning') return FAST_MODEL;
  if (currentMode === 'full' && _utteranceType === 'dynamic') return PREMIUM_MODEL;
  return FAST_MODEL;
}

export function getActiveModel(): ModelSelection {
  return selectModel('semi_dynamic');
}

// ── Utterance Batching ─────────────────────────────────────────────

const MIN_BATCH_LENGTH = 15;
const MAX_BATCH_LENGTH = 500;

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

export function filterByVerbosity<T extends { text: string }>(items: T[]): T[] {
  if (currentMode === 'full') return items;
  return items.filter(item => {
    const t = item.text.trim().toLowerCase();
    if (t.endsWith('?')) return true;
    if (t.length > 100) return true;
    if (currentMode === 'minimal') {
      if (/^(alright|okay|good|great|nice|now)[,.]?\s/i.test(t) && t.length < 40) return false;
      if (/let'?s (move on|continue|keep going)/i.test(t)) return false;
    }
    return true;
  });
}

// ── UX-safe auto-downgrade ─────────────────────────────────────────

/**
 * Check if auto-downgrade is needed. If a turn is in progress,
 * defers the downgrade until the turn ends. Returns true if a
 * downgrade was applied or queued.
 */
export function checkAutoDowngrade(): boolean {
  const usage = getUsageLevel();
  let targetMode: VoiceMode | null = null;

  if (usage === 'critical' && currentMode !== 'minimal') {
    targetMode = 'minimal';
  } else if (usage === 'warning' && currentMode === 'full') {
    targetMode = 'balanced';
  }

  if (!targetMode) return false;

  if (turnInProgress) {
    pendingDowngrade = targetMode;
    return true;
  }

  setVoiceMode(targetMode);
  return true;
}

// ── Session Cost Estimator (ESTIMATES — not calibrated) ────────────

export interface SessionCostEstimate {
  /** Approximate TTS characters (heuristic, not calibrated) */
  estimatedTtsCharacters: number;
  /** Approximate STT seconds (heuristic) */
  estimatedSttSeconds: number;
  /** Approximate credit cost (heuristic — not calibrated against ElevenLabs billing) */
  estimatedCreditsApprox: number;
  mode: VoiceMode;
}

export function estimateSessionCost(
  expectedTurns: number = 5,
  avgCharsPerTurn: number = 400,
  avgSttSecondsPerTurn: number = 15,
): SessionCostEstimate {
  const modeMultiplier = currentMode === 'minimal' ? 0.5 : currentMode === 'balanced' ? 0.75 : 1.0;
  const ttsChars = Math.round(expectedTurns * avgCharsPerTurn * modeMultiplier);
  const sttSeconds = expectedTurns * avgSttSecondsPerTurn;
  const credits = ttsChars + (sttSeconds * 10);

  return {
    estimatedTtsCharacters: ttsChars,
    estimatedSttSeconds: sttSeconds,
    estimatedCreditsApprox: credits,
    mode: currentMode,
  };
}
