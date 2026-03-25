// Deterministic Scoring Engine — SINGLE source of truth for action prioritization
// All inputs are explicitly defined. Same input → same score. No interpretation.

export interface ScoringInput {
  revenueImpact: 1 | 2 | 3;
  timeSensitivity: 1 | 2 | 3;
  actionability: 1 | 2 | 3;
}

export interface ScoredAction {
  score: number;
  tier: 'critical' | 'high' | 'moderate' | 'low';
}

// ── Revenue Impact ──
// 3 = directly affects open deal value or close
// 2 = affects pipeline creation or expansion
// 1 = indirect or supporting work
export function classifyRevenueImpact(opts: {
  isClosingAction: boolean;
  arrK: number;
  isPipelineCreation: boolean;
}): 1 | 2 | 3 {
  if (opts.isClosingAction && opts.arrK > 0) return 3;
  if (opts.isPipelineCreation) return 2;
  return 1;
}

// ── Time Sensitivity ──
// 3 = must be done today or immediate risk
// 2 = should be done within 1–2 days
// 1 = flexible
export function classifyTimeSensitivity(opts: {
  dueToday: boolean;
  overdueDays?: number;
  meetingInMinutes?: number;
  daysUntilDeadline?: number;
}): 1 | 2 | 3 {
  if (opts.meetingInMinutes !== undefined && opts.meetingInMinutes <= 30) return 3;
  if (opts.dueToday) return 3;
  if (opts.overdueDays !== undefined && opts.overdueDays > 0) return 3;
  if (opts.daysUntilDeadline !== undefined && opts.daysUntilDeadline <= 2) return 2;
  return 1;
}

// ── Actionability ──
// 3 = clear next step exists
// 2 = requires minor clarification
// 1 = vague or incomplete
export function classifyActionability(opts: {
  hasNextStep: boolean;
  hasContacts: boolean;
  needsClarification: boolean;
}): 1 | 2 | 3 {
  if (opts.hasNextStep && !opts.needsClarification) return 3;
  if (opts.hasNextStep || opts.hasContacts) return 2;
  return 1;
}

// ── Deterministic Score Calculation ──
// Weighted: Revenue(50%) + Time(30%) + Actionability(20%)
// Range: 1.0 – 3.0, then scaled to 0–300 for compatibility
export function calculateScore(input: ScoringInput): ScoredAction {
  const raw = (input.revenueImpact * 0.5) + (input.timeSensitivity * 0.3) + (input.actionability * 0.2);
  const score = Math.round(raw * 100); // 100–300 range

  let tier: ScoredAction['tier'];
  if (score >= 250) tier = 'critical';
  else if (score >= 200) tier = 'high';
  else if (score >= 150) tier = 'moderate';
  else tier = 'low';

  return { score, tier };
}

// ── Action Memory Adjustment ──
// Deterministic penalty for repeatedly ignored actions
export function applyMemoryPenalty(score: number, ignoreCount: number): number {
  if (ignoreCount >= 4) return Math.round(score * 0.3);
  if (ignoreCount >= 3) return Math.round(score * 0.5);
  if (ignoreCount >= 2) return Math.round(score * 0.7);
  if (ignoreCount >= 1) return Math.round(score * 0.9);
  return score;
}
