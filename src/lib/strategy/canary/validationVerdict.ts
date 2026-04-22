// ════════════════════════════════════════════════════════════════
// validationVerdict — pure deterministic helper for the canary
// ValidationStatusDrawer recommendation.
//
// Single source of truth for:
//   - the recommendation status (blocked | needs_traffic | ready)
//   - the human-readable label
//   - the contributing reasons (rule explainers)
//   - per-mode evidence chip state (verified | missing | failed)
//
// No side effects. Same input → same output.
// ════════════════════════════════════════════════════════════════

export type VerdictStatus = 'blocked' | 'needs_traffic' | 'ready';

export interface CanaryGroupShape {
  mode: string;
  fallback_triggered: boolean;
  fallback_success: boolean | null;
  same_run_id_returned: boolean | null;
  runs: Array<{ status: string; id: string }>;
}

export interface VerdictInput {
  duplicates: number;
  orphans: number;
  laneCount24h: number;
  fallbackSeen: boolean; // any historical successful fallback (telemetry-only)
  groups: CanaryGroupShape[];
}

export type ChipState = 'verified' | 'missing' | 'failed';

export interface EvidenceChips {
  normal: ChipState;
  fallback: ChipState;
  collision: ChipState;
}

export interface Verdict {
  status: VerdictStatus;
  label: string;
  reasons: string[];
  chips: EvidenceChips;
}

function deriveChips(groups: CanaryGroupShape[]): EvidenceChips {
  const normalGroups = groups.filter((g) => g.mode === 'normal');
  const fallbackGroups = groups.filter((g) => g.mode === 'fallback');
  const collisionGroups = groups.filter((g) => g.mode === 'collision');

  const normalOk = normalGroups.some((g) =>
    g.runs.some((r) => ['completed', 'running', 'pending'].includes(r.status)),
  );

  const fallbackOk = fallbackGroups.some(
    (g) => g.fallback_triggered && g.fallback_success === true,
  );
  const fallbackBad = fallbackGroups.some(
    (g) => g.fallback_triggered && g.fallback_success === false,
  );

  const collisionOk = collisionGroups.some((g) => g.same_run_id_returned === true);
  const collisionBad = collisionGroups.some((g) => g.same_run_id_returned === false);

  return {
    normal: normalOk ? 'verified' : 'missing',
    fallback: fallbackOk ? 'verified' : fallbackBad ? 'failed' : 'missing',
    collision: collisionOk ? 'verified' : collisionBad ? 'failed' : 'missing',
  };
}

export function deriveVerdict(input: VerdictInput): Verdict {
  const chips = deriveChips(input.groups);
  const reasons: string[] = [];

  // BLOCKED — explicit failures
  const blockedReasons: string[] = [];
  if (input.duplicates > 0) {
    blockedReasons.push(`Blocked because duplicates are present (${input.duplicates})`);
  }
  if (input.orphans > 0) {
    blockedReasons.push(`Blocked because orphans are present (${input.orphans})`);
  }
  if (chips.fallback === 'failed') {
    blockedReasons.push('Blocked because fallback canary explicitly failed');
  }
  if (chips.collision === 'failed') {
    blockedReasons.push('Blocked because collision canary created multiple rows');
  }

  if (blockedReasons.length > 0) {
    return {
      status: 'blocked',
      label: 'Blocked',
      reasons: blockedReasons,
      chips,
    };
  }

  // READY — every required signal present
  if (
    input.laneCount24h > 0 &&
    chips.normal === 'verified' &&
    chips.fallback === 'verified' &&
    chips.collision === 'verified' &&
    input.duplicates === 0 &&
    input.orphans === 0
  ) {
    reasons.push('Ready because duplicates = 0');
    reasons.push('Ready because orphans = 0');
    reasons.push('Ready because lane telemetry exists');
    reasons.push('Ready because normal canary evidence exists');
    reasons.push('Ready because fallback canary evidence exists');
    reasons.push('Ready because collision canary evidence exists');
    return { status: 'ready', label: 'Ready to test', reasons, chips };
  }

  // NEEDS TRAFFIC — fall-through with explicit gap reasons
  if (input.laneCount24h === 0) {
    reasons.push('Needs traffic because no lane telemetry exists');
  }
  if (chips.normal !== 'verified') {
    reasons.push('Needs traffic because no normal canary run exists');
  }
  if (chips.fallback !== 'verified') {
    reasons.push('Needs traffic because no successful fallback canary exists');
  }
  if (chips.collision !== 'verified') {
    reasons.push('Needs traffic because no collision canary with same run_id exists');
  }
  if (input.groups.length === 0) {
    reasons.push('Needs traffic because no canary-tagged runs exist');
  }
  if (reasons.length === 0) {
    reasons.push('Needs traffic — required live evidence is incomplete');
  }

  return {
    status: 'needs_traffic',
    label: 'Needs traffic',
    reasons,
    chips,
  };
}
