/**
 * Retrieval Expansion Layer — Phase 3B (server-authoritative, pure).
 *
 * Generic vocabulary bridge that expands raw user-language term seeds
 * into sales-methodology terms the library is indexed in.
 *
 * Hard rules:
 *   1. Expansions are ADDITIVE. Original termSeeds remain authoritative
 *      and always come first.
 *   2. Expansions DO NOT satisfy `unresolvedBindings` — those still
 *      reflect the raw binding resolution.
 *   3. Expansions DO NOT change the source-mode gate behavior. They
 *      widen the *query*, never the *acceptance threshold*.
 *   4. Deterministic. No clocks, no randomness, no env reads.
 *   5. Capped (EXPANSION_MAX) so retrieval payload stays bounded.
 *   6. Stop-list reused so generic noise is suppressed.
 *
 * Invoked by `buildPlan` AFTER `resolveBindings`. Output is folded into
 * the plan body so `planHash` covers it (changing the lexicon → new
 * planHash → cache invalidation).
 */
import type { PlannerContext } from "./planner.ts";
import {
  LEXICON_VERSION,
  matchLexicon,
  type LexiconMatch,
} from "./salesLexicon.ts";

export const EXPANSION_MAX = 8;

const STOP_LIST: ReadonlySet<string> = new Set([
  "call", "meeting", "deal", "customer", "prospect", "account", "thing", "stuff",
]);

export type ExpansionSource = "lexicon" | "context_anchor" | "persona_role";

export interface ExpansionTraceEntry {
  /** Expanded term emitted into expandedSeeds. */
  term: string;
  /** Where the expansion came from. */
  source: ExpansionSource;
  /** Lexicon rule id (e.g. "consolidation→change") or anchor name. */
  rule: string;
  /** Original token that triggered this expansion (when applicable). */
  fromInput?: string;
  /** Lexicon version at time of expansion (cache invalidation key). */
  lexiconVersion: string;
}

export interface ExpansionResult {
  expandedSeeds: ReadonlyArray<string>;
  expansionTrace: ReadonlyArray<ExpansionTraceEntry>;
  lexiconVersion: string;
  expansionEnabled: boolean;
}

export interface ExpansionFlags {
  /** Master enable. When false, returns empty expansions but still
   *  reports lexiconVersion + expansionEnabled=false in the trace. */
  enabled: boolean;
}

function pushUnique(
  out: string[],
  trace: ExpansionTraceEntry[],
  candidate: string,
  source: ExpansionSource,
  rule: string,
  fromInput: string | undefined,
  seen: Set<string>,
): boolean {
  const term = String(candidate ?? "").trim();
  if (!term) return false;
  const key = term.toLowerCase();
  if (seen.has(key)) return false;
  if (STOP_LIST.has(key)) return false;
  seen.add(key);
  out.push(term);
  trace.push({
    term,
    source,
    rule,
    fromInput,
    lexiconVersion: LEXICON_VERSION,
  });
  return true;
}

/**
 * Pure expansion function.
 *
 * @param rawSeeds  Original termSeeds from resolveBindings (authoritative).
 * @param ctx       Planner context (used for stage / methodology anchors).
 * @param flags     Server-controlled feature flags.
 */
export function expandSeeds(
  rawSeeds: ReadonlyArray<string>,
  ctx: PlannerContext,
  flags: ExpansionFlags,
): ExpansionResult {
  if (!flags.enabled) {
    return {
      expandedSeeds: Object.freeze([]),
      expansionTrace: Object.freeze([]),
      lexiconVersion: LEXICON_VERSION,
      expansionEnabled: false,
    };
  }

  const expandedSeeds: string[] = [];
  const expansionTrace: ExpansionTraceEntry[] = [];
  // Pre-seed `seen` with the originals (case-insensitive) so we never
  // re-emit a term the planner already produced.
  const seen = new Set<string>(
    rawSeeds.map((s) => String(s).toLowerCase()),
  );

  // ── Rule 1: lexicon scan over each raw seed (deterministic order) ─
  for (const raw of rawSeeds) {
    if (expandedSeeds.length >= EXPANSION_MAX) break;
    const matches: LexiconMatch[] = matchLexicon(raw);
    for (const m of matches) {
      if (expandedSeeds.length >= EXPANSION_MAX) break;
      pushUnique(expandedSeeds, expansionTrace, m.expansion, "lexicon", m.rule, m.fromInput, seen);
    }
  }

  // ── Rule 2: context anchors (stage, opp.stage, methodology) ──────
  // These run regardless of whether the manifest binds them — that is
  // the whole point of the layer.
  if (expandedSeeds.length < EXPANSION_MAX) {
    const oppStage = ctx.thread?.opportunity?.stage;
    if (typeof oppStage === "string" && oppStage.trim()) {
      pushUnique(expandedSeeds, expansionTrace, oppStage.trim(), "context_anchor", "thread.opportunity.stage", oppStage, seen);
    }
  }
  // Methodology often sits on the thread's lastBehaviorIntent or in
  // inputs; we do not have a direct field, so we only emit if a known
  // methodology token already appeared as a raw seed (handled by lexicon).
  // Nothing to do here for now — kept as an extension point.

  // ── Rule 3: persona role inference ────────────────────────────────
  // Lexicon already covers persona strings if they appear as raw seeds.
  // If persona arrived only via thread (not bound by manifest), scan it.
  if (expandedSeeds.length < EXPANSION_MAX) {
    const personaTitle = ctx.thread?.persona?.title;
    if (typeof personaTitle === "string" && personaTitle.trim()) {
      const alreadyRaw = rawSeeds.some(
        (s) => String(s).toLowerCase() === personaTitle.toLowerCase(),
      );
      if (!alreadyRaw) {
        const matches = matchLexicon(personaTitle);
        for (const m of matches) {
          if (expandedSeeds.length >= EXPANSION_MAX) break;
          pushUnique(expandedSeeds, expansionTrace, m.expansion, "persona_role", m.rule, personaTitle, seen);
        }
      }
    }
  }

  return {
    expandedSeeds: Object.freeze([...expandedSeeds]),
    expansionTrace: Object.freeze([...expansionTrace]),
    lexiconVersion: LEXICON_VERSION,
    expansionEnabled: true,
  };
}

/**
 * Read STRATEGY_EXPANSION_ENABLED from Deno env. Default OFF in prod.
 * Tests inject `flags` directly via `expandSeeds(..., { enabled })`.
 */
export function readExpansionFlagFromEnv(): ExpansionFlags {
  try {
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    if (!env || typeof env.get !== "function") return { enabled: false };
    const raw = env.get("STRATEGY_EXPANSION_ENABLED");
    if (typeof raw !== "string") return { enabled: false };
    const v = raw.trim().toLowerCase();
    return { enabled: v === "1" || v === "true" || v === "on" || v === "yes" };
  } catch {
    return { enabled: false };
  }
}

export const __test__ = { STOP_LIST };
