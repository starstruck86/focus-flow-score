/**
 * Friction Signal Detector
 *
 * Detects behavioral patterns indicating system friction:
 * - ignored recommendations
 * - skipped roleplays
 * - repeated deal reopen
 * - abandoned confirmations
 * - excessive clarifications
 *
 * Feature-flagged via ENABLE_VOICE_OS.
 */

const FRICTION_KEY = 'dave-friction-signals';
const MAX_SIGNALS = 100;

export type FrictionType =
  | 'ignored_recommendation'
  | 'skipped_roleplay'
  | 'repeated_reopen'
  | 'abandoned_confirmation'
  | 'excessive_clarification'
  | 'repeated_same_query'
  | 'rapid_dismiss';

export interface FrictionSignal {
  frictionType: FrictionType;
  frequency: number;
  context: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: number;
}

export interface FrictionSummary {
  signals: FrictionSignal[];
  topFrictionType: FrictionType | null;
  totalFriction: number;
  shouldReduceNudges: boolean;
  shouldSimplifyFlow: boolean;
}

// ── Recording ──────────────────────────────────────────────

export function recordFriction(type: FrictionType, context: string): void {
  const signals = loadSignals();
  const existing = signals.find(s => s.frictionType === type && s.context === context);

  if (existing) {
    existing.frequency++;
    existing.timestamp = Date.now();
    existing.severity = existing.frequency >= 5 ? 'high' : existing.frequency >= 3 ? 'medium' : 'low';
  } else {
    signals.push({
      frictionType: type,
      frequency: 1,
      context,
      severity: 'low',
      timestamp: Date.now(),
    });
  }

  if (signals.length > MAX_SIGNALS) signals.splice(0, signals.length - MAX_SIGNALS);
  saveSignals(signals);
}

// ── Analysis ───────────────────────────────────────────────

export function getFrictionSummary(windowMs: number = 7 * 24 * 3600 * 1000): FrictionSummary {
  const cutoff = Date.now() - windowMs;
  const signals = loadSignals().filter(s => s.timestamp > cutoff);

  if (signals.length === 0) {
    return { signals: [], topFrictionType: null, totalFriction: 0, shouldReduceNudges: false, shouldSimplifyFlow: false };
  }

  const totalFriction = signals.reduce((sum, s) => sum + s.frequency, 0);

  // Find the most frequent friction type
  const typeCounts: Record<string, number> = {};
  for (const s of signals) {
    typeCounts[s.frictionType] = (typeCounts[s.frictionType] ?? 0) + s.frequency;
  }
  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const topFrictionType = (sorted[0]?.[0] ?? null) as FrictionType | null;

  // Derive behavioral adjustments
  const shouldReduceNudges = (typeCounts['ignored_recommendation'] ?? 0) >= 3
    || (typeCounts['rapid_dismiss'] ?? 0) >= 5;

  const shouldSimplifyFlow = (typeCounts['abandoned_confirmation'] ?? 0) >= 3
    || (typeCounts['excessive_clarification'] ?? 0) >= 3;

  return { signals, topFrictionType, totalFriction, shouldReduceNudges, shouldSimplifyFlow };
}

// ── Storage ────────────────────────────────────────────────

function loadSignals(): FrictionSignal[] {
  try { return JSON.parse(localStorage.getItem(FRICTION_KEY) || '[]'); } catch { return []; }
}

function saveSignals(signals: FrictionSignal[]): void {
  try { localStorage.setItem(FRICTION_KEY, JSON.stringify(signals)); } catch {}
}
