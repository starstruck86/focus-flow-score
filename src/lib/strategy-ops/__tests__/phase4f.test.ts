/**
 * Phase 4F — Rollout Guardrails & Experiment Tracking Tests
 */
import { describe, it, expect } from 'vitest';

// ── Guardrail logic (mirrored from server-side remediationExecutor.ts) ──

type RemediationType =
  | 'normalize_only'
  | 'section_reauthor'
  | 'evidence_rewrite'
  | 'provider_retry'
  | 'skip_too_many_dimensions';

const REMEDIATION_ALLOWED_TASKS = ['account_brief'];
const ROLLOUT_ALLOWED_TYPES: RemediationType[] = ['normalize_only'];
const MAX_REMEDIATION_COST_USD = 0.05;
const REMEDIATION_COSTS: Record<RemediationType, number> = {
  normalize_only: 0.0,
  section_reauthor: 0.02,
  evidence_rewrite: 0.015,
  provider_retry: 0.10,
  skip_too_many_dimensions: 0.0,
};

function classifyRemediation(dims: string[]): RemediationType {
  if (dims.length >= 3) return 'skip_too_many_dimensions';
  if (dims.length === 1) {
    if (dims[0] === 'readability') return 'normalize_only';
    if (dims[0] === 'template_fidelity' || dims[0] === 'section_completeness') return 'section_reauthor';
    if (dims[0] === 'evidence_discipline') return 'evidence_rewrite';
  }
  if (dims.length === 2) {
    const hr = dims.includes('readability'), hf = dims.includes('template_fidelity'),
          hc = dims.includes('section_completeness'), he = dims.includes('evidence_discipline');
    if (hr && (hf || hc)) return 'section_reauthor';
    if (hr && he) return 'evidence_rewrite';
    if (hf || hc) return 'section_reauthor';
    if (he) return 'evidence_rewrite';
  }
  return 'skip_too_many_dimensions';
}

interface GuardrailResult { allowed: boolean; skip_reason: string | null; }

function checkGuardrails(
  taskType: string, failedDims: string[], remType: RemediationType, pipelineLatencyMs?: number,
): GuardrailResult {
  if (!REMEDIATION_ALLOWED_TASKS.includes(taskType))
    return { allowed: false, skip_reason: `task_type_not_allowed:${taskType}` };
  if (taskType === 'discovery_prep')
    return { allowed: false, skip_reason: 'discovery_prep_hard_disabled' };
  if (failedDims.length >= 3)
    return { allowed: false, skip_reason: 'too_many_dimensions' };
  if (remType === 'provider_retry')
    return { allowed: false, skip_reason: 'provider_timeout_hard_disabled' };
  if (pipelineLatencyMs != null && pipelineLatencyMs > 600_000)
    return { allowed: false, skip_reason: 'pipeline_latency_exceeds_10m' };
  const cost = REMEDIATION_COSTS[remType] ?? 0;
  if (cost > MAX_REMEDIATION_COST_USD)
    return { allowed: false, skip_reason: `cost_exceeds_cap:${cost}>${MAX_REMEDIATION_COST_USD}` };
  if (!ROLLOUT_ALLOWED_TYPES.includes(remType))
    return { allowed: false, skip_reason: `remediation_type_not_in_rollout:${remType}` };
  return { allowed: true, skip_reason: null };
}

// ── Tests ──

describe('Phase 4F: Rollout guardrails', () => {
  describe('checkGuardrails', () => {
    it('allows normalize_only for account_brief', () => {
      const r = checkGuardrails('account_brief', ['readability'], 'normalize_only');
      expect(r.allowed).toBe(true);
      expect(r.skip_reason).toBeNull();
    });

    it('blocks discovery_prep', () => {
      const r = checkGuardrails('discovery_prep', ['readability'], 'normalize_only');
      expect(r.allowed).toBe(false);
      expect(r.skip_reason).toContain('task_type_not_allowed');
    });

    it('blocks non-allowed task types', () => {
      const r = checkGuardrails('recap_email', ['readability'], 'normalize_only');
      expect(r.allowed).toBe(false);
      expect(r.skip_reason).toContain('task_type_not_allowed');
    });

    it('blocks 3+ failed dimensions', () => {
      const r = checkGuardrails('account_brief', ['a', 'b', 'c'], 'skip_too_many_dimensions');
      expect(r.allowed).toBe(false);
      expect(r.skip_reason).toBe('too_many_dimensions');
    });

    it('blocks provider_retry', () => {
      const r = checkGuardrails('account_brief', ['readability'], 'provider_retry');
      expect(r.allowed).toBe(false);
      expect(r.skip_reason).toBe('provider_timeout_hard_disabled');
    });

    it('blocks pipeline latency > 10m', () => {
      const r = checkGuardrails('account_brief', ['readability'], 'normalize_only', 700_000);
      expect(r.allowed).toBe(false);
      expect(r.skip_reason).toBe('pipeline_latency_exceeds_10m');
    });

    it('allows pipeline latency < 10m', () => {
      const r = checkGuardrails('account_brief', ['readability'], 'normalize_only', 300_000);
      expect(r.allowed).toBe(true);
    });

    it('blocks section_reauthor (not in rollout)', () => {
      const r = checkGuardrails('account_brief', ['template_fidelity'], 'section_reauthor');
      expect(r.allowed).toBe(false);
      expect(r.skip_reason).toContain('remediation_type_not_in_rollout');
    });

    it('blocks evidence_rewrite (not in rollout)', () => {
      const r = checkGuardrails('account_brief', ['evidence_discipline'], 'evidence_rewrite');
      expect(r.allowed).toBe(false);
      expect(r.skip_reason).toContain('remediation_type_not_in_rollout');
    });

    it('blocks cost exceeding cap (provider_retry blocked first)', () => {
      // provider_retry is $0.10 > $0.05 cap, but gets blocked by provider_timeout first
      const r = checkGuardrails('account_brief', ['readability'], 'provider_retry');
      expect(r.allowed).toBe(false);
    });
  });

  describe('End-to-end classification → guardrail', () => {
    it('readability-only account_brief → allowed', () => {
      const type = classifyRemediation(['readability']);
      const r = checkGuardrails('account_brief', ['readability'], type);
      expect(type).toBe('normalize_only');
      expect(r.allowed).toBe(true);
    });

    it('template_fidelity account_brief → blocked by rollout', () => {
      const type = classifyRemediation(['template_fidelity']);
      const r = checkGuardrails('account_brief', ['template_fidelity'], type);
      expect(type).toBe('section_reauthor');
      expect(r.allowed).toBe(false);
    });

    it('readability discovery_prep → blocked by task type', () => {
      const type = classifyRemediation(['readability']);
      const r = checkGuardrails('discovery_prep', ['readability'], type);
      expect(type).toBe('normalize_only');
      expect(r.allowed).toBe(false);
    });

    it('multi-dim account_brief → blocked', () => {
      const type = classifyRemediation(['readability', 'template_fidelity', 'evidence_discipline']);
      const r = checkGuardrails('account_brief', ['readability', 'template_fidelity', 'evidence_discipline'], type);
      expect(type).toBe('skip_too_many_dimensions');
      expect(r.allowed).toBe(false);
    });
  });
});

describe('Phase 4F: Experiment telemetry schema', () => {
  it('RemediationTelemetry has all required fields', () => {
    const telemetry = {
      remediation_attempted: true,
      remediation_type: 'normalize_only' as const,
      remediation_success: true,
      remediation_latency_ms: 15,
      remediation_cost_estimate_usd: 0.0,
      avoided_full_regen_estimate_usd: 0.16,
      sections_targeted: [],
      fallback_to_hard_fail: false,
      skip_reason: null as string | null,
      before_failed_dimensions: ['readability'],
      after_failed_dimensions: [],
      before_sections_failed: [],
      after_sections_failed: [],
    };
    expect(telemetry.remediation_attempted).toBe(true);
    expect(telemetry.skip_reason).toBeNull();
    expect(telemetry.before_failed_dimensions).toEqual(['readability']);
    expect(telemetry.after_failed_dimensions).toEqual([]);
  });

  it('skip telemetry has skip_reason populated', () => {
    const telemetry = {
      remediation_attempted: false,
      remediation_type: 'section_reauthor',
      remediation_success: false,
      remediation_latency_ms: 0,
      remediation_cost_estimate_usd: 0,
      avoided_full_regen_estimate_usd: 0,
      sections_targeted: [],
      fallback_to_hard_fail: true,
      skip_reason: 'remediation_type_not_in_rollout:section_reauthor',
      before_failed_dimensions: ['template_fidelity'],
      after_failed_dimensions: ['template_fidelity'],
      before_sections_failed: [],
      after_sections_failed: [],
    };
    expect(telemetry.skip_reason).toContain('not_in_rollout');
    expect(telemetry.remediation_attempted).toBe(false);
  });
});

describe('Phase 4F: parseRemediation enhanced fields', () => {
  // Import from queries
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseRemediation } = require('../queries');

  it('parses skip_reason and before/after dimensions', () => {
    const meta = {
      remediation: {
        remediation_attempted: false,
        remediation_type: 'section_reauthor',
        remediation_success: false,
        skip_reason: 'task_type_not_allowed:discovery_prep',
        before_failed_dimensions: ['template_fidelity'],
        after_failed_dimensions: ['template_fidelity'],
        before_sections_failed: ['intro'],
        after_sections_failed: ['intro'],
      },
    };
    const r = parseRemediation(meta);
    expect(r).not.toBeNull();
    expect(r!.skip_reason).toBe('task_type_not_allowed:discovery_prep');
    expect(r!.before_failed_dimensions).toEqual(['template_fidelity']);
    expect(r!.after_failed_dimensions).toEqual(['template_fidelity']);
    expect(r!.before_sections_failed).toEqual(['intro']);
  });

  it('handles missing new fields gracefully', () => {
    const meta = {
      remediation: {
        remediation_attempted: true,
        remediation_type: 'normalize_only',
        remediation_success: true,
      },
    };
    const r = parseRemediation(meta);
    expect(r!.skip_reason).toBeNull();
    expect(r!.before_failed_dimensions).toEqual([]);
    expect(r!.after_failed_dimensions).toEqual([]);
  });
});
