/**
 * Server skill planner (Phase 3).
 *
 * Pure module: resolveBindings, buildPlan, scoreConfidence, scope tables.
 * Mirrors `src/lib/strategy-skills/planner/*`. NEVER calls retrieval.
 *
 * Authority + retrieval invocation + source-mode enforcement live in
 * `runtime.ts`. This file stays IO-free so it is safe to unit-test.
 */
import type {
  PlannerScope,
  SkillDepth,
  SkillManifest,
  SkillSourceMode,
} from "./types.ts";
import {
  expandSeeds,
  readExpansionFlagFromEnv,
  type ExpansionFlags,
  type ExpansionTraceEntry,
} from "./expansion.ts";

// ── Context contracts ──────────────────────────────────────────────
export interface PlannerThreadContext {
  threadId: string;
  account?: { id?: string; name?: string; industry?: string };
  opportunity?: { id?: string; name?: string; stage?: string };
  persona?: { id?: string; title?: string };
  topic?: string;
  lastBehaviorIntent?: string;
}

export interface PlannerSkillRunState {
  lastSkillId?: string;
  lastResolved?: { inputs: Record<string, string> };
  lastRetrievalPlanHash?: string;
  /** 3A: previous turn's account id, used for drift detection only. */
  lastAccountId?: string;
}

export interface PlannerContext {
  thread?: PlannerThreadContext;
  account?: PlannerThreadContext["account"];
  prior?: PlannerSkillRunState;
}

export interface RetrievalQueryPlan {
  skillId: string;
  skillVersion: string;
  depth: SkillDepth;
  sourceMode: SkillSourceMode;
  entityScoped: boolean;
  entityRefs: ReadonlyArray<{
    kind: "account" | "opportunity" | "persona";
    id: string;
  }>;
  termSeeds: ReadonlyArray<string>;
  unresolvedBindings: ReadonlyArray<string>;
  scopes: ReadonlyArray<PlannerScope>;
  scopeBudgets: Readonly<Record<PlannerScope, number>>;
  scopeWeights: Readonly<Record<PlannerScope, number>>;
  filters: Readonly<Record<string, string>>;
  minRelevantItems: number;
  totalCap: number;
  planHash: string;
  contextHash: string;
}

export type PlannerRefusal =
  | { ok: false; reason: "insufficient_context"; skillId: string }
  | { ok: false; reason: "unknown_skill"; token: string }
  | { ok: false; reason: "forbidden_static_key"; key: string };

export type PlannerResult =
  | { ok: true; plan: RetrievalQueryPlan }
  | PlannerRefusal;

export type RetrievalCounts = Partial<Record<PlannerScope, number>>;
export type RetrievalConfidence = "high" | "medium" | "low" | "insufficient";

// ── Scope tables ───────────────────────────────────────────────────
type BudgetTable = Readonly<
  Record<SkillDepth, Readonly<Record<PlannerScope, number>>>
>;

export const SCOPE_BUDGETS: BudgetTable = Object.freeze({
  quick: Object.freeze({
    knowledge_items: 4, playbooks: 2, standards: 2, exemplars: 1, patterns: 1, templates: 1,
  }),
  standard: Object.freeze({
    knowledge_items: 8, playbooks: 3, standards: 3, exemplars: 2, patterns: 2, templates: 2,
  }),
  deep: Object.freeze({
    knowledge_items: 14, playbooks: 5, standards: 4, exemplars: 3, patterns: 2, templates: 2,
  }),
  artifact: Object.freeze({
    knowledge_items: 20, playbooks: 6, standards: 5, exemplars: 4, patterns: 3, templates: 3,
  }),
});

export const TOTAL_CAPS: Readonly<Record<SkillDepth, number>> = Object.freeze({
  quick: 8, standard: 14, deep: 22, artifact: 30,
});

export function budgetsForDepth(
  depth: SkillDepth,
  scopes: ReadonlyArray<PlannerScope>,
): Record<PlannerScope, number> {
  const table = SCOPE_BUDGETS[depth];
  const out = {} as Record<PlannerScope, number>;
  for (const s of scopes) out[s] = table[s];
  return out;
}

type WeightTable = Readonly<
  Record<SkillSourceMode, Readonly<Record<PlannerScope, number>>>
>;

export const SCOPE_WEIGHTS: WeightTable = Object.freeze({
  library_first: Object.freeze({
    knowledge_items: 1.0, playbooks: 0.8, standards: 0.7, exemplars: 0.5, patterns: 0.5, templates: 0.4,
  }),
  library_required: Object.freeze({
    knowledge_items: 1.0, playbooks: 0.9, standards: 0.9, exemplars: 0.6, patterns: 0.6, templates: 0.5,
  }),
  library_relevant: Object.freeze({
    knowledge_items: 0.8, playbooks: 0.6, standards: 0.6, exemplars: 0.4, patterns: 0.4, templates: 0.3,
  }),
});

export function weightsForMode(
  mode: SkillSourceMode,
  scopes: ReadonlyArray<PlannerScope>,
): Record<PlannerScope, number> {
  const table = SCOPE_WEIGHTS[mode];
  const out = {} as Record<PlannerScope, number>;
  for (const s of scopes) out[s] = table[s];
  return out;
}

// ── Bindings ───────────────────────────────────────────────────────
const BINDING_RE = /^\$\{(inputs|thread|account|prior)\.([a-zA-Z_][a-zA-Z0-9_]*)\}$/;
const SHORT_RE = /^\$\{inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\}$/;

const STOP_LIST: ReadonlySet<string> = new Set([
  "call", "meeting", "deal", "customer", "prospect", "account", "thing", "stuff",
]);

const ALLOWED_NAMESPACES = ["inputs", "thread", "account", "prior"] as const;
type Namespace = (typeof ALLOWED_NAMESPACES)[number];

function readScope(
  ns: Namespace,
  key: string,
  ctx: PlannerContext,
  inputs: Record<string, unknown>,
): unknown {
  switch (ns) {
    case "inputs": return inputs[key];
    case "thread": return ctx.thread ? (ctx.thread as unknown as Record<string, unknown>)[key] : undefined;
    case "account": return ctx.account ? (ctx.account as unknown as Record<string, unknown>)[key] : undefined;
    case "prior": return ctx.prior?.lastResolved?.inputs?.[key];
  }
}

function toTerm(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  if (!s) return null;
  if (STOP_LIST.has(s.toLowerCase())) return null;
  return s;
}

export interface ResolveResult {
  termSeeds: string[];
  unresolvedBindings: string[];
}

export function resolveBindings(
  bindings: ReadonlyArray<string>,
  inputs: Record<string, unknown>,
  ctx: PlannerContext,
): ResolveResult {
  const termSeeds: string[] = [];
  const unresolvedBindings: string[] = [];
  const seen = new Set<string>();

  for (const raw of bindings) {
    if (typeof raw !== "string") continue;
    const short = raw.match(SHORT_RE);
    const full = raw.match(BINDING_RE);

    let resolved: string | null = null;
    if (short) {
      const key = short[1];
      for (const ns of ALLOWED_NAMESPACES) {
        const v = readScope(ns, key, ctx, inputs);
        const t = toTerm(v);
        if (t) { resolved = t; break; }
      }
    } else if (full) {
      const ns = full[1] as Namespace;
      const key = full[2];
      resolved = toTerm(readScope(ns, key, ctx, inputs));
    } else {
      unresolvedBindings.push(raw);
      continue;
    }

    if (resolved) {
      const k = resolved.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        termSeeds.push(resolved);
      }
    } else {
      unresolvedBindings.push(raw);
    }
  }

  return { termSeeds, unresolvedBindings };
}

// ── Plan builder ───────────────────────────────────────────────────
const FORBIDDEN_STATIC_KEYS = [
  "resource_ids", "resourceIds", "playbook_ids", "playbookIds",
  "library_ids", "libraryIds", "ki_ids", "kiIds",
  "static_resources", "hardcoded_resources",
];

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as object).sort();
  return "{" + keys.map((k) =>
    JSON.stringify(k) + ":" +
    stableStringify((value as Record<string, unknown>)[k])
  ).join(",") + "}";
}

export function buildPlan(
  manifest: SkillManifest,
  effectiveDepth: SkillDepth,
  inputs: Record<string, unknown>,
  ctx: PlannerContext = {},
): PlannerResult {
  for (const k of FORBIDDEN_STATIC_KEYS) {
    if (k in (manifest as unknown as Record<string, unknown>)) {
      return { ok: false, reason: "forbidden_static_key", key: k };
    }
    if (k in (manifest.retrieval as unknown as Record<string, unknown>)) {
      return { ok: false, reason: "forbidden_static_key", key: `retrieval.${k}` };
    }
  }

  const { termSeeds, unresolvedBindings } = resolveBindings(
    manifest.retrieval.termBindings,
    inputs,
    ctx,
  );

  const entityRefs: Array<{
    kind: "account" | "opportunity" | "persona";
    id: string;
  }> = [];
  const accId = ctx.thread?.account?.id ?? ctx.account?.id;
  if (typeof accId === "string" && accId) entityRefs.push({ kind: "account", id: accId });
  const oppId = ctx.thread?.opportunity?.id;
  if (typeof oppId === "string" && oppId) entityRefs.push({ kind: "opportunity", id: oppId });
  const persId = ctx.thread?.persona?.id;
  if (typeof persId === "string" && persId) entityRefs.push({ kind: "persona", id: persId });
  const entityScoped = entityRefs.length > 0;

  if (termSeeds.length === 0 && !entityScoped) {
    return { ok: false, reason: "insufficient_context", skillId: manifest.id };
  }

  const scopes = manifest.retrieval.scopes;
  const scopeBudgets = budgetsForDepth(effectiveDepth, scopes);
  const scopeWeights = weightsForMode(manifest.sourceMode, scopes);
  const totalCap = TOTAL_CAPS[effectiveDepth];

  const filters: Record<string, string> = {};
  if (manifest.retrieval.filters) {
    for (const [k, v] of Object.entries(manifest.retrieval.filters)) {
      if (typeof v === "string") {
        const r = resolveBindings([v], inputs, ctx);
        if (r.termSeeds[0]) filters[k] = r.termSeeds[0];
        else if (!/^\$\{/.test(v)) filters[k] = v;
      }
    }
  }

  const minRelevantItems = manifest.retrieval.minRelevantItems ?? 1;

  const planBody = {
    skillId: manifest.id,
    skillVersion: manifest.version,
    depth: effectiveDepth,
    sourceMode: manifest.sourceMode,
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
  };

  const contextHash = hash(stableStringify({
    entityRefs,
    termSeeds,
    filters,
    threadId: ctx.thread?.threadId,
    priorHash: ctx.prior?.lastRetrievalPlanHash,
  }));
  const planHash = hash(stableStringify(planBody));

  const plan: RetrievalQueryPlan = { ...planBody, contextHash, planHash };
  return { ok: true, plan };
}

// ── Confidence ─────────────────────────────────────────────────────
export interface ConfidenceInputs {
  counts: RetrievalCounts;
  entityScoped: boolean;
  minRelevantItems: number;
}

export function scoreConfidence(input: ConfidenceInputs): RetrievalConfidence {
  let totals = 0;
  for (const k of Object.keys(input.counts) as PlannerScope[]) {
    totals += input.counts[k] ?? 0;
  }
  if (totals <= 0) return "insufficient";

  const standardish =
    (input.counts.standards ?? 0) + (input.counts.playbooks ?? 0);

  if (input.entityScoped && totals >= input.minRelevantItems && standardish >= 1) {
    return "high";
  }
  if (totals >= input.minRelevantItems) return "medium";
  return "low";
}

export const __test__ = {
  hash, stableStringify, FORBIDDEN_STATIC_KEYS, BINDING_RE, SHORT_RE, STOP_LIST,
};
