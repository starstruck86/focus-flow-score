import { describe, it, expect } from 'vitest';
import {
  parseArtifactGate,
  parseAnomalyFlags,
  parseTokenUsage,
  parseCost,
  parseStageLats,
  parseRemediation,
} from '../queries';

describe('parseArtifactGate', () => {
  it('handles sections_passed as array of strings', () => {
    const meta = { artifact_gate: { pass: true, sections_passed: ['situation', 'commercial', 'insight'], sections_failed: [], regen_attempts: 0, total_gate_latency_ms: 42 } };
    const g = parseArtifactGate(meta);
    expect(g.sections_passed).toBe(3);
    expect(g.sections_failed).toBe(0);
    expect(g.gate_latency_ms).toBe(42);
    expect(g.pass).toBe(true);
  });

  it('handles sections_passed as number', () => {
    const meta = { artifact_gate: { pass: true, sections_passed: 6, sections_failed: 1, gate_latency_ms: 50 } };
    const g = parseArtifactGate(meta);
    expect(g.sections_passed).toBe(6);
    expect(g.sections_failed).toBe(1);
    expect(g.gate_latency_ms).toBe(50);
  });

  it('returns defaults for missing meta', () => {
    expect(parseArtifactGate(null).pass).toBeUndefined();
    expect(parseArtifactGate(null).failed_dimensions).toEqual([]);
    expect(parseArtifactGate(undefined).sections_passed).toBeUndefined();
  });

  it('handles failed_dimensions as non-array gracefully', () => {
    const meta = { artifact_gate: { failed_dimensions: 'oops' } };
    expect(parseArtifactGate(meta).failed_dimensions).toEqual([]);
  });
});

describe('parseAnomalyFlags', () => {
  it('handles object shape {flag: true}', () => {
    const meta = { anomaly_flags: { latency_violation: true, regen_triggered: true } };
    const flags = parseAnomalyFlags(meta);
    expect(flags).toContain('latency_violation');
    expect(flags).toContain('regen_triggered');
    expect(flags).toHaveLength(2);
  });

  it('handles array shape', () => {
    const meta = { anomaly_flags: ['latency_violation'] };
    expect(parseAnomalyFlags(meta)).toEqual(['latency_violation']);
  });

  it('ignores false values in object shape', () => {
    const meta = { anomaly_flags: { latency_violation: true, other: false } };
    expect(parseAnomalyFlags(meta)).toEqual(['latency_violation']);
  });

  it('returns empty for null/undefined/missing', () => {
    expect(parseAnomalyFlags(null)).toEqual([]);
    expect(parseAnomalyFlags({})).toEqual([]);
    expect(parseAnomalyFlags({ anomaly_flags: null })).toEqual([]);
  });
});

describe('parseTokenUsage', () => {
  it('handles total_input/total_output shape', () => {
    const meta = { token_usage: { total_input: 12913, total_output: 9386 } };
    const t = parseTokenUsage(meta);
    expect(t.input).toBe(12913);
    expect(t.output).toBe(9386);
  });

  it('handles input_tokens/output_tokens shape', () => {
    const meta = { token_usage: { input_tokens: 500, output_tokens: 200 } };
    const t = parseTokenUsage(meta);
    expect(t.input).toBe(500);
    expect(t.output).toBe(200);
  });

  it('returns null for missing', () => {
    const t = parseTokenUsage(null);
    expect(t.input).toBeNull();
    expect(t.output).toBeNull();
  });
});

describe('parseCost', () => {
  it('handles number', () => expect(parseCost({ cost_estimate_usd: 0.1586 })).toBe(0.1586));
  it('handles string', () => expect(parseCost({ cost_estimate_usd: '0.25' })).toBe(0.25));
  it('handles null', () => expect(parseCost(null)).toBeNull());
  it('handles missing key', () => expect(parseCost({})).toBeNull());
  it('handles NaN string', () => expect(parseCost({ cost_estimate_usd: 'abc' })).toBeNull());
});

describe('parseStageLats', () => {
  it('returns empty for null meta', () => expect(parseStageLats(null)).toEqual({}));
  it('returns latencies object', () => {
    const meta = { stage_latencies: { research: 14000, synthesis: 60000 } };
    expect(parseStageLats(meta)).toEqual({ research: 14000, synthesis: 60000 });
});

describe('parseRemediation', () => {
  it('returns null for meta without remediation', () => {
    expect(parseRemediation(null)).toBeNull();
    expect(parseRemediation({})).toBeNull();
    expect(parseRemediation({ artifact_gate: { pass: true } })).toBeNull();
  });

  it('parses full remediation block', () => {
    const meta = {
      remediation: {
        remediation_attempted: true,
        remediation_type: 'normalize_only',
        remediation_success: true,
        remediation_latency_ms: 42,
        remediation_cost_estimate_usd: 0,
        avoided_full_regen_estimate_usd: 0.16,
        fallback_to_hard_fail: false,
        sections_targeted: ['readability'],
      },
    };
    const r = parseRemediation(meta);
    expect(r).not.toBeNull();
    expect(r!.attempted).toBe(true);
    expect(r!.type).toBe('normalize_only');
    expect(r!.success).toBe(true);
    expect(r!.latency_ms).toBe(42);
    expect(r!.cost_usd).toBe(0);
    expect(r!.avoided_usd).toBe(0.16);
    expect(r!.fallback).toBe(false);
    expect(r!.sections).toEqual(['readability']);
  });

  it('handles failed remediation with error', () => {
    const meta = {
      remediation: {
        remediation_attempted: true,
        remediation_type: 'section_reauthor',
        remediation_success: false,
        fallback_to_hard_fail: true,
        error: 'Gate still failed',
        sections_targeted: [],
      },
    };
    const r = parseRemediation(meta);
    expect(r!.success).toBe(false);
    expect(r!.fallback).toBe(true);
    expect(r!.error).toBe('Gate still failed');
  });
});
});
