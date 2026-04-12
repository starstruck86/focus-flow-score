/**
 * V6 Multi-Thread Layer — Types
 *
 * Additive layer for stakeholder tension, political awareness, and deal alignment.
 * Only active when scenarios genuinely contain multi-stakeholder complexity.
 */

// ── Stakeholder Signal ────────────────────────────────────────────

export interface StakeholderSignal {
  id: string;
  role: string;                 // "marketing", "lifecycle", "it", "ops", "analytics"
  stance: 'supportive' | 'neutral' | 'skeptical' | 'status_quo_champion';
  priority: string;             // "growth", "speed", "stability", "risk", "efficiency"
  influenceLevel: 'low' | 'medium' | 'high';
  perspective: string;          // short plain-English view
}

// ── Multi-Thread Context (attached to scenarios) ──────────────────

export interface MultiThreadContext {
  active: boolean;
  stakeholders: StakeholderSignal[];
  tensionType?: 'competing_priorities' | 'status_quo_defense' | 'build_vs_buy' | 'internal_misalignment';
}

// ── Multi-Thread Assessment (returned by scorer) ──────────────────

export type DealMomentum = 'forward' | 'neutral' | 'at_risk';

export interface MultiThreadBreakdown {
  missedStakeholders?: string[];
  conflictingSignalsUnresolved?: boolean;
  wrongPriorityFocus?: boolean;
  statusQuoDefenderIgnored?: boolean;
}

export interface MultiThreadAssessment {
  stakeholdersDetected: string[];
  stakeholdersAddressed: string[];
  alignmentScore: number;             // 0–100
  championStrengthScore: number;      // 0–100
  politicalAwarenessScore: number;    // 0–100
  dealMomentum: DealMomentum;
  breakdown?: MultiThreadBreakdown;
  coachingNote: string;               // 1–2 sentences max
}

// ── Multi-Thread Readiness (capability model extension) ───────────

export type MultiThreadReadiness = 'low' | 'building' | 'ready';

// ── Constants ─────────────────────────────────────────────────────

export const DEAL_MOMENTUM_LABELS: Record<DealMomentum, string> = {
  forward: 'Forward',
  neutral: 'Neutral',
  at_risk: 'At Risk',
};

export const DEAL_MOMENTUM_COLORS: Record<DealMomentum, string> = {
  forward: 'text-green-600 dark:text-green-400',
  neutral: 'text-amber-600 dark:text-amber-400',
  at_risk: 'text-red-600 dark:text-red-400',
};

export const DEAL_MOMENTUM_BG: Record<DealMomentum, string> = {
  forward: 'bg-green-500/10 border-green-500/20',
  neutral: 'bg-amber-500/10 border-amber-500/20',
  at_risk: 'bg-red-500/10 border-red-500/20',
};

// ── Normalize raw multiThread from edge function ──────────────────

export function normalizeMultiThreadAssessment(
  raw: Record<string, unknown> | undefined | null,
): MultiThreadAssessment | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!raw.stakeholdersDetected || !Array.isArray(raw.stakeholdersDetected)) return undefined;
  if ((raw.stakeholdersDetected as string[]).length === 0) return undefined;

  const momentum = raw.dealMomentum;
  const validMomentum: DealMomentum =
    momentum === 'forward' || momentum === 'neutral' || momentum === 'at_risk'
      ? momentum
      : 'neutral';

  const breakdown = raw.breakdown as Record<string, unknown> | undefined;

  return {
    stakeholdersDetected: (raw.stakeholdersDetected as unknown[]).filter((x): x is string => typeof x === 'string'),
    stakeholdersAddressed: Array.isArray(raw.stakeholdersAddressed)
      ? (raw.stakeholdersAddressed as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    alignmentScore: typeof raw.alignmentScore === 'number' ? Math.max(0, Math.min(100, raw.alignmentScore)) : 0,
    championStrengthScore: typeof raw.championStrengthScore === 'number' ? Math.max(0, Math.min(100, raw.championStrengthScore)) : 0,
    politicalAwarenessScore: typeof raw.politicalAwarenessScore === 'number' ? Math.max(0, Math.min(100, raw.politicalAwarenessScore)) : 0,
    dealMomentum: validMomentum,
    breakdown: breakdown ? {
      missedStakeholders: Array.isArray(breakdown.missedStakeholders) ? breakdown.missedStakeholders as string[] : undefined,
      conflictingSignalsUnresolved: typeof breakdown.conflictingSignalsUnresolved === 'boolean' ? breakdown.conflictingSignalsUnresolved : undefined,
      wrongPriorityFocus: typeof breakdown.wrongPriorityFocus === 'boolean' ? breakdown.wrongPriorityFocus : undefined,
      statusQuoDefenderIgnored: typeof breakdown.statusQuoDefenderIgnored === 'boolean' ? breakdown.statusQuoDefenderIgnored : undefined,
    } : undefined,
    coachingNote: typeof raw.coachingNote === 'string' ? raw.coachingNote : '',
  };
}
