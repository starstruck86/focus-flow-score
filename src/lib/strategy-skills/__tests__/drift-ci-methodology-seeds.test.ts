// @vitest-environment node
/**
 * Drift CI — server/client parity for methodologySeeds injection.
 *
 * Proves:
 *  1. Both planners inject seeds identically
 *  2. Both dedupe case-insensitively
 *  3. Seeds are included in planHash
 *  4. Adding/removing a seed changes planHash
 *  5. No skill-specific branch logic
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildPlan } from '../planner';
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

function plan(manifest: SkillManifest, inputs: Record<string, string> = { account: 'DriftCo' }) {
  return buildPlan({ manifest, effectiveDepth: manifest.depth, inputs } as any, CTX);
}

// ── 1. Source parity ───────────────────────────────────────────────

describe('Drift CI: server/client methodologySeeds parity', () => {
  it('server planner has identical seed injection logic', () => {
    const serverSrc = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/_shared/strategy-skills/planner.ts'),
      'utf-8',
    );
    // Both must: spread resolvedSeeds, build seenLower Set, iterate methodologySeeds ?? [], dedup via .toLowerCase()
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
    // No conditional referencing a specific skill ID
    for (const src of [serverSrc, clientSrc]) {
      expect(src).not.toMatch(/if\s*\(.*['"]meddicc/i);
      expect(src).not.toMatch(/if\s*\(.*skillId\s*===\s*['"]/);
      expect(src).not.toMatch(/switch\s*\(\s*.*skillId/);
    }
  });

  // ── 2. Case-insensitive dedup ──────────────────────────────────

  it('deduplicates seeds case-insensitively against user inputs', () => {
    const r = plan({ ...baseManifest, retrieval: { ...baseManifest.retrieval, methodologySeeds: ['Alpha', 'BETA', 'gamma'] } }, { account: 'alpha' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    expect(lower.filter(t => t === 'alpha').length).toBe(1);
  });

  // ── 3. Seeds included in planHash ──────────────────────────────

  it('seeds are reflected in planHash', () => {
    const r = plan(baseManifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.termSeeds).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
    // planHash is derived from planBody which includes termSeeds
    expect(r.plan.planHash).toBeTruthy();
  });

  // ── 4. Adding/removing seed changes planHash ───────────────────

  it('adding a seed changes planHash', () => {
    const r1 = plan(baseManifest);
    const extended = { ...baseManifest, retrieval: { ...baseManifest.retrieval, methodologySeeds: ['alpha', 'beta', 'gamma', 'delta'] } };
    const r2 = plan(extended);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.plan.planHash).not.toBe(r2.plan.planHash);
  });

  it('removing a seed changes planHash', () => {
    const r1 = plan(baseManifest);
    const reduced = { ...baseManifest, retrieval: { ...baseManifest.retrieval, methodologySeeds: ['alpha'] } };
    const r2 = plan(reduced);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.plan.planHash).not.toBe(r2.plan.planHash);
  });
});
