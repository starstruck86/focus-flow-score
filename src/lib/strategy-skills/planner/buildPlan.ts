/**
 * buildPlan — Phase 2 (inert, pure).
 *
 * Turns a ResolvedSkill + PlannerContext into a RetrievalQueryPlan.
 * Emits parameters only — does NOT call retrieval, does NOT touch IO.
 */
import type { ResolvedSkill } from '../resolver';
import type {
  PlannerContext,
  PlannerResult,
  PlannerScope,
  RetrievalQueryPlan,
} from './contextTypes';
import { resolveBindings } from './resolveBindings';
import { budgetsForDepth, TOTAL_CAPS } from './scopeBudgets';
import { weightsForMode } from './scopeWeights';
import { expandSeeds, type ExpansionFlags } from './expandSeeds';

const FORBIDDEN_STATIC_KEYS = [
  'resource_ids', 'resourceIds', 'playbook_ids', 'playbookIds',
  'library_ids', 'libraryIds', 'ki_ids', 'kiIds',
  'static_resources', 'hardcoded_resources',
];

/** Tiny stable string hash (FNV-1a 32-bit). Deterministic, no crypto. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value as object).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}

export function buildPlan(
  resolved: ResolvedSkill,
  ctx: PlannerContext = {},
  flagsOverride?: ExpansionFlags,
): PlannerResult {
  const m = resolved.manifest;

  // Defense-in-depth: refuse if a forbidden static key sneaks in.
  for (const k of FORBIDDEN_STATIC_KEYS) {
    if (k in (m as unknown as Record<string, unknown>)) {
      return { ok: false, reason: 'forbidden_static_key', key: k };
    }
    if (k in (m.retrieval as unknown as Record<string, unknown>)) {
      return { ok: false, reason: 'forbidden_static_key', key: `retrieval.${k}` };
    }
  }

  const inputs = (resolved.inputs ?? {}) as Record<string, unknown>;
  const { termSeeds: resolvedSeeds, unresolvedBindings } = resolveBindings(
    m.retrieval.termBindings,
    inputs,
    ctx,
  );

  // Universal: inject static methodology/domain seeds (deduped against resolved terms)
  const termSeeds = [...resolvedSeeds];
  const seenLower = new Set(termSeeds.map(s => s.toLowerCase()));
  for (const seed of m.retrieval.methodologySeeds ?? []) {
    const lower = seed.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      termSeeds.push(seed);
    }
  }

  // Entity refs from context (typed allowlist only — no PII echo).
  const entityRefs: Array<{ kind: 'account' | 'opportunity' | 'persona'; id: string }> = [];
  const accId = ctx.thread?.account?.id ?? ctx.account?.id;
  if (typeof accId === 'string' && accId) entityRefs.push({ kind: 'account', id: accId });
  const oppId = ctx.thread?.opportunity?.id;
  if (typeof oppId === 'string' && oppId) entityRefs.push({ kind: 'opportunity', id: oppId });
  const persId = ctx.thread?.persona?.id;
  if (typeof persId === 'string' && persId) entityRefs.push({ kind: 'persona', id: persId });
  const entityScoped = entityRefs.length > 0;

  // Term floor: refuse if no seeds AND no entity context.
  if (termSeeds.length === 0 && !entityScoped) {
    return { ok: false, reason: 'insufficient_context', skillId: m.id };
  }

  const scopes = m.retrieval.scopes as ReadonlyArray<PlannerScope>;
  const scopeBudgets = budgetsForDepth(resolved.effectiveDepth, scopes);
  const scopeWeights = weightsForMode(m.sourceMode, scopes);
  const totalCap = TOTAL_CAPS[resolved.effectiveDepth];

  const filters: Record<string, string> = {};
  if (m.retrieval.filters) {
    for (const [k, v] of Object.entries(m.retrieval.filters)) {
      if (typeof v === 'string') {
        // Resolve filter values that use ${inputs.*} too.
        const r = resolveBindings([v], inputs, ctx);
        if (r.termSeeds[0]) filters[k] = r.termSeeds[0];
        else if (!/^\$\{/.test(v)) filters[k] = v;
      }
    }
  }

  const minRelevantItems = m.retrieval.minRelevantItems ?? 1;

  // Phase 3B mirror: expansion folded into plan body so hashes track it.
  // Default OFF in the UI mirror (server-controlled in prod).
  const flags: ExpansionFlags = flagsOverride ?? { enabled: false };
  const expansion = expandSeeds(termSeeds, ctx, flags);

  const planBody = {
    skillId: m.id,
    skillVersion: m.version,
    depth: resolved.effectiveDepth,
    sourceMode: m.sourceMode,
    entityScoped,
    entityRefs,
    termSeeds,
    unresolvedBindings,
    scopes: [...scopes],
    scopeBudgets,
    scopeWeights,
    filters,
    minRelevantItems,
    totalCap,
    expandedSeeds: expansion.expandedSeeds,
    expansionTrace: expansion.expansionTrace,
    lexiconVersion: expansion.lexiconVersion,
    expansionEnabled: expansion.expansionEnabled,
  };

  // Hashes are deterministic over inputs only — no Date.now, no random.
  const contextHash = hash(stableStringify({
    entityRefs,
    termSeeds,
    filters,
    threadId: ctx.thread?.threadId,
    priorHash: ctx.prior?.lastRetrievalPlanHash,
    expandedSeeds: expansion.expandedSeeds,
    lexiconVersion: expansion.lexiconVersion,
    expansionEnabled: expansion.expansionEnabled,
  }));
  const planHash = hash(stableStringify(planBody));

  const plan: RetrievalQueryPlan = {
    ...planBody,
    contextHash,
    planHash,
  };

  return { ok: true, plan };
}

export const _test__ = { hash, stableStringify, FORBIDDEN_STATIC_KEYS };
