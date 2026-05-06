/**
 * Phase 4D — Failure Root-Cause Analysis & Cohort Classification
 *
 * Classifies every failed run by root cause and era (pre-Phase-3, post-Phase-3,
 * post-Phase-4A, post-Phase-4C). Read-only. No mutation. No gate weakening.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseCost, parseArtifactGate, parseTokenUsage } from './queries';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type FailureReason =
  | 'gate_template_fidelity'
  | 'gate_readability'
  | 'gate_section_completeness'
  | 'gate_evidence_discipline'
  | 'gate_multi_dimension'
  | 'provider_timeout'
  | 'malformed_output'
  | 'stale_stuck_run'
  | 'auth_input_issue'
  | 'unknown';

export type Era = 'pre_phase3' | 'post_phase3' | 'post_phase4a' | 'post_phase4c';

export interface ClassifiedFailure {
  id: string;
  task_type: string;
  created_at: string;
  era: Era;
  reason: FailureReason;
  reason_detail: string;
  failed_dimensions: string[];
  regen_attempted: boolean;
  regen_succeeded: boolean;
  cost_wasted: number;
  stage_failed: string | null;
  provider: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
}

export interface CohortSummary {
  era: Era;
  label: string;
  total: number;
  failed: number;
  completed: number;
  failure_rate: number;
  top_reasons: { reason: FailureReason; count: number; pct: number }[];
  total_waste_usd: number;
}

export interface FailureBreakdown {
  reason: FailureReason;
  label: string;
  count: number;
  pct: number;
  total_waste_usd: number;
  avg_waste_usd: number;
  remediation_type: RemediationType;
}

export type RemediationType =
  | 'normalize_only'       // readability-only → normalize again, no LLM
  | 'section_reauthor'     // section-only → re-author mapped section only
  | 'evidence_rewrite'     // evidence-only → citation/causal rewrite only
  | 'provider_retry'       // provider-timeout → fallback/provider retry
  | 'full_regen'           // multi-dimensional → full regen
  | 'none';                // auth/input/unknown → no auto-remediation

/* ------------------------------------------------------------------ */
/*  Era boundaries (UTC timestamps)                                    */
/* ------------------------------------------------------------------ */

// Phase 3 artifact gate shipped ~May 1, 2026
const PHASE3_BOUNDARY = '2026-05-01T00:00:00Z';
// Phase 4A telemetry shipped ~May 5, 2026
const PHASE4A_BOUNDARY = '2026-05-05T00:00:00Z';
// Phase 4C cache/analytics shipped ~May 6, 2026 16:00
const PHASE4C_BOUNDARY = '2026-05-06T16:00:00Z';

function classifyEra(created_at: string): Era {
  if (created_at < PHASE3_BOUNDARY) return 'pre_phase3';
  if (created_at < PHASE4A_BOUNDARY) return 'post_phase3';
  if (created_at < PHASE4C_BOUNDARY) return 'post_phase4a';
  return 'post_phase4c';
}

const ERA_LABELS: Record<Era, string> = {
  pre_phase3: 'Pre-Phase 3 (before May 1)',
  post_phase3: 'Post-Phase 3 (May 1–5)',
  post_phase4a: 'Post-Phase 4A (May 5–6)',
  post_phase4c: 'Post-Phase 4C (May 6+)',
};

/* ------------------------------------------------------------------ */
/*  Reason classification                                              */
/* ------------------------------------------------------------------ */

const REASON_LABELS: Record<FailureReason, string> = {
  gate_template_fidelity: 'Gate: Template Fidelity',
  gate_readability: 'Gate: Readability',
  gate_section_completeness: 'Gate: Section Completeness',
  gate_evidence_discipline: 'Gate: Evidence Discipline',
  gate_multi_dimension: 'Gate: Multi-Dimension Failure',
  provider_timeout: 'Provider/Stage Timeout',
  malformed_output: 'Malformed Output',
  stale_stuck_run: 'Stale/Stuck Run',
  auth_input_issue: 'Auth/Input Issue',
  unknown: 'Unknown',
};

const REASON_REMEDIATION: Record<FailureReason, RemediationType> = {
  gate_template_fidelity: 'section_reauthor',
  gate_readability: 'normalize_only',
  gate_section_completeness: 'section_reauthor',
  gate_evidence_discipline: 'evidence_rewrite',
  gate_multi_dimension: 'full_regen',
  provider_timeout: 'provider_retry',
  malformed_output: 'full_regen',
  stale_stuck_run: 'provider_retry',
  auth_input_issue: 'none',
  unknown: 'none',
};

function classifyReason(error: string | null, gate: ReturnType<typeof parseArtifactGate>): { reason: FailureReason; detail: string } {
  const err = error ?? '';

  // Timeout patterns
  if (/stage_timeout/i.test(err)) {
    return { reason: 'provider_timeout', detail: err };
  }
  if (/stale|stuck|watchdog/i.test(err)) {
    return { reason: 'stale_stuck_run', detail: err };
  }
  if (/auth|unauthorized|403|401/i.test(err)) {
    return { reason: 'auth_input_issue', detail: err };
  }
  if (/malformed|parse|json|syntax/i.test(err)) {
    return { reason: 'malformed_output', detail: err };
  }

  // Gate failures
  if (/artifact_gate_failed/i.test(err) || gate.pass === false) {
    const dims = gate.failed_dimensions;
    if (dims.length === 0) return { reason: 'unknown', detail: 'gate_failed but no dimensions' };
    if (dims.length >= 3) return { reason: 'gate_multi_dimension', detail: dims.join(', ') };
    if (dims.length === 2) {
      // If one is readability + another, classify by the other
      if (dims.includes('readability') && dims.length === 2) {
        const other = dims.find(d => d !== 'readability')!;
        if (other === 'template_fidelity') return { reason: 'gate_template_fidelity', detail: dims.join(', ') };
        if (other === 'section_completeness') return { reason: 'gate_section_completeness', detail: dims.join(', ') };
        if (other === 'evidence_discipline') return { reason: 'gate_evidence_discipline', detail: dims.join(', ') };
      }
      return { reason: 'gate_multi_dimension', detail: dims.join(', ') };
    }
    // Single dimension
    const dim = dims[0];
    if (dim === 'template_fidelity') return { reason: 'gate_template_fidelity', detail: dim };
    if (dim === 'readability') return { reason: 'gate_readability', detail: dim };
    if (dim === 'section_completeness') return { reason: 'gate_section_completeness', detail: dim };
    if (dim === 'evidence_discipline') return { reason: 'gate_evidence_discipline', detail: dim };
    return { reason: 'gate_multi_dimension', detail: dim };
  }

  if (err.trim()) return { reason: 'unknown', detail: err.slice(0, 200) };
  return { reason: 'unknown', detail: 'no error message' };
}

/* ------------------------------------------------------------------ */
/*  Core queries                                                       */
/* ------------------------------------------------------------------ */

interface RawRow {
  id: string;
  task_type: string;
  status: string;
  created_at: string;
  error: string | null;
  meta: Record<string, unknown> | null;
}

async function loadAllRuns(userId: string): Promise<RawRow[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, status, created_at, error, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as RawRow[];
}

/* ------------------------------------------------------------------ */
/*  1. Classify all failures                                           */
/* ------------------------------------------------------------------ */

export async function classifyFailures(userId: string): Promise<ClassifiedFailure[]> {
  const rows = await loadAllRuns(userId);
  return rows
    .filter(r => r.status === 'failed')
    .map(r => {
      const gate = parseArtifactGate(r.meta);
      const { reason, detail } = classifyReason(r.error, gate);
      const tokens = parseTokenUsage(r.meta);
      return {
        id: r.id,
        task_type: r.task_type,
        created_at: r.created_at,
        era: classifyEra(r.created_at),
        reason,
        reason_detail: detail,
        failed_dimensions: gate.failed_dimensions,
        regen_attempted: (gate.regen_attempts ?? 0) > 0,
        regen_succeeded: (gate.regen_attempts ?? 0) > 0 && gate.pass === true,
        cost_wasted: parseCost(r.meta) ?? 0,
        stage_failed: extractFailedStage(r.error),
        provider: null, // enriched from telemetry if available
        model: null,
        tokens_in: tokens.input,
        tokens_out: tokens.output,
      };
    });
}

function extractFailedStage(error: string | null): string | null {
  if (!error) return null;
  const m = error.match(/stage_timeout:(\S+)/);
  if (m) return m[1];
  if (/artifact_gate/i.test(error)) return 'artifact_gate';
  return null;
}

/* ------------------------------------------------------------------ */
/*  2. Cohort summaries                                                */
/* ------------------------------------------------------------------ */

export async function getCohortSummaries(userId: string): Promise<CohortSummary[]> {
  const rows = await loadAllRuns(userId);
  const failures = await classifyFailures(userId);

  const eras: Era[] = ['pre_phase3', 'post_phase3', 'post_phase4a', 'post_phase4c'];
  return eras.map(era => {
    const eraRows = rows.filter(r => classifyEra(r.created_at) === era);
    const eraFails = failures.filter(f => f.era === era);
    const total = eraRows.length;
    const failed = eraFails.length;
    const completed = total - failed;
    const totalWaste = eraFails.reduce((s, f) => s + f.cost_wasted, 0);

    // Top reasons
    const reasonCounts = new Map<FailureReason, number>();
    for (const f of eraFails) {
      reasonCounts.set(f.reason, (reasonCounts.get(f.reason) ?? 0) + 1);
    }
    const topReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count, pct: failed > 0 ? (count / failed) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      era,
      label: ERA_LABELS[era],
      total,
      failed,
      completed,
      failure_rate: total > 0 ? (failed / total) * 100 : 0,
      top_reasons: topReasons,
      total_waste_usd: totalWaste,
    };
  }).filter(c => c.total > 0);
}

/* ------------------------------------------------------------------ */
/*  3. Failure breakdown by reason                                     */
/* ------------------------------------------------------------------ */

export async function getFailureBreakdown(userId: string): Promise<FailureBreakdown[]> {
  const failures = await classifyFailures(userId);
  const total = failures.length;

  const byReason = new Map<FailureReason, ClassifiedFailure[]>();
  for (const f of failures) {
    const arr = byReason.get(f.reason) ?? [];
    arr.push(f);
    byReason.set(f.reason, arr);
  }

  return Array.from(byReason.entries())
    .map(([reason, runs]) => {
      const waste = runs.reduce((s, r) => s + r.cost_wasted, 0);
      return {
        reason,
        label: REASON_LABELS[reason],
        count: runs.length,
        pct: total > 0 ? (runs.length / total) * 100 : 0,
        total_waste_usd: waste,
        avg_waste_usd: runs.length > 0 ? waste / runs.length : 0,
        remediation_type: REASON_REMEDIATION[reason],
      };
    })
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/*  4. Waste summary for dashboard headline                            */
/* ------------------------------------------------------------------ */

export interface WasteSummary {
  total_failures: number;
  total_waste_usd: number;
  historical_failures: number;       // pre-phase3
  historical_waste_usd: number;
  current_failures: number;          // post-phase3+
  current_waste_usd: number;
  top_reason: FailureReason | null;
  top_reason_count: number;
  recoverable_failures: number;      // failures with non-'none' remediation
  recoverable_waste_usd: number;
}

export async function getWasteSummary(userId: string): Promise<WasteSummary> {
  const failures = await classifyFailures(userId);
  const total = failures.length;
  const totalWaste = failures.reduce((s, f) => s + f.cost_wasted, 0);
  const historical = failures.filter(f => f.era === 'pre_phase3');
  const current = failures.filter(f => f.era !== 'pre_phase3');

  const reasonCounts = new Map<FailureReason, number>();
  for (const f of failures) {
    reasonCounts.set(f.reason, (reasonCounts.get(f.reason) ?? 0) + 1);
  }
  let topReason: FailureReason | null = null;
  let topCount = 0;
  for (const [r, c] of reasonCounts) {
    if (c > topCount) { topReason = r; topCount = c; }
  }

  const recoverable = failures.filter(f => REASON_REMEDIATION[f.reason] !== 'none' && REASON_REMEDIATION[f.reason] !== 'full_regen');

  return {
    total_failures: total,
    total_waste_usd: totalWaste,
    historical_failures: historical.length,
    historical_waste_usd: historical.reduce((s, f) => s + f.cost_wasted, 0),
    current_failures: current.length,
    current_waste_usd: current.reduce((s, f) => s + f.cost_wasted, 0),
    top_reason: topReason,
    top_reason_count: topCount,
    recoverable_failures: recoverable.length,
    recoverable_waste_usd: recoverable.reduce((s, f) => s + f.cost_wasted, 0),
  };
}

/* ------------------------------------------------------------------ */
/*  Exports for dashboard & tests                                      */
/* ------------------------------------------------------------------ */

export { REASON_LABELS, REASON_REMEDIATION, ERA_LABELS, classifyEra, classifyReason };
