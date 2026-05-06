/**
 * Phase 4D — Targeted Remediation Framework
 *
 * Feature-flagged. Default OFF. Does NOT weaken gates or bypass artifact gate.
 * Selects the minimal fix strategy based on failure classification.
 *
 * This module is declaration-only on the client side. The actual remediation
 * execution would happen server-side (edge function). This module provides:
 * - Remediation type selection logic
 * - Cost estimation for targeted vs full regen
 * - Logging contract types
 */
import { isStrategyFlagEnabled } from './strategyFeatureFlags';
import type { FailureReason, RemediationType, ClassifiedFailure } from './failureAnalysis';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RemediationPlan {
  run_id: string;
  failure_reason: FailureReason;
  remediation_type: RemediationType;
  estimated_cost_usd: number;
  avoided_full_regen_usd: number;
  sections_targeted: string[];
  requires_llm: boolean;
  description: string;
}

export interface RemediationResult {
  run_id: string;
  remediation_type: RemediationType;
  success: boolean;
  actual_cost_usd: number;
  avoided_full_regen_usd: number;
  duration_ms: number;
  gate_passed_after: boolean;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Cost estimates per remediation type                                 */
/* ------------------------------------------------------------------ */

const ESTIMATED_COSTS: Record<RemediationType, number> = {
  normalize_only: 0.0,        // No LLM call
  section_reauthor: 0.02,     // 1 section × 1 LLM call
  evidence_rewrite: 0.015,    // Citation rewrite, lighter prompt
  provider_retry: 0.10,       // Full retry but with different provider
  full_regen: 0.16,           // Average full run cost
  none: 0.0,
};

const AVG_FULL_REGEN_COST = 0.16; // Based on production data

/* ------------------------------------------------------------------ */
/*  Plan generation                                                    */
/* ------------------------------------------------------------------ */

export function isRemediationEnabled(): boolean {
  return isStrategyFlagEnabled('targeted_remediation_enabled' as any);
}

export function planRemediation(failure: ClassifiedFailure): RemediationPlan | null {
  if (!isRemediationEnabled()) return null;

  const type = selectRemediationType(failure);
  if (type === 'none') return null;

  const estimated = ESTIMATED_COSTS[type];
  const avoided = Math.max(0, AVG_FULL_REGEN_COST - estimated);

  return {
    run_id: failure.id,
    failure_reason: failure.reason,
    remediation_type: type,
    estimated_cost_usd: estimated,
    avoided_full_regen_usd: avoided,
    sections_targeted: failure.failed_dimensions,
    requires_llm: type !== 'normalize_only',
    description: describeRemediation(type, failure),
  };
}

function selectRemediationType(failure: ClassifiedFailure): RemediationType {
  switch (failure.reason) {
    case 'gate_readability':
      return 'normalize_only';
    case 'gate_template_fidelity':
    case 'gate_section_completeness':
      return 'section_reauthor';
    case 'gate_evidence_discipline':
      return 'evidence_rewrite';
    case 'provider_timeout':
    case 'stale_stuck_run':
      return 'provider_retry';
    case 'gate_multi_dimension':
      return failure.failed_dimensions.length <= 2 ? 'section_reauthor' : 'full_regen';
    default:
      return 'none';
  }
}

function describeRemediation(type: RemediationType, failure: ClassifiedFailure): string {
  switch (type) {
    case 'normalize_only':
      return 'Re-run readability normalization without LLM calls. Zero cost.';
    case 'section_reauthor':
      return `Re-author ${failure.failed_dimensions.join(', ')} section(s) only. Preserves passing sections.`;
    case 'evidence_rewrite':
      return 'Rewrite citation/causal evidence chains only. Lighter prompt than full regen.';
    case 'provider_retry':
      return 'Retry with fallback provider. Original timeout was likely transient.';
    case 'full_regen':
      return 'Full regeneration required. Too many dimensions failed for targeted fix.';
    default:
      return 'No automated remediation available.';
  }
}

/* ------------------------------------------------------------------ */
/*  Aggregate remediation opportunity                                  */
/* ------------------------------------------------------------------ */

export interface RemediationOpportunity {
  type: RemediationType;
  label: string;
  count: number;
  estimated_savings_usd: number;
  requires_llm: boolean;
}

export function aggregateRemediationOpportunities(
  failures: ClassifiedFailure[]
): RemediationOpportunity[] {
  const byType = new Map<RemediationType, ClassifiedFailure[]>();
  for (const f of failures) {
    const type = selectRemediationType(f);
    if (type === 'none') continue;
    const arr = byType.get(type) ?? [];
    arr.push(f);
    byType.set(type, arr);
  }

  const LABELS: Record<RemediationType, string> = {
    normalize_only: 'Readability Normalize (no LLM)',
    section_reauthor: 'Section Re-Author',
    evidence_rewrite: 'Evidence Rewrite',
    provider_retry: 'Provider Retry',
    full_regen: 'Full Regeneration',
    none: 'No Remediation',
  };

  return Array.from(byType.entries())
    .map(([type, runs]) => ({
      type,
      label: LABELS[type],
      count: runs.length,
      estimated_savings_usd: runs.length * Math.max(0, AVG_FULL_REGEN_COST - ESTIMATED_COSTS[type]),
      requires_llm: type !== 'normalize_only',
    }))
    .sort((a, b) => b.estimated_savings_usd - a.estimated_savings_usd);
}
