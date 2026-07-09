/**
 * Gap Score — the "how much expansion opportunity is on the table" number for
 * a Branch expansion AE. Replaces the retired ICP fit score. It reads the
 * truth-model tables only; nothing from ICP/fit scoring.
 *
 * Inputs (per account):
 *   - branch_pov rows where target_status ∈ ('should_own','should_expand')
 *     → each row contributes proportionally to its conviction (1..5)
 *   - open account_risks (status not in resolved/closed) → each contributes
 *     proportionally to severity (1..5) — a live risk is a live gap
 *   - accounts.last_reviewed_at → recency boost, so freshly-reviewed accounts
 *     score higher than stale ones with the same underlying facts
 *
 * Range: 0..100. Higher = more open expansion surface. Deliberately simple —
 * tune-able by the operator.
 */

export interface GapScoreInputs {
  povs: Array<{ target_status: string | null; conviction: number | null }>;
  risks: Array<{ status: string | null; severity: number | null }>;
  last_reviewed_at?: string | null;
}

export interface GapScoreResult {
  score: number;
  why: string;
  parts: {
    povContribution: number;
    riskContribution: number;
    recencyContribution: number;
    qualifyingPovCount: number;
    openRiskCount: number;
    daysSinceReview: number | null;
  };
}

const POV_TARGETS = new Set(['should_own', 'should_expand']);
const CLOSED_RISK_STATUSES = new Set(['resolved', 'closed', 'won', 'mitigated']);

export function computeGapScore(input: GapScoreInputs): GapScoreResult {
  const qualifyingPovs = (input.povs ?? []).filter(
    (p) => p.target_status && POV_TARGETS.has(p.target_status),
  );
  const openRisks = (input.risks ?? []).filter(
    (r) => !r.status || !CLOSED_RISK_STATUSES.has(r.status),
  );

  // POV contribution: cap ~60. Each row worth (conviction * 4), max 20/row.
  const povSum = qualifyingPovs.reduce(
    (s, p) => s + Math.max(0, Math.min(5, p.conviction ?? 0)) * 4,
    0,
  );
  const povContribution = Math.min(60, povSum);

  // Risk contribution: cap ~25. Each open risk worth (severity ?? 3) * 3.
  const riskSum = openRisks.reduce(
    (s, r) => s + Math.max(1, Math.min(5, r.severity ?? 3)) * 3,
    0,
  );
  const riskContribution = Math.min(25, riskSum);

  // Recency contribution: cap 15. Fresher review = fresher score.
  let daysSinceReview: number | null = null;
  let recencyContribution = 0;
  if (input.last_reviewed_at) {
    const ts = new Date(input.last_reviewed_at).getTime();
    if (!Number.isNaN(ts)) {
      daysSinceReview = Math.max(0, Math.round((Date.now() - ts) / 86_400_000));
      if (daysSinceReview <= 2) recencyContribution = 15;
      else if (daysSinceReview <= 7) recencyContribution = 12;
      else if (daysSinceReview <= 30) recencyContribution = 8;
      else if (daysSinceReview <= 90) recencyContribution = 4;
      else recencyContribution = 0;
    }
  }

  const score = Math.max(
    0,
    Math.min(100, Math.round(povContribution + riskContribution + recencyContribution)),
  );

  // Build the one-line "why".
  const bits: string[] = [];
  if (qualifyingPovs.length > 0) {
    const shouldOwn = qualifyingPovs.filter((p) => p.target_status === 'should_own').length;
    const shouldExpand = qualifyingPovs.filter((p) => p.target_status === 'should_expand').length;
    if (shouldOwn > 0) bits.push(`${shouldOwn} should-own surface${shouldOwn === 1 ? '' : 's'}`);
    if (shouldExpand > 0) bits.push(`${shouldExpand} should-expand`);
  }
  if (openRisks.length > 0) {
    bits.push(`${openRisks.length} open risk${openRisks.length === 1 ? '' : 's'}`);
  }
  if (daysSinceReview != null) {
    if (daysSinceReview === 0) bits.push('reviewed today');
    else if (daysSinceReview === 1) bits.push('reviewed 1d ago');
    else bits.push(`reviewed ${daysSinceReview}d ago`);
  } else if (input.last_reviewed_at === null || input.last_reviewed_at === undefined) {
    bits.push('never reviewed');
  }

  const why = bits.length > 0 ? bits.join(', ') : 'no POV, no risks, no review';

  return {
    score,
    why,
    parts: {
      povContribution,
      riskContribution,
      recencyContribution,
      qualifyingPovCount: qualifyingPovs.length,
      openRiskCount: openRisks.length,
      daysSinceReview,
    },
  };
}
