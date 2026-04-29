/**
 * Phase 3A hardening — pure helpers (no IO).
 *
 * Adds the integrity primitives the runtime composes around:
 *
 *   • sanitizeClientEnvelope     — strict allowlist + forbidden-override report
 *   • classifyHits               — per-hit relevance class (primary/supporting/weak)
 *   • computeLibraryInfluence    — rolled-up influence summary
 *   • computeGenericOutputRisk   — pre-synthesis risk based on rubric + confidence
 *   • computeDrift               — same-account / different-skill drift signal
 *   • buildWhyThisSkill          — one-line rationale for the trace
 *   • assertPlannerPurity        — JSON round-trip equality check (test helper)
 *
 * NOTHING here calls a network, reads env, or mutates inputs. Everything
 * is deterministic given the same arguments.
 */
import type {
  RetrievalConfidence,
  RetrievalCounts,
  RetrievalQueryPlan,
} from "./planner.ts";
import type { LibraryHit } from "./synthesisAddendum.ts";
import type { SkillManifest } from "./types.ts";
import type { SourceGateDecision } from "./sourceModeGate.ts";

// ── 1. Strict client-envelope sanitizer ─────────────────────────────
//
// The client may ONLY supply these keys. Anything else (including
// `sourceMode`, `overrides.sourceMode`, `manifest`, `retrieval`) is
// dropped and reported. `sourceMode` in particular is server-manifest
// controlled — accepting it from a client would let a caller silently
// downgrade proof burden.
const ALLOWED_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "depth",
  "inputs",
  "behaviorIntent",
  "workspace",
  "runId",
  "expectedVersion",
  "chainDepth",
]);

const FORBIDDEN_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "sourceMode",
  "source_mode",
  "manifest",
  "retrieval",
  "rubric",
  "output",
  "overrides", // catch nested overrides bag
]);

export interface SanitizeResult {
  sanitized: Record<string, unknown>;
  /** Keys we ignored, formatted for the trace (e.g. "unknown:foo"). */
  droppedKeys: ReadonlyArray<string>;
  /** True if the client tried to inject a forbidden key like sourceMode. */
  forbiddenAttempted: boolean;
}

export function sanitizeClientEnvelope(raw: unknown): SanitizeResult {
  const dropped: string[] = [];
  let forbiddenAttempted = false;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { sanitized: {}, droppedKeys: [], forbiddenAttempted: false };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (FORBIDDEN_ENVELOPE_KEYS.has(k)) {
      forbiddenAttempted = true;
      dropped.push(`forbidden:${k}`);
      continue;
    }
    if (!ALLOWED_ENVELOPE_KEYS.has(k)) {
      dropped.push(`unknown:${k}`);
      continue;
    }
    out[k] = v;
  }
  return { sanitized: out, droppedKeys: Object.freeze(dropped), forbiddenAttempted };
}

// ── 2. Library relevance classification ─────────────────────────────
//
// Pure heuristic: a hit is `primary` when its title token-overlaps a
// term seed AND it is a standard/playbook; `supporting` when it just
// overlaps; `weak` otherwise. No fuzzy embeddings — this runs at the
// trace layer, not at retrieval.
export type RelevanceClass = "primary" | "supporting" | "weak";

export interface ClassifiedHit extends LibraryHit {
  relevance_class: RelevanceClass;
  matched_terms: ReadonlyArray<string>;
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3);
}

export function classifyHits(
  hits: ReadonlyArray<LibraryHit>,
  termSeeds: ReadonlyArray<string>,
): ClassifiedHit[] {
  const seedTokens = new Set<string>();
  for (const t of termSeeds) for (const tok of tokenize(t)) seedTokens.add(tok);

  return hits.map((h) => {
    const titleTokens = tokenize(h.title);
    const matched: string[] = [];
    for (const tok of titleTokens) if (seedTokens.has(tok)) matched.push(tok);
    let cls: RelevanceClass;
    if (matched.length >= 1 && h.kind === "playbook") cls = "primary";
    else if (matched.length >= 2) cls = "primary";
    else if (matched.length === 1) cls = "supporting";
    else cls = "weak";
    return { ...h, relevance_class: cls, matched_terms: Object.freeze(matched) };
  });
}

export interface LibraryInfluence {
  primary: number;
  supporting: number;
  weak: number;
  total: number;
  /** True when the bulk of the corpus driving the answer is `primary`. */
  primary_dominant: boolean;
}

export function computeLibraryInfluence(
  classified: ReadonlyArray<ClassifiedHit>,
): LibraryInfluence {
  let primary = 0, supporting = 0, weak = 0;
  for (const h of classified) {
    if (h.relevance_class === "primary") primary++;
    else if (h.relevance_class === "supporting") supporting++;
    else weak++;
  }
  const total = primary + supporting + weak;
  return {
    primary, supporting, weak, total,
    primary_dominant: total > 0 && primary >= Math.max(1, Math.ceil(total / 2)),
  };
}

// ── 3. Generic-output risk ──────────────────────────────────────────
//
// Pre-synthesis estimate of how likely the answer is to be generic
// given retrieval + manifest tolerance. Synthesis branch (Phase 3.5)
// will read this to decide whether to harden the prompt further.
export type GenericRisk = "low" | "medium" | "high";

export interface GenericRiskInput {
  manifest: SkillManifest;
  confidence: RetrievalConfidence;
  influence: LibraryInfluence;
}

export function computeGenericOutputRisk(input: GenericRiskInput): GenericRisk {
  const tolerance = input.manifest.rubric.maxGenericMarkers ?? 1;
  // Strict skills (maxGenericMarkers === 0) are higher risk to silently degrade.
  if (input.confidence === "insufficient") return "high";
  if (input.confidence === "low") return tolerance === 0 ? "high" : "medium";
  if (!input.influence.primary_dominant) {
    return tolerance === 0 ? "medium" : "medium";
  }
  return "low";
}

// ── 4. Skill drift ──────────────────────────────────────────────────
export interface DriftInput {
  currentSkillId: string;
  currentAccountId?: string;
  prior?: {
    lastSkillId?: string;
    lastAccountId?: string;
  };
}

export interface DriftSignal {
  changed_skill: boolean;
  same_account: boolean;
  from?: string;
  to: string;
}

export function computeDrift(input: DriftInput): DriftSignal {
  const from = input.prior?.lastSkillId;
  return {
    changed_skill: !!from && from !== input.currentSkillId,
    same_account: !!input.currentAccountId &&
      input.currentAccountId === input.prior?.lastAccountId,
    from,
    to: input.currentSkillId,
  };
}

// ── 5. why_this_skill ───────────────────────────────────────────────
export interface WhyInput {
  manifest: SkillManifest;
  plan: RetrievalQueryPlan;
  gate: SourceGateDecision;
  confidence: RetrievalConfidence;
  influence: LibraryInfluence;
}

export function buildWhyThisSkill(input: WhyInput): string {
  const m = input.manifest;
  const seeds = input.plan.termSeeds.slice(0, 3).join(", ") || "(no terms)";
  const gateBit = input.gate.decision === "pass"
    ? "proof burden met"
    : input.gate.decision === "warn"
    ? "proof burden partial"
    : "proof burden NOT met";
  return [
    `Selected ${m.label} (${m.id}) — intent=${m.behaviorIntent}, depth=${input.plan.depth}, source_mode=${m.sourceMode}.`,
    `Seeds=[${seeds}]; library influence=${input.influence.primary}p/${input.influence.supporting}s/${input.influence.weak}w; confidence=${input.confidence}; ${gateBit}.`,
  ].join(" ");
}

// ── 6. Planner purity assertion (test helper) ───────────────────────
export function assertPlannerPurity(plan: RetrievalQueryPlan): void {
  const round = JSON.parse(JSON.stringify(plan));
  // Re-stringify with sorted keys to dodge property-order false negatives.
  const a = canonical(plan);
  const b = canonical(round);
  if (a !== b) {
    throw new Error(`planner not pure: round-trip mismatch\nA=${a}\nB=${b}`);
  }
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v as object).sort();
  return "{" +
    keys.map((k) =>
      JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])
    ).join(",") +
    "}";
}

// ── 7. Chain controls ───────────────────────────────────────────────
export const MAX_CHAIN_DEPTH = 3;

export function checkChainDepth(d: unknown): { ok: true; depth: number } | { ok: false; depth: number } {
  const depth = typeof d === "number" && Number.isFinite(d) ? Math.max(0, Math.floor(d)) : 0;
  if (depth > MAX_CHAIN_DEPTH) return { ok: false, depth };
  return { ok: true, depth };
}

// ── 8. Latency budget per depth (ms) ────────────────────────────────
//
// Soft budgets the runtime enforces around the retriever call. These
// are guardrails against runaway retrieval, not synthesis budgets.
export const RETRIEVAL_BUDGET_MS: Readonly<Record<string, number>> = Object.freeze({
  quick: 4000,
  standard: 6000,
  deep: 9000,
  artifact: 12000,
});

export function retrievalBudgetFor(depth: string): number {
  return RETRIEVAL_BUDGET_MS[depth] ?? RETRIEVAL_BUDGET_MS.standard;
}
