// @vitest-environment node
/**
 * Strategy Skills — Phase 2 (planner) pure tests.
 *
 * 20 tests covering:
 *  inertness, isolation, binding resolution, plan shape, refusal,
 *  confidence, telemetry, determinism, backward compat.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SKILL_MANIFESTS, SKILL_REGISTRY } from '../registry';
import { resolveSkill } from '../resolver';
import {
  buildPlan,
  resolveBindings,
  SCOPE_BUDGETS,
  TOTAL_CAPS,
  SCOPE_WEIGHTS,
  scoreConfidence,
  buildPlanBuilt,
  buildPlanCompleted,
  buildPlanRefused,
} from '../planner';
import type { PlannerContext } from '../planner';

const FORBIDDEN_STATIC_KEYS = [
  'resource_ids', 'resourceIds', 'playbook_ids', 'playbookIds',
  'library_ids', 'libraryIds', 'ki_ids', 'kiIds',
  'static_resources', 'hardcoded_resources',
];

const FORBIDDEN_PLANNER_IMPORTS = [
  /from\s+['"]@supabase/, /from\s+['"]supabase/, /from\s+['"]axios/,
  /\bfetch\s*\(/, /from\s+['"]@\/integrations\/supabase/,
  /from\s+['"]react/, /from\s+['"]@\/hooks\//, /from\s+['"]@\/components\//,
];

function plannerFiles(): string[] {
  const dir = resolve(__dirname, '..', 'planner');
  return readdirSync(dir).filter(f => /\.ts$/.test(f)).map(f => join(dir, f));
}

function richContext(): PlannerContext {
  return {
    thread: {
      threadId: 't-1',
      account: { id: 'acc-1', name: 'Acme', industry: 'fintech' },
      opportunity: { id: 'opp-1', name: 'Acme Renewal', stage: 'discovery' },
      persona: { id: 'pers-1', title: 'CFO' },
      topic: 'pricing change',
    },
    account: { id: 'acc-1', name: 'Acme', industry: 'fintech' },
    prior: { lastSkillId: 'commercial-insight', lastResolved: { inputs: { topic: 'pricing change' } } },
  };
}

function richInputs(): Record<string, unknown> {
  return {
    account: 'Acme', persona: 'CFO', stage: 'discovery', topic: 'pricing change',
    industry: 'fintech', use_case: 'renewals', objection: 'price too high',
    opportunity: 'Acme Renewal',
  };
}

describe('Strategy Skills — Phase 2 (planner, inert)', () => {
  it('1. Frontend inert guarantee still holds: no src/ runtime file imports the frontend strategy-skills module', () => {
    // Phase 3: server mirror exists at supabase/functions/_shared/strategy-skills/
    // and is invoked via a single guarded branch in strategy-chat/index.ts (flag-gated).
    // The FRONTEND module remains inert.
    const repoRoot = resolve(__dirname, '../../../..');
    const scanRoots = [join(repoRoot, 'src')];
    const offenders: string[] = [];
    const isCode = (f: string) => /\.(ts|tsx|js|jsx)$/.test(f);
    const isTest = (f: string) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f);
    function walk(dir: string) {
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const p = join(dir, name);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p);
        else if (isCode(p) && !isTest(p)) {
          if (p.includes(`${'lib'}/strategy-skills/`) || p.includes(`${'lib'}\\strategy-skills\\`)) continue;
          let content = '';
          try { content = readFileSync(p, 'utf8'); } catch { continue; }
          if (/from ['"][^'"]*strategy-skills/.test(content)) offenders.push(p.replace(repoRoot + '/', ''));
        }
      }
    }
    for (const root of scanRoots) walk(root);
    expect(offenders).toEqual([]);
  });

  it('2. planner files contain no forbidden imports (no fetch / supabase / axios / hooks / components / react)', () => {
    for (const f of plannerFiles()) {
      const c = readFileSync(f, 'utf8');
      for (const re of FORBIDDEN_PLANNER_IMPORTS) {
        expect(re.test(c), `${f} contains forbidden pattern ${re}`).toBe(false);
      }
    }
  });

  it('3. planner files do not import from supabase/functions/** ', () => {
    for (const f of plannerFiles()) {
      const c = readFileSync(f, 'utf8');
      expect(c.includes('supabase/functions')).toBe(false);
    }
  });

  it('4. planner/index.ts re-exports only; importing twice has no global side effects', async () => {
    const before = Object.keys(globalThis).length;
    await import('../planner');
    await import('../planner');
    const after = Object.keys(globalThis).length;
    expect(after).toBe(before);
  });

  it('5. ${inputs.x} resolves from inputs first, then thread, account, prior', () => {
    const ctx: PlannerContext = {
      thread: { threadId: 't', topic: 'thread-topic' },
      account: { name: 'AcctName' },
      prior: { lastResolved: { inputs: { topic: 'prior-topic' } } },
    };
    expect(resolveBindings(['${inputs.topic}'], { topic: 'input-topic' }, ctx).termSeeds).toEqual(['input-topic']);
    expect(resolveBindings(['${inputs.topic}'], {}, ctx).termSeeds).toEqual(['thread-topic']);
    expect(resolveBindings(['${inputs.name}'], {}, ctx).termSeeds).toEqual(['AcctName']);
    expect(resolveBindings(['${inputs.topic}'], {}, { prior: ctx.prior }).termSeeds).toEqual(['prior-topic']);
  });

  it('6. unknown bindings are dropped and recorded in unresolvedBindings', () => {
    const r = resolveBindings(['${inputs.missing}', 'not-a-binding', '${weird.x}'], {}, {});
    expect(r.termSeeds).toEqual([]);
    expect(r.unresolvedBindings).toEqual(['${inputs.missing}', 'not-a-binding', '${weird.x}']);
  });

  it('7. empty / whitespace seeds are dropped, not propagated', () => {
    const r = resolveBindings(['${inputs.a}', '${inputs.b}'], { a: '   ', b: '' }, {});
    expect(r.termSeeds).toEqual([]);
    expect(r.unresolvedBindings.length).toBe(2);
  });

  it('8. stop-list strips low-signal terms (call, meeting, deal, customer)', () => {
    const r = resolveBindings(
      ['${inputs.a}', '${inputs.b}', '${inputs.c}', '${inputs.d}', '${inputs.e}'],
      { a: 'call', b: 'Meeting', c: 'DEAL', d: 'customer', e: 'Acme' }, {},
    );
    expect(r.termSeeds).toEqual(['Acme']);
  });

  it('9. for each manifest, buildPlan with rich context returns ok and scopes ⊆ manifest scopes', () => {
    for (const m of SKILL_MANIFESTS) {
      const r = resolveSkill({ token: m.id, inputs: richInputs() });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const out = buildPlan(r.resolved, richContext());
      expect(out.ok, `${m.id} failed: ${!out.ok ? (out as { reason: string }).reason : ''}`).toBe(true);
      if (!out.ok) continue;
      const manifestScopes = new Set(m.retrieval.scopes);
      for (const s of out.plan.scopes) expect(manifestScopes.has(s)).toBe(true);
    }
  });

  it('10. scopeBudgets[depth] matches the documented table exactly', () => {
    expect(SCOPE_BUDGETS.quick).toEqual({
      knowledge_items: 4, playbooks: 2, standards: 2, exemplars: 1, patterns: 1, templates: 1,
    });
    expect(SCOPE_BUDGETS.standard).toEqual({
      knowledge_items: 8, playbooks: 3, standards: 3, exemplars: 2, patterns: 2, templates: 2,
    });
    expect(SCOPE_BUDGETS.deep).toEqual({
      knowledge_items: 14, playbooks: 5, standards: 4, exemplars: 3, patterns: 2, templates: 2,
    });
    expect(SCOPE_BUDGETS.artifact).toEqual({
      knowledge_items: 20, playbooks: 6, standards: 5, exemplars: 4, patterns: 3, templates: 3,
    });
    expect(TOTAL_CAPS).toEqual({ quick: 8, standard: 14, deep: 22, artifact: 30 });
  });

  it('11. scopeWeights[sourceMode] matches the documented table exactly', () => {
    expect(SCOPE_WEIGHTS.library_first).toEqual({
      knowledge_items: 1.0, playbooks: 0.8, standards: 0.7, exemplars: 0.5, patterns: 0.5, templates: 0.4,
    });
    expect(SCOPE_WEIGHTS.library_required).toEqual({
      knowledge_items: 1.0, playbooks: 0.9, standards: 0.9, exemplars: 0.6, patterns: 0.6, templates: 0.5,
    });
    expect(SCOPE_WEIGHTS.library_relevant).toEqual({
      knowledge_items: 0.8, playbooks: 0.6, standards: 0.6, exemplars: 0.4, patterns: 0.4, templates: 0.3,
    });
  });

  it('12. entityRefs populated when account/opportunity/persona ids are present, absent otherwise', () => {
    const r = resolveSkill({ token: 'conversation-pov', inputs: richInputs() });
    if (!r.ok) throw new Error('resolve failed');
    const withCtx = buildPlan(r.resolved, richContext());
    if (!withCtx.ok) throw new Error('plan failed');
    expect(withCtx.plan.entityScoped).toBe(true);
    expect(withCtx.plan.entityRefs.map(e => e.kind).sort()).toEqual(['account', 'opportunity', 'persona']);

    const noCtx = buildPlan(r.resolved, {});
    if (!noCtx.ok) throw new Error('plan failed');
    expect(noCtx.plan.entityScoped).toBe(false);
    expect(noCtx.plan.entityRefs).toEqual([]);
  });

  it('13. plan never contains forbidden static-library keys', () => {
    const r = resolveSkill({ token: 'discovery-prep', inputs: richInputs() });
    if (!r.ok) throw new Error();
    const out = buildPlan(r.resolved, richContext());
    if (!out.ok) throw new Error();
    const json = JSON.stringify(out.plan);
    for (const k of FORBIDDEN_STATIC_KEYS) {
      expect(json.includes(`"${k}"`)).toBe(false);
    }
  });

  it('14. with no resolved seeds AND no entity refs → insufficient_context', () => {
    const r = resolveSkill({ token: 'commercial-insight', inputs: {} });
    if (!r.ok) throw new Error();
    const out = buildPlan(r.resolved, {});
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('insufficient_context');
  });

  it('15. confidence: library_required surfaces insufficient when 0 hits; library_first returns low with 1 hit', () => {
    expect(scoreConfidence({ counts: {}, entityScoped: true, minRelevantItems: 3 })).toBe('insufficient');
    expect(scoreConfidence({ counts: { knowledge_items: 1 }, entityScoped: false, minRelevantItems: 2 })).toBe('low');
  });

  it('16. confidence truth table — high / medium / low / insufficient', () => {
    expect(scoreConfidence({
      counts: { knowledge_items: 3, standards: 1 }, entityScoped: true, minRelevantItems: 3,
    })).toBe('high');
    expect(scoreConfidence({
      counts: { knowledge_items: 4 }, entityScoped: false, minRelevantItems: 3,
    })).toBe('medium');
    expect(scoreConfidence({
      counts: { knowledge_items: 1 }, entityScoped: false, minRelevantItems: 3,
    })).toBe('low');
    expect(scoreConfidence({
      counts: {}, entityScoped: false, minRelevantItems: 1,
    })).toBe('insufficient');
  });

  it('17. buildPlanBuilt produces documented shape with stable plan_hash', () => {
    const r = resolveSkill({ token: 'conversation-pov', inputs: richInputs() });
    if (!r.ok) throw new Error();
    const a = buildPlan(r.resolved, richContext());
    const b = buildPlan(r.resolved, richContext());
    if (!a.ok || !b.ok) throw new Error();
    expect(a.plan.planHash).toBe(b.plan.planHash);
    const ev = buildPlanBuilt(a.plan, false);
    expect(ev.event).toBe('skill_retrieval_plan_built');
    expect(ev.skill_id).toBe('conversation-pov');
    expect(ev.plan_hash).toBe(a.plan.planHash);
    expect(ev.entity_scoped).toBe(true);
    expect(ev.binding_count).toBe(a.plan.termSeeds.length);

    const completed = buildPlanCompleted({
      skillId: 'conversation-pov', planHash: a.plan.planHash,
      counts: { knowledge_items: 3 }, confidence: 'medium', latencyMs: 42,
    });
    expect(completed.event).toBe('skill_retrieval_completed');
    const refused = buildPlanRefused({ skillId: 'x', reason: 'insufficient_context' });
    expect(refused.event).toBe('skill_retrieval_refused');
  });

  it('18. telemetry never includes raw input values, account names, or library content', () => {
    const inputs = { topic: 'SECRET_TOPIC_XYZ', persona: 'SECRET_PERSONA_XYZ' };
    const r = resolveSkill({ token: 'conversation-pov', inputs });
    if (!r.ok) throw new Error();
    const out = buildPlan(r.resolved, {
      thread: { threadId: 't', account: { id: 'acc-1', name: 'SECRET_ACCOUNT_XYZ' } },
    });
    if (!out.ok) throw new Error();
    const ev = buildPlanBuilt(out.plan, false);
    const json = JSON.stringify(ev);
    expect(json.includes('SECRET_TOPIC_XYZ')).toBe(false);
    expect(json.includes('SECRET_PERSONA_XYZ')).toBe(false);
    expect(json.includes('SECRET_ACCOUNT_XYZ')).toBe(false);
  });

  it('19. buildPlan is deterministic — identical inputs produce deep-equal plans', () => {
    const r = resolveSkill({ token: 'discovery-prep', inputs: richInputs() });
    if (!r.ok) throw new Error();
    const a = buildPlan(r.resolved, richContext());
    const b = buildPlan(r.resolved, richContext());
    expect(a).toEqual(b);
  });

  it('20. backward compat — adding the templates scope to a manifest does not break planner across all 10 manifests', () => {
    const m = SKILL_REGISTRY['conversation-pov'];
    const patched = {
      ...m,
      retrieval: { ...m.retrieval, scopes: [...m.retrieval.scopes, 'templates'] as const },
    };
    const out = buildPlan(
      { manifest: patched as typeof m, effectiveDepth: 'standard', inputs: richInputs() },
      richContext(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.plan.scopes).toContain('templates');
      expect(out.plan.scopeBudgets.templates).toBe(SCOPE_BUDGETS.standard.templates);
      expect(out.plan.scopeWeights.templates).toBe(SCOPE_WEIGHTS.library_first.templates);
    }

    for (const orig of SKILL_MANIFESTS) {
      const r = resolveSkill({ token: orig.id, inputs: richInputs() });
      if (!r.ok) throw new Error();
      const o = buildPlan(r.resolved, richContext());
      expect(o.ok, `${orig.id} broke after type extension`).toBe(true);
    }
  });
});
