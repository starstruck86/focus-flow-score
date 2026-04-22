/**
 * Cycle 1 Canary — deterministic recommendation + evidence derivation.
 *
 * Rules (from spec):
 *   rollback if any of:
 *     - duplicates non-empty
 *     - step 8 failed
 *     - failures SQL non-empty
 *     - >=2 step failures spanning >=2 unrelated areas
 *   fix if 1–2 isolated step failures
 *   continue otherwise (and lane mix in healthy band)
 */
import type {
  Decision,
  EvidenceSummary,
  LaneBand,
  LaneMix,
  ParsedCanary,
  ParsedStep,
  RiskSignal,
} from './types';

const STEP_AREAS: Record<number, 'routing' | 'backend' | 'idempotency' | 'bypass' | 'discovery'> = {
  1: 'routing',
  2: 'routing',
  3: 'routing',
  4: 'backend',
  5: 'idempotency',
  6: 'backend',
  7: 'bypass',
  8: 'discovery',
};

function failedSteps(steps: ParsedStep[]): ParsedStep[] {
  return steps.filter(s => s.status === 'fail');
}

function laneBand(mix: LaneMix | null): { band: LaneBand; pct: number | null } {
  if (!mix) return { band: 'unknown', pct: null };
  const total = mix.direct + mix.assisted + mix.deep_work;
  if (total <= 0) return { band: 'unknown', pct: null };
  const pct = (mix.deep_work / total) * 100;
  let band: LaneBand;
  if (pct >= 5 && pct <= 30) band = 'healthy';
  else if ((pct >= 2 && pct < 5) || (pct > 30 && pct <= 40)) band = 'warn';
  else band = 'off_band';
  return { band, pct };
}

function deriveRiskSignals(parsed: ParsedCanary): RiskSignal[] {
  const out: RiskSignal[] = [];
  const failed = new Set(failedSteps(parsed.steps).map(s => s.n));
  if (!parsed.duplicates.empty && parsed.duplicates.raw) {
    out.push({ key: 'idempotency_breach', label: 'Idempotency breach' });
  }
  if (failed.has(1) || failed.has(2)) {
    const noteMatch = parsed.steps.some(
      s => (s.n === 1 || s.n === 2) && s.status === 'fail' &&
           (s.note ?? '').toLowerCase().includes('deep_work'),
    );
    if (noteMatch) out.push({ key: 'utility_misroute', label: 'Utility mis-route' });
  }
  if (failed.has(5)) out.push({ key: 'double_click_guard', label: 'Double-click guard breach' });
  if (failed.has(6)) out.push({ key: 'retry_broken', label: 'Retry path broken' });
  if (failed.has(7)) out.push({ key: 'bypass_not_honored', label: 'Bypass not honored' });
  if (failed.has(8)) out.push({ key: 'discovery_regression', label: 'Discovery Prep regression' });
  return out;
}

export function getRecommendation(parsed: ParsedCanary): Decision {
  const failed = failedSteps(parsed.steps);
  const failedNums = new Set(failed.map(f => f.n));
  const areasFailed = new Set(failed.map(f => STEP_AREAS[f.n]).filter(Boolean));

  // Roll back triggers
  if (!parsed.duplicates.empty && parsed.duplicates.raw) return 'rollback';
  if (!parsed.failures.empty && parsed.failures.raw) return 'rollback';
  if (failedNums.has(8)) return 'rollback';
  if (failed.length >= 2 && areasFailed.size >= 2) return 'rollback';

  // Fix
  if (failed.length >= 1 && failed.length <= 2) return 'fix';

  // Continue requires healthy lane band
  const { band } = laneBand(parsed.lane_mix);
  if (band === 'healthy') return 'continue';
  // No failures but lane band is off — treat as fix.
  if (failed.length === 0) return 'fix';
  return 'fix';
}

export function buildEvidenceSummary(parsed: ParsedCanary): EvidenceSummary {
  const { band, pct } = laneBand(parsed.lane_mix);
  return {
    steps: parsed.steps,
    duplicates_status: parsed.duplicates.raw === null && parsed.duplicates.empty === false
      ? 'missing'
      : parsed.duplicates.empty
        ? 'empty'
        : 'non_empty',
    duplicates_raw: parsed.duplicates.raw,
    failures_status: parsed.failures.raw === null && parsed.failures.empty === false
      ? 'missing'
      : parsed.failures.empty
        ? 'empty'
        : 'non_empty',
    failures_raw: parsed.failures.raw,
    lane_mix: parsed.lane_mix,
    lane_band: band,
    deep_work_pct: pct,
    flag_state: parsed.flag_state,
    risk_signals: deriveRiskSignals(parsed),
    observations: parsed.observations,
    recommendation: getRecommendation(parsed),
  };
}
