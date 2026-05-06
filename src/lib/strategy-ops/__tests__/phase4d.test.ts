/**
 * Phase 4D — Failure Analysis & Remediation Tests
 */
import { describe, it, expect } from 'vitest';

// Import internal functions for testing
import { classifyEra, classifyReason, REASON_LABELS, ERA_LABELS } from '../failureAnalysis';
import { parseArtifactGate } from '../queries';

describe('classifyEra', () => {
  it('classifies pre-Phase-3 runs', () => {
    expect(classifyEra('2026-04-15T10:00:00Z')).toBe('pre_phase3');
    expect(classifyEra('2026-04-30T23:59:59Z')).toBe('pre_phase3');
  });
  it('classifies post-Phase-3 runs', () => {
    expect(classifyEra('2026-05-01T00:00:01Z')).toBe('post_phase3');
    expect(classifyEra('2026-05-04T12:00:00Z')).toBe('post_phase3');
  });
  it('classifies post-Phase-4A runs', () => {
    expect(classifyEra('2026-05-05T01:00:00Z')).toBe('post_phase4a');
    expect(classifyEra('2026-05-06T15:59:59Z')).toBe('post_phase4a');
  });
  it('classifies post-Phase-4C runs', () => {
    expect(classifyEra('2026-05-06T16:00:01Z')).toBe('post_phase4c');
    expect(classifyEra('2026-05-10T00:00:00Z')).toBe('post_phase4c');
  });
});

describe('classifyReason', () => {
  const makeGate = (pass?: boolean, dims?: string[]) => ({
    pass,
    failed_dimensions: dims ?? [],
    sections_passed: undefined,
    sections_failed: undefined,
    regen_attempts: undefined,
    gate_latency_ms: undefined,
  });

  it('detects provider timeout', () => {
    const result = classifyReason('stage_timeout:synthesis (no progress for 417s)', makeGate());
    expect(result.reason).toBe('provider_timeout');
  });

  it('detects stale/stuck run', () => {
    const result = classifyReason('watchdog killed stale run', makeGate());
    expect(result.reason).toBe('stale_stuck_run');
  });

  it('detects auth issue', () => {
    const result = classifyReason('401 unauthorized', makeGate());
    expect(result.reason).toBe('auth_input_issue');
  });

  it('detects single template_fidelity gate failure', () => {
    const result = classifyReason('[artifact_gate_failed] Dimensions: template_fidelity', makeGate(false, ['template_fidelity']));
    expect(result.reason).toBe('gate_template_fidelity');
  });

  it('detects single readability gate failure', () => {
    const result = classifyReason('[artifact_gate_failed]', makeGate(false, ['readability']));
    expect(result.reason).toBe('gate_readability');
  });

  it('detects multi-dimension gate failure (3+)', () => {
    const result = classifyReason('[artifact_gate_failed]', makeGate(false, ['readability', 'section_completeness', 'evidence_discipline']));
    expect(result.reason).toBe('gate_multi_dimension');
  });

  it('detects 2-dim with readability + template_fidelity as template_fidelity', () => {
    const result = classifyReason('[artifact_gate_failed]', makeGate(false, ['readability', 'template_fidelity']));
    expect(result.reason).toBe('gate_template_fidelity');
  });

  it('returns unknown for empty error and no gate', () => {
    const result = classifyReason(null, makeGate());
    expect(result.reason).toBe('unknown');
  });

  it('detects malformed output', () => {
    const result = classifyReason('JSON parse error in response', makeGate());
    expect(result.reason).toBe('malformed_output');
  });
});

describe('REASON_LABELS', () => {
  it('has labels for all reasons', () => {
    const reasons = [
      'gate_template_fidelity', 'gate_readability', 'gate_section_completeness',
      'gate_evidence_discipline', 'gate_multi_dimension', 'provider_timeout',
      'malformed_output', 'stale_stuck_run', 'auth_input_issue', 'unknown',
    ];
    for (const r of reasons) {
      expect(REASON_LABELS[r as keyof typeof REASON_LABELS]).toBeTruthy();
    }
  });
});

describe('ERA_LABELS', () => {
  it('has labels for all eras', () => {
    expect(ERA_LABELS.pre_phase3).toBeTruthy();
    expect(ERA_LABELS.post_phase3).toBeTruthy();
    expect(ERA_LABELS.post_phase4a).toBeTruthy();
    expect(ERA_LABELS.post_phase4c).toBeTruthy();
  });
});

// Remediation tests
import { aggregateRemediationOpportunities } from '../targetedRemediation';
import type { ClassifiedFailure } from '../failureAnalysis';

describe('aggregateRemediationOpportunities', () => {
  const makeFailure = (reason: string, dims: string[] = []): ClassifiedFailure => ({
    id: 'test-id',
    task_type: 'discovery_prep',
    created_at: '2026-05-06T12:00:00Z',
    era: 'post_phase4a',
    reason: reason as any,
    reason_detail: 'test',
    failed_dimensions: dims,
    regen_attempted: false,
    regen_succeeded: false,
    cost_wasted: 0.10,
    stage_failed: null,
    provider: null,
    model: null,
    tokens_in: null,
    tokens_out: null,
  });

  it('groups failures by remediation type', () => {
    const failures = [
      makeFailure('gate_readability'),
      makeFailure('gate_readability'),
      makeFailure('gate_template_fidelity', ['template_fidelity']),
      makeFailure('provider_timeout'),
    ];
    const opps = aggregateRemediationOpportunities(failures);
    expect(opps.length).toBeGreaterThan(0);
    const normalizeOpp = opps.find(o => o.type === 'normalize_only');
    expect(normalizeOpp?.count).toBe(2);
    expect(normalizeOpp?.requires_llm).toBe(false);
  });

  it('excludes "none" remediation types', () => {
    const failures = [makeFailure('unknown'), makeFailure('auth_input_issue')];
    const opps = aggregateRemediationOpportunities(failures);
    expect(opps.length).toBe(0);
  });
});
