// @vitest-environment node
/**
 * Drift CI — server/client parity for methodologySeeds injection.
 *
 * Proves:
 *  1. Both planners inject seeds identically (source parity)
 *  2. Both dedupe case-insensitively
 *  3. Seeds are included in planHash
 *  4. Adding/removing a seed changes planHash
 *  5. No skill-specific branch logic
 *  6. Behavioral parity: identical manifest+inputs → identical output fields
 *  7. Universality: multiple unrelated manifests treated identically
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildPlan as clientBuildPlan } from '../planner';
import { buildPlan as serverBuildPlan } from '../../../../supabase/functions/_shared/strategy-skills/planner';
import type { SkillManifest } from '../types';
import type { PlannerContext } from '../planner';

// ── Fixtures ───────────────────────────────────────────────────────

const CTX: PlannerContext = {
  thread: {
    threadId: 't-drift',
    account: { id: 'acc-1', name: 'DriftCo', industry: 'tech' },
    opportunity: { id: 'opp-1', name: 'Deal', stage: 'negotiation' },
  },
};

const baseManifest: SkillManifest = {
  id: 'drift-test-skill',
  label: 'Drift Test',
  description: 'Used only for drift CI.',
  behaviorIntent: 'account_brief',
  workspace: 'artifacts',
  depth: 'standard',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items'],
    termBindings: ['${inputs.account}'],
    methodologySeeds: ['alpha', 'beta', 'gamma'],
    minRelevantItems: 1,
  },
  output: { shape: 'prose' },
  rubric: { mustHave: ['summary'], genericMarkers: [], maxGenericMarkers: 0 },
  version: '1',
};

/** Second fake manifest — totally different domain seeds. */
const renewalRiskManifest: SkillManifest = {
  id: 'renewal-risk-review',
  label: 'Renewal Risk Review',
  description: 'Customer retention risk analysis.',
  behaviorIntent: 'account_brief',
  workspace: 'artifacts',
  depth: 'deep',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks'],
    termBindings: ['${inputs.account}', '${inputs.segment}'],
    methodologySeeds: [
      'renewal risk', 'expansion trigger', 'executive alignment',
      'churn signal', 'health score', 'QBR cadence',
    ],
    minRelevantItems: 2,
  },
  output: { shape: 'structured_artifact' },
  rubric: { mustHave: ['risk factors', 'expansion signals'], genericMarkers: ['all good'], maxGenericMarkers: 0 },
  version: '1',
};

function clientPlan(manifest: SkillManifest, inputs: Record<string, string>) {
  return clientBuildPlan({ manifest, effectiveDepth: manifest.depth, inputs } as any, CTX);
}

function serverPlan(manifest: SkillManifest, inputs: Record<string, string>) {
  return serverBuildPlan(manifest, manifest.depth, inputs, CTX);
}

// ── 1. Source parity ───────────────────────────────────────────────

describe('Drift CI: server/client methodologySeeds parity', () => {
  it('server planner has identical seed injection source pattern', () => {
    const serverSrc = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/_shared/strategy-skills/planner.ts'),
      'utf-8',
    );
    expect(serverSrc).toContain('const termSeeds = [...resolvedSeeds]');
    expect(serverSrc).toContain('new Set(termSeeds.map(s => s.toLowerCase()))');
    expect(serverSrc).toContain("manifest.retrieval.methodologySeeds ?? []");
    expect(serverSrc).toContain('seenLower.has(lower)');
    expect(serverSrc).toContain('seenLower.add(lower)');
    expect(serverSrc).toContain('termSeeds.push(seed)');

    const clientSrc = readFileSync(
      resolve(__dirname, '../planner/buildPlan.ts'),
      'utf-8',
    );
    expect(clientSrc).toContain('const termSeeds = [...resolvedSeeds]');
    expect(clientSrc).toContain('new Set(termSeeds.map(s => s.toLowerCase()))');
    expect(clientSrc).toContain("m.retrieval.methodologySeeds ?? []");
    expect(clientSrc).toContain('seenLower.has(lower)');
    expect(clientSrc).toContain('seenLower.add(lower)');
    expect(clientSrc).toContain('termSeeds.push(seed)');
  });

  it('no skill-specific branch logic in either planner', () => {
    const serverSrc = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/_shared/strategy-skills/planner.ts'),
      'utf-8',
    );
    const clientSrc = readFileSync(
      resolve(__dirname, '../planner/buildPlan.ts'),
      'utf-8',
    );
    for (const src of [serverSrc, clientSrc]) {
      expect(src).not.toMatch(/if\s*\(.*['"]meddicc/i);
      expect(src).not.toMatch(/if\s*\(.*skillId\s*===\s*['"]/);
      expect(src).not.toMatch(/switch\s*\(\s*.*skillId/);
    }
  });

  // ── 2. Case-insensitive dedup ──────────────────────────────────

  it('deduplicates seeds case-insensitively against user inputs', () => {
    const r = clientPlan(
      { ...baseManifest, retrieval: { ...baseManifest.retrieval, methodologySeeds: ['Alpha', 'BETA', 'gamma'] } },
      { account: 'alpha' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    expect(lower.filter(t => t === 'alpha').length).toBe(1);
  });

  // ── 3. Seeds included in planHash ──────────────────────────────

  it('seeds are reflected in planHash', () => {
    const r = clientPlan(baseManifest, { account: 'DriftCo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.termSeeds).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
    expect(r.plan.planHash).toBeTruthy();
  });

  // ── 4. Adding/removing seed changes planHash ───────────────────

  it('adding a seed changes planHash', () => {
    const r1 = clientPlan(baseManifest, { account: 'DriftCo' });
    const extended = { ...baseManifest, retrieval: { ...baseManifest.retrieval, methodologySeeds: ['alpha', 'beta', 'gamma', 'delta'] } };
    const r2 = clientPlan(extended, { account: 'DriftCo' });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.plan.planHash).not.toBe(r2.plan.planHash);
  });

  it('removing a seed changes planHash', () => {
    const r1 = clientPlan(baseManifest, { account: 'DriftCo' });
    const reduced = { ...baseManifest, retrieval: { ...baseManifest.retrieval, methodologySeeds: ['alpha'] } };
    const r2 = clientPlan(reduced, { account: 'DriftCo' });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.plan.planHash).not.toBe(r2.plan.planHash);
  });

  // ── 5. Behavioral parity: same manifest+inputs → same output ──

  it('client and server produce identical termSeeds ordering', () => {
    const inputs = { account: 'DriftCo' };
    const c = clientPlan(baseManifest, inputs);
    const s = serverPlan(baseManifest, inputs);
    expect(c.ok && s.ok).toBe(true);
    if (!c.ok || !s.ok) return;
    expect(c.plan.termSeeds).toEqual(s.plan.termSeeds);
  });

  it('client and server produce identical unresolvedBindings', () => {
    const inputs = { account: 'DriftCo' }; // missing other bindings if any
    const c = clientPlan(baseManifest, inputs);
    const s = serverPlan(baseManifest, inputs);
    expect(c.ok && s.ok).toBe(true);
    if (!c.ok || !s.ok) return;
    expect([...c.plan.unresolvedBindings]).toEqual([...s.plan.unresolvedBindings]);
  });

  it('client and server produce identical scopes and filters', () => {
    const inputs = { account: 'DriftCo' };
    const c = clientPlan(baseManifest, inputs);
    const s = serverPlan(baseManifest, inputs);
    expect(c.ok && s.ok).toBe(true);
    if (!c.ok || !s.ok) return;
    expect([...c.plan.scopes]).toEqual([...s.plan.scopes]);
    expect(c.plan.filters).toEqual(s.plan.filters);
  });

  it('client and server produce identical planHash', () => {
    const inputs = { account: 'DriftCo' };
    const c = clientPlan(baseManifest, inputs);
    const s = serverPlan(baseManifest, inputs);
    expect(c.ok && s.ok).toBe(true);
    if (!c.ok || !s.ok) return;
    expect(c.plan.planHash).toBe(s.plan.planHash);
  });

  it('behavioral parity holds for renewal-risk manifest too', () => {
    const inputs = { account: 'RetainCo', segment: 'enterprise' };
    const c = clientPlan(renewalRiskManifest, inputs);
    const s = serverPlan(renewalRiskManifest, inputs);
    expect(c.ok && s.ok).toBe(true);
    if (!c.ok || !s.ok) return;
    expect(c.plan.termSeeds).toEqual(s.plan.termSeeds);
    expect(c.plan.planHash).toBe(s.plan.planHash);
    expect([...c.plan.unresolvedBindings]).toEqual([...s.plan.unresolvedBindings]);
    expect([...c.plan.scopes]).toEqual([...s.plan.scopes]);
  });

  // ── 6. Universality: renewal-risk manifest treated identically ─

  it('renewal-risk manifest seeds appear in termSeeds with no special logic', () => {
    const r = clientPlan(renewalRiskManifest, { account: 'RetainCo', segment: 'enterprise' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    for (const seed of renewalRiskManifest.retrieval.methodologySeeds!) {
      expect(lower).toContain(seed.toLowerCase());
    }
    // User inputs preserved first
    expect(lower.indexOf('retainco')).toBeLessThan(
      lower.indexOf(renewalRiskManifest.retrieval.methodologySeeds![0].toLowerCase()),
    );
  });

  it('renewal-risk deduplicates overlapping user input and seed', () => {
    const r = clientPlan(renewalRiskManifest, { account: 'Renewal Risk Corp', segment: 'renewal risk' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    expect(lower.filter(t => t === 'renewal risk').length).toBe(1);
  });
});
