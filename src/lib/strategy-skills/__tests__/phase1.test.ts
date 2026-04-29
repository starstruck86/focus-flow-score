// @vitest-environment node
/**
 * Strategy Skills — Phase 1 pure tests.
 *
 * 11 declarative tests covering:
 *  1. registry has exactly the 10 v1 skills
 *  2. all manifests pass schema validation
 *  3. ids are unique kebab-case
 *  4. every skill binds to a known behaviorIntent
 *  5. every skill binds to a known workspace
 *  6. NO manifest contains a static library identifier list
 *  7. every retrieval plan uses ${inputs.*} term bindings only
 *  8. every skill declares a non-empty rubric
 *  9. resolver returns the expected manifest for "/pov" and "pov"
 * 10. resolver rejects unknown / invalid tokens
 * 11. NO runtime/edge code imports the strategy-skills module
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SKILL_MANIFESTS, SKILL_REGISTRY } from '../registry';
import { validateAllManifests, validateSkillManifest } from '../schemaValidator';
import { resolveSkill } from '../resolver';

const FORBIDDEN_STATIC_KEYS = [
  'resource_ids', 'resourceIds', 'playbook_ids', 'playbookIds',
  'library_ids', 'libraryIds', 'ki_ids', 'kiIds',
  'static_resources', 'hardcoded_resources',
];

describe('Strategy Skills — Phase 1 (additive, inert)', () => {
  it('1. registry contains exactly the 10 v1 skills', () => {
    expect(SKILL_MANIFESTS).toHaveLength(10);
    const ids = SKILL_MANIFESTS.map(m => m.id).sort();
    expect(ids).toEqual([
      'account-research',
      'commercial-insight',
      'conversation-pov',
      'demo-strategy',
      'discovery-prep',
      'discovery-questions',
      'executive-brief',
      'follow-up-email',
      'meddicc-review',
      'objection-strategy',
    ]);
  });

  it('2. every manifest passes the schema validator', () => {
    const result = validateAllManifests(SKILL_MANIFESTS);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('3. ids are unique and kebab-case', () => {
    const ids = SKILL_MANIFESTS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('4. every skill binds to a known behaviorIntent (no novel intents)', () => {
    const allowed = new Set([
      'conversation_strategy', 'pov_synthesis', 'research_brief',
      'idea_generation', 'refine_message', 'discovery_prep',
      'account_brief', 'ninety_day_plan', 'objection_handling',
      'stakeholder_map',
    ]);
    for (const m of SKILL_MANIFESTS) {
      expect(allowed.has(m.behaviorIntent)).toBe(true);
    }
  });

  it('5. every skill binds to a known WorkspaceKey', () => {
    const allowed = new Set([
      'brainstorm', 'deep_research', 'refine', 'library',
      'artifacts', 'projects', 'work',
    ]);
    for (const m of SKILL_MANIFESTS) {
      expect(allowed.has(m.workspace)).toBe(true);
    }
  });

  it('6. NO manifest contains a static library identifier list (library-first)', () => {
    for (const m of SKILL_MANIFESTS) {
      const json = JSON.stringify(m);
      for (const key of FORBIDDEN_STATIC_KEYS) {
        expect(json.includes(`"${key}"`)).toBe(false);
      }
    }
    // And the validator must reject one if introduced.
    const bad: any = { ...SKILL_MANIFESTS[0], resource_ids: ['ki-1', 'ki-2'] };
    const r = validateSkillManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('forbidden static-library'))).toBe(true);
  });

  it('7. every retrieval plan uses ${inputs.*} term bindings only', () => {
    const re = /^\$\{inputs\.[a-zA-Z_][a-zA-Z0-9_]*\}$/;
    for (const m of SKILL_MANIFESTS) {
      expect(m.retrieval.termBindings.length).toBeGreaterThan(0);
      for (const b of m.retrieval.termBindings) {
        expect(b).toMatch(re);
      }
    }
  });

  it('8. every skill declares a non-empty rubric with mustHave + genericMarkers', () => {
    for (const m of SKILL_MANIFESTS) {
      expect(m.rubric.mustHave.length).toBeGreaterThan(0);
      expect(m.rubric.genericMarkers.length).toBeGreaterThan(0);
      expect(m.rubric.maxGenericMarkers).toBeGreaterThanOrEqual(0);
    }
  });

  it('9. resolver returns the expected manifest for "/conversation-pov" and "conversation-pov"', () => {
    const a = resolveSkill({ token: '/conversation-pov' });
    const b = resolveSkill({ token: 'conversation-pov' });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.resolved.manifest).toBe(SKILL_REGISTRY['conversation-pov']);
      expect(b.resolved.manifest).toBe(SKILL_REGISTRY['conversation-pov']);
      expect(a.resolved.effectiveDepth).toBe('standard');
      const deep = resolveSkill({ token: '/conversation-pov', depthOverride: 'deep' });
      expect(deep.ok && deep.resolved.effectiveDepth).toBe('deep');
    }
  });

  it('10. resolver rejects unknown and invalid tokens', () => {
    const unknown = resolveSkill({ token: '/does-not-exist' });
    expect(unknown.ok).toBe(false);
    if (unknown.ok === false) expect(unknown.reason).toBe('unknown_skill');

    const invalid = resolveSkill({ token: '///' });
    expect(invalid.ok).toBe(false);
    if (invalid.ok === false) expect(invalid.reason).toBe('invalid_token');

    const empty = resolveSkill({ token: '' });
    expect(empty.ok).toBe(false);
  });

  it('11. NO runtime/edge code imports the strategy-skills module (inert guarantee)', () => {
    const repoRoot = resolve(__dirname, '../../../..');
    const scanRoots = [
      join(repoRoot, 'src'),
      join(repoRoot, 'supabase', 'functions'),
    ];
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
        if (st.isDirectory()) {
          walk(p);
        } else if (isCode(p) && !isTest(p)) {
          // Skip files inside the strategy-skills module itself.
          if (p.includes(`${'lib'}/strategy-skills/`) || p.includes(`${'lib'}\\strategy-skills\\`)) continue;
          let content = '';
          try { content = readFileSync(p, 'utf8'); } catch { continue; }
          if (content.includes('strategy-skills')) {
            offenders.push(p.replace(repoRoot + '/', ''));
          }
        }
      }
    }

    for (const root of scanRoots) walk(root);
    expect(offenders).toEqual([]);
  });
});
