// ════════════════════════════════════════════════════════════════
// Strategy Core — W6.5 Pass A: Library Standard Context
//
// Doctrine: the user's library is Strategy's "degree in sales" — the
// standing definition of what good looks like. Library items carry
// TWO simultaneous roles: RESOURCE (factual grounding / citations,
// owned by W3/W5) and STANDARD / EXEMPLAR / PATTERN (the quality bar,
// owned by W6.5). This module owns the STANDARD role's pre-generation
// half. The library is never "merely retrieval"; the STANDARD role
// runs whether or not RESOURCE retrieval fired and regardless of the
// workspace's `libraryUse` posture.
//
// Selects 2–4 STANDARD / EXEMPLAR / PATTERN items from the user's
// library_cards table and renders them as a "WHAT GOOD LOOKS LIKE"
// guidance block injected BEFORE generation. The same `ExemplarSet`
// is later passed to W6.5 Pass B (libraryCalibration) so the model
// is graded against exactly what shaped it.
//
// Hard rules (do NOT relax):
//
//   • STANDARDS are guidance, not facts. The injected block carries
//     an explicit "Do NOT cite these unless you directly borrow
//     specific language" instruction so STANDARDS never bleed into
//     the citation system.
//
//   • RESOURCE beats STANDARD. If an item is already retrieved as
//     factual evidence (RESOURCE / library hit), it is demoted out
//     of the STANDARD set — it stays a RESOURCE only.
//
//   • Insufficient exemplars → skip cleanly. We never fabricate
//     standards, never pad with generic guidance, never throw.
//
//   • Pure rendering. `selectExemplars` is the only async surface
//     (DB read). Everything else (`renderStandardBlock`, telemetry,
//     persistence) is pure so it can be unit-tested in isolation.
//
// W6.5 is a two-pass layer. This file owns Pass A. Pass B lives in
// `libraryCalibration.ts` and reuses `ExemplarSet` verbatim.
// ════════════════════════════════════════════════════════════════

import type { WorkspaceKey } from "./workspaceContractTypes.ts";

// ─── Types ────────────────────────────────────────────────────────

export type ExemplarRole = "standard" | "exemplar" | "pattern" | "tactic";

export type StandardSurface = "strategy-chat" | "run-task";

export type StandardSkipReason =
  | "no_user_id"
  | "no_scopes"
  | "no_workspace_role_mix"
  | "fetch_failed"
  | "no_rows"
  | "no_matches_after_dedup"
  | "below_min_exemplars";

/** A single library card surfaced as a "what good looks like" exemplar. */
export interface ExemplarRef {
  id: string;
  /** Stable short id (first 8 chars) used in the prompt: STANDARD[abc12345]. */
  shortId: string;
  role: ExemplarRole;
  title: string;
  whenToUse: string | null;
  theMove: string;
  whyItWorks: string | null;
  antiPatterns: string[];
  exampleSnippet: string | null;
  appliesToContexts: string[];
  /** Confidence from library_cards.confidence (0..1). 0.5 if absent. */
  confidence: number;
  /** Selection score (scope hits × role weight × confidence). */
  score: number;
}

/**
 * The full result of Pass A. ALWAYS produced — even when selection
 * is skipped — so downstream logic can read a single shape.
 */
export interface ExemplarSet {
  /** Stable correlation id used to join Pass A and Pass B telemetry. */
  exemplarSetId: string;
  workspace: WorkspaceKey;
  surface: StandardSurface;
  taskType?: string;
  /** Whether the STANDARDS block was actually injected into the prompt. */
  injected: boolean;
  /** When `injected === false`, why we skipped. */
  skippedReason?: StandardSkipReason;
  /** Selected exemplars (length 0–4). Empty when injected === false. */
  exemplars: ExemplarRef[];
  /** Roles present in the final set, for telemetry. */
  roleCounts: Record<ExemplarRole, number>;
  /** Approximate token cost of the rendered STANDARDS block (4 chars ≈ 1 token). */
  approxTokens: number;
  /** Time taken (ms) for the DB read + scoring path. */
  durationMs: number;
}

interface SelectExemplarsOpts {
  /** Workspace this generation belongs to. */
  workspace: WorkspaceKey;
  /** Surface tag for telemetry. */
  surface: StandardSurface;
  /** Optional task type (run-task only). */
  taskType?: string;
  /** Topic/account scopes already inferred for retrieval. */
  scopes: string[];
  /**
   * IDs of library items already pulled in as RESOURCEs / KIs /
   * playbooks. Anything in this set is demoted out of STANDARDS.
   * RESOURCE beats STANDARD per W6.5 contract.
   */
  retrievedItemIds?: ReadonlyArray<string>;
  /** Min exemplars required to inject the block. Default 2. */
  minExemplars?: number;
  /** Max exemplars in the final set. Default 4. */
  maxExemplars?: number;
  /** Approx token cap on the rendered STANDARDS block. Default 1800. */
  maxTokensApprox?: number;
}

// ─── Workspace → role mix ────────────────────────────────────────
//
// Each workspace prefers a different mix of card roles. Weights bias
// the score so the right "what good looks like" shows up. Workspaces
// not listed fall back to a balanced mix.

const DEFAULT_ROLE_WEIGHTS: Readonly<Record<ExemplarRole, number>> = Object
  .freeze({
    pattern: 1.0,
    exemplar: 1.0,
    standard: 0.9,
    tactic: 0.6,
  });

const WORKSPACE_ROLE_WEIGHTS: Readonly<
  Record<WorkspaceKey, Partial<Record<ExemplarRole, number>>>
> = Object.freeze({
  brainstorm: { pattern: 1.2, exemplar: 1.0, standard: 0.7, tactic: 0.5 },
  deep_research: { pattern: 1.2, standard: 1.1, exemplar: 0.9, tactic: 0.4 },
  refine: { pattern: 1.1, tactic: 1.0, standard: 0.9, exemplar: 0.7 },
  library: { pattern: 1.2, standard: 1.0, exemplar: 0.7, tactic: 0.5 },
  artifacts: { exemplar: 1.3, pattern: 1.1, standard: 1.0, tactic: 0.4 },
  projects: { pattern: 1.2, standard: 1.1, exemplar: 0.8, tactic: 0.5 },
  work: { standard: 1.2, pattern: 1.1, exemplar: 0.7, tactic: 0.5 },
});

/** Returns the role weights for a workspace, merged onto defaults. */
export function roleWeightsFor(
  workspace: WorkspaceKey,
): Readonly<Record<ExemplarRole, number>> {
  const overlay = WORKSPACE_ROLE_WEIGHTS[workspace] ?? {};
  return Object.freeze({
    pattern: overlay.pattern ?? DEFAULT_ROLE_WEIGHTS.pattern,
    exemplar: overlay.exemplar ?? DEFAULT_ROLE_WEIGHTS.exemplar,
    standard: overlay.standard ?? DEFAULT_ROLE_WEIGHTS.standard,
    tactic: overlay.tactic ?? DEFAULT_ROLE_WEIGHTS.tactic,
  });
}

const ALLOWED_ROLES: ReadonlySet<ExemplarRole> = new Set([
  "standard",
  "exemplar",
  "pattern",
  "tactic",
]);

// ─── Helpers ─────────────────────────────────────────────────────

const lower = (s: string) => (s ?? "").toLowerCase();

function emptySet(args: {
  workspace: WorkspaceKey;
  surface: StandardSurface;
  taskType?: string;
  reason: StandardSkipReason;
  durationMs?: number;
}): ExemplarSet {
  return {
    exemplarSetId: makeExemplarSetId(),
    workspace: args.workspace,
    surface: args.surface,
    taskType: args.taskType,
    injected: false,
    skippedReason: args.reason,
    exemplars: [],
    roleCounts: { standard: 0, exemplar: 0, pattern: 0, tactic: 0 },
    approxTokens: 0,
    durationMs: args.durationMs ?? 0,
  };
}

function makeExemplarSetId(): string {
  // Cheap, collision-resistant for telemetry correlation.
  // Crypto.randomUUID is available in Deno edge runtime.
  try {
    return (globalThis as any)?.crypto?.randomUUID?.() ??
      `exset_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return `exset_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function approxTokens(s: string): number {
  return Math.ceil((s ?? "").length / 4);
}

/** Score a card against scopes + role weight + confidence. */
function scoreCard(args: {
  title: string;
  whenToUse: string | null;
  theMove: string;
  appliesToContexts: string[];
  antiPatterns: string[];
  scopes: string[];
  role: ExemplarRole;
  weights: Readonly<Record<ExemplarRole, number>>;
  confidence: number;
}): number {
  const haystack = lower(
    [
      args.title,
      args.whenToUse ?? "",
      args.theMove,
      args.appliesToContexts.join(" "),
      args.antiPatterns.join(" "),
    ].join(" \n "),
  );

  let hits = 0;
  for (const scope of args.scopes) {
    const needle = lower(scope).trim();
    if (!needle) continue;
    const re = new RegExp(
      `\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    const m = haystack.match(re);
    if (m) hits += m.length * 2;
    else if (haystack.includes(needle)) hits += 1;
  }
  if (hits === 0) return 0;

  const roleWeight = args.weights[args.role] ?? 0.5;
  const confidence = Number.isFinite(args.confidence) ? args.confidence : 0.5;
  return hits * roleWeight * confidence;
}

function shortIdOf(id: string): string {
  return (id ?? "").slice(0, 8);
}

function sanitizeRole(raw: unknown): ExemplarRole | null {
  const r = String(raw ?? "").toLowerCase();
  return ALLOWED_ROLES.has(r as ExemplarRole) ? (r as ExemplarRole) : null;
}

// ─── Selection (DB read, async) ──────────────────────────────────

/**
 * Select 2–4 exemplars from the user's library. Always returns an
 * `ExemplarSet`; never throws. When selection is skipped, `injected`
 * is false and `skippedReason` explains why.
 *
 * RESOURCE beats STANDARD: any id present in `retrievedItemIds` is
 * dropped from the candidate pool before scoring.
 */
export async function selectExemplars(
  supabase: any,
  userId: string,
  opts: SelectExemplarsOpts,
): Promise<ExemplarSet> {
  const startedAt = Date.now();
  const minExemplars = opts.minExemplars ?? 2;
  const maxExemplars = opts.maxExemplars ?? 4;
  const maxTokens = opts.maxTokensApprox ?? 1800;
  const workspace = opts.workspace;
  const surface = opts.surface;
  const taskType = opts.taskType;

  if (!userId) {
    return emptySet({ workspace, surface, taskType, reason: "no_user_id" });
  }
  if (!opts.scopes || opts.scopes.length === 0) {
    return emptySet({ workspace, surface, taskType, reason: "no_scopes" });
  }
  const weights = roleWeightsFor(workspace);
  if (
    weights.pattern + weights.exemplar + weights.standard + weights.tactic <= 0
  ) {
    return emptySet({
      workspace,
      surface,
      taskType,
      reason: "no_workspace_role_mix",
    });
  }

  // Tier A — pull all candidate cards in the allowed roles.
  let rows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("library_cards")
      .select(
        "id, source_type, source_ids, library_role, title, when_to_use, the_move, why_it_works, anti_patterns, example_snippet, applies_to_contexts, confidence",
      )
      .eq("user_id", userId)
      .in("library_role", ["standard", "exemplar", "pattern", "tactic"])
      .limit(500);
    if (error) {
      console.warn(
        `[library:standard] fetch error workspace=${workspace}: ${error.message}`,
      );
      return emptySet({
        workspace,
        surface,
        taskType,
        reason: "fetch_failed",
        durationMs: Date.now() - startedAt,
      });
    }
    rows = data ?? [];
  } catch (e) {
    console.warn(
      `[library:standard] fetch threw workspace=${workspace}: ${
        (e as Error).message
      }`,
    );
    return emptySet({
      workspace,
      surface,
      taskType,
      reason: "fetch_failed",
      durationMs: Date.now() - startedAt,
    });
  }

  if (rows.length === 0) {
    return emptySet({
      workspace,
      surface,
      taskType,
      reason: "no_rows",
      durationMs: Date.now() - startedAt,
    });
  }

  // Demote anything already in the retrieval set (RESOURCE beats STANDARD).
  const demoted = new Set<string>(
    (opts.retrievedItemIds ?? []).map((id) => String(id)),
  );

  // Score + rank.
  const scored: ExemplarRef[] = [];
  for (const r of rows) {
    if (!r?.id) continue;
    if (demoted.has(String(r.id))) continue;
    // Some rows may also be referenced via source_ids (e.g. a card
    // derived from a resource). Demote those too if any source id
    // overlaps the retrieval set.
    const srcIds: string[] = Array.isArray(r.source_ids)
      ? r.source_ids.map((x: unknown) => String(x))
      : [];
    if (srcIds.some((sid) => demoted.has(sid))) continue;

    const role = sanitizeRole(r.library_role);
    if (!role) continue;

    const title = String(r.title ?? "").trim();
    const theMove = String(r.the_move ?? "").trim();
    if (!title || !theMove) continue;

    const whenToUse = r.when_to_use ? String(r.when_to_use) : null;
    const whyItWorks = r.why_it_works ? String(r.why_it_works) : null;
    const exampleSnippet = r.example_snippet ? String(r.example_snippet) : null;
    const appliesToContexts: string[] = Array.isArray(r.applies_to_contexts)
      ? r.applies_to_contexts.map((x: unknown) => String(x))
      : [];
    const antiPatterns: string[] = Array.isArray(r.anti_patterns)
      ? r.anti_patterns.map((x: unknown) => String(x))
      : [];
    const confidence = typeof r.confidence === "number" ? r.confidence : 0.5;

    const score = scoreCard({
      title,
      whenToUse,
      theMove,
      appliesToContexts,
      antiPatterns,
      scopes: opts.scopes,
      role,
      weights,
      confidence,
    });
    if (score <= 0) continue;

    scored.push({
      id: String(r.id),
      shortId: shortIdOf(String(r.id)),
      role,
      title,
      whenToUse,
      theMove,
      whyItWorks,
      antiPatterns,
      exampleSnippet,
      appliesToContexts,
      confidence,
      score,
    });
  }

  if (scored.length === 0) {
    return emptySet({
      workspace,
      surface,
      taskType,
      reason: "no_matches_after_dedup",
      durationMs: Date.now() - startedAt,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const capped = scored.slice(0, maxExemplars);

  // Trim to token budget — drop lowest-score items until we fit.
  const trimmed: ExemplarRef[] = [];
  let tokens = 0;
  for (const ex of capped) {
    const cost = approxTokens(renderExemplarLines(ex));
    if (tokens + cost > maxTokens && trimmed.length >= minExemplars) break;
    trimmed.push(ex);
    tokens += cost;
  }

  if (trimmed.length < minExemplars) {
    return emptySet({
      workspace,
      surface,
      taskType,
      reason: "below_min_exemplars",
      durationMs: Date.now() - startedAt,
    });
  }

  const roleCounts: Record<ExemplarRole, number> = {
    standard: 0,
    exemplar: 0,
    pattern: 0,
    tactic: 0,
  };
  for (const ex of trimmed) roleCounts[ex.role] += 1;

  const set: ExemplarSet = {
    exemplarSetId: makeExemplarSetId(),
    workspace,
    surface,
    taskType,
    injected: true,
    exemplars: trimmed,
    roleCounts,
    approxTokens: tokens,
    durationMs: Date.now() - startedAt,
  };
  return set;
}

// ─── Rendering (pure) ────────────────────────────────────────────

function renderExemplarLines(ex: ExemplarRef): string {
  const tag = ex.role.toUpperCase();
  const lines: string[] = [];
  lines.push(`${tag}[${ex.shortId}] ${ex.title} — ${ex.role}`);
  if (ex.whenToUse) lines.push(`  When: ${ex.whenToUse}`);
  lines.push(`  Move: ${ex.theMove}`);
  if (ex.whyItWorks) lines.push(`  Why: ${ex.whyItWorks}`);
  if (ex.antiPatterns.length) {
    lines.push(`  Watch out: ${ex.antiPatterns.slice(0, 3).join("; ")}`);
  }
  if (ex.exampleSnippet) lines.push(`  Example: ${ex.exampleSnippet}`);
  return lines.join("\n");
}

/**
 * Render the "WHAT GOOD LOOKS LIKE" block. Returns "" when the set
 * was not injected. The block is self-headered and includes the
 * explicit "do not cite STANDARDS unless borrowing" instruction so
 * STANDARDS can never be confused with citation-eligible RESOURCEs.
 */
export function renderStandardBlock(set: ExemplarSet): string {
  if (!set.injected || set.exemplars.length === 0) return "";
  const body = set.exemplars.map(renderExemplarLines).join("\n\n");
  return [
    "=== WHAT GOOD LOOKS LIKE (standards from your library) ===",
    "These are quality patterns from your own library. Use them to shape STRUCTURE, POSTURE, and BAR.",
    "Do NOT cite these unless you directly borrow specific language or a specific claim.",
    "STANDARDS guide HOW to answer. RESOURCES are facts you may cite.",
    "",
    body,
    "=== END STANDARDS ===",
  ].join("\n");
}

// ─── Telemetry ───────────────────────────────────────────────────

export interface StandardContextLog {
  workspace: WorkspaceKey;
  surface: StandardSurface;
  taskType?: string;
  exemplarSetId: string;
  injected: boolean;
  skippedReason?: StandardSkipReason;
  exemplarCount: number;
  exemplarIds: string[];
  roleCounts: Record<ExemplarRole, number>;
  approxTokens: number;
  durationMs: number;
  shadow: true;
}

export function buildStandardContextLog(set: ExemplarSet): StandardContextLog {
  return {
    workspace: set.workspace,
    surface: set.surface,
    taskType: set.taskType,
    exemplarSetId: set.exemplarSetId,
    injected: set.injected,
    skippedReason: set.skippedReason,
    exemplarCount: set.exemplars.length,
    exemplarIds: set.exemplars.map((e) => e.id),
    roleCounts: set.roleCounts,
    approxTokens: set.approxTokens,
    durationMs: set.durationMs,
    shadow: true,
  };
}

/** Emit a `workspace:standard_context` log line. Never throws. */
export function logStandardContext(set: ExemplarSet): void {
  try {
    console.log(
      `workspace:standard_context ${
        JSON.stringify(buildStandardContextLog(set))
      }`,
    );
  } catch {
    /* never throw from telemetry */
  }
}

// ─── Persistence ─────────────────────────────────────────────────

export interface StandardContextPersistenceBlock {
  workspace: WorkspaceKey;
  surface: StandardSurface;
  exemplarSetId: string;
  injected: boolean;
  skippedReason?: StandardSkipReason;
  exemplarCount: number;
  /** Trim payload — full ids only; titles/roles for quick dashboards. */
  exemplars: Array<Pick<ExemplarRef, "id" | "shortId" | "role" | "title">>;
  roleCounts: Record<ExemplarRole, number>;
  approxTokens: number;
}

export function buildStandardContextPersistenceBlock(
  set: ExemplarSet,
): StandardContextPersistenceBlock {
  return {
    workspace: set.workspace,
    surface: set.surface,
    exemplarSetId: set.exemplarSetId,
    injected: set.injected,
    skippedReason: set.skippedReason,
    exemplarCount: set.exemplars.length,
    exemplars: set.exemplars.map((e) => ({
      id: e.id,
      shortId: e.shortId,
      role: e.role,
      title: e.title,
    })),
    roleCounts: set.roleCounts,
    approxTokens: set.approxTokens,
  };
}
