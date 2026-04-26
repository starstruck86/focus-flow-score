// ════════════════════════════════════════════════════════════════
// Strategy Core — Retrieval Enforcement (Phase W3, corrected)
//
// The library is universal Strategy context. Every workspace has access
// by default; this module only encodes how aggressively each workspace
// uses it. The legacy "libraryMode: off" concept has been retired —
// `background` keeps the library available without auto-injection.
//
// Scope (W3):
//   • libraryUse  → background | relevant | primary | required
//   • webMode     → off | opportunistic | required_for_current_facts
//   • contextMode → thread_first | draft_first | artifact_first | project_first
//   • citationMode → carried forward only; W5 will enforce.
//
// Non-goals here:
//   • Prompt composition (W4)
//   • Citation behavior (W5)
//   • Quality gate runner (W6)
//   • UI changes
//
// All callers MUST resolve the contract through the server-side
// registry (`resolveServerWorkspaceContract`) rather than trusting
// arbitrary client-supplied retrievalRules. Clients can hint the
// workspace key; the server picks the contract.
// ════════════════════════════════════════════════════════════════

import type {
  CitationMode,
  ContextMode,
  LibraryUse,
  RetrievalRules,
  WebMode,
  WorkspaceContract,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";
import {
  getWorkspaceContract,
  normalizeWorkspaceKey,
  type NormalizeWorkspaceKeyResult,
} from "./workspaceContracts.ts";

// ─── Server-side contract resolution ──────────────────────────────

export interface ResolvedServerContract {
  contract: WorkspaceContract;
  workspace: WorkspaceKey;
  contractVersion: string;
  retrievalRules: RetrievalRules;
  /** Telemetry only — did we coerce the requested key? */
  normalization: NormalizeWorkspaceKeyResult;
}

/**
 * Resolve a workspace key (typically supplied by the client) into a
 * server-side WorkspaceContract. Unknown / missing keys safely fall
 * back to the `work` contract.
 */
export function resolveServerWorkspaceContract(
  workspaceRaw: unknown,
): ResolvedServerContract {
  const normalization = normalizeWorkspaceKey(workspaceRaw);
  const contract = getWorkspaceContract(normalization.key);
  return {
    contract,
    workspace: normalization.key,
    contractVersion: contract.version,
    retrievalRules: contract.retrievalRules,
    normalization,
  };
}

// ─── Library gating (libraryUse) ─────────────────────────────────

export interface LibraryGateInputs {
  /** The current user prompt / turn content. */
  userContent: string;
  /** The library scopes the existing scope-derivation already produced. */
  derivedScopes: string[];
  /**
   * Whether the existing system would have queried the library based
   * on its own heuristics (account/opp present, picked resources,
   * topic intent). Used so `relevant` mirrors today's default behavior
   * without silently expanding retrieval.
   */
  legacyWouldQuery: boolean;
  /**
   * True when the user message explicitly invokes the library (e.g.
   * "use my library", "from my saved resources", "based on my
   * playbooks"). Heuristic — the caller decides; we just respect it.
   * `background` workspaces only auto-query when this is true.
   */
  userExplicitlyRequestedLibrary?: boolean;
}

export type LibraryGateDecision =
  | { shouldQuery: false; reason: LibraryGateSkipReason }
  | { shouldQuery: true; reason: LibraryGateRunReason };

export type LibraryGateSkipReason =
  | "background_no_explicit_request"
  | "relevant_no_signal";

export type LibraryGateRunReason =
  | "background_explicit_request"
  | "relevant_with_signal"
  | "primary_default"
  | "required";

/** Decide whether to invoke the library retriever for this turn. */
export function decideLibraryQuery(
  rules: RetrievalRules,
  inputs: LibraryGateInputs,
): LibraryGateDecision {
  const mode: LibraryUse = rules.libraryUse;
  const hasMeaningfulQuery = inputs.derivedScopes.length > 0 ||
    (inputs.userContent && inputs.userContent.trim().length >= 4);

  if (mode === "required") {
    // Library-centered work: always query so the coverage check fires
    // and an honest gap can be surfaced.
    return { shouldQuery: true, reason: "required" };
  }

  if (mode === "primary") {
    // Active retrieval whenever a meaningful query can be formed.
    // Even with thin signal, we still attempt — primary workspaces
    // would rather log `no_relevant_hits` than silently skip.
    if (hasMeaningfulQuery || inputs.legacyWouldQuery) {
      return { shouldQuery: true, reason: "primary_default" };
    }
    return { shouldQuery: false, reason: "relevant_no_signal" };
  }

  if (mode === "relevant") {
    // Operator default: query when there is *any* retrieval signal
    // (derived scope, legacy heuristic, or non-trivial user content).
    if (
      inputs.legacyWouldQuery ||
      inputs.derivedScopes.length > 0 ||
      hasMeaningfulQuery
    ) {
      return { shouldQuery: true, reason: "relevant_with_signal" };
    }
    return { shouldQuery: false, reason: "relevant_no_signal" };
  }

  // background — do not auto-inject unless the user explicitly asked
  // OR retrieval was already going to run via legacy heuristics. We
  // intentionally do NOT skip just because workspace is Refine.
  if (inputs.userExplicitlyRequestedLibrary) {
    return { shouldQuery: true, reason: "background_explicit_request" };
  }
  return { shouldQuery: false, reason: "background_no_explicit_request" };
}

// ─── Library coverage state ──────────────────────────────────────

/**
 * Coverage state replaces the old boolean gap. It is *always* logged
 * so telemetry can see whether the library was consulted, found, or
 * fell short — and only `required_missing` represents a hard problem.
 *
 *  • not_needed       — workspace did not need to query (e.g. background
 *                       with no explicit request)
 *  • used             — queried and found at least one hit
 *  • no_relevant_hits — queried, zero hits; non-fatal for non-required
 *                       workspaces (informational signal)
 *  • required_missing — `required` workspace queried, zero hits → real
 *                       coverage gap to surface
 */
export type LibraryCoverageState =
  | "not_needed"
  | "used"
  | "no_relevant_hits"
  | "required_missing";

export interface LibraryCoverageInputs {
  rules: RetrievalRules;
  /** Result of the library/resource retrieval. Pass total hit count. */
  libraryHitCount: number;
  /** Whether the library was actually queried this turn. */
  libraryQueried: boolean;
}

/**
 * Evaluate the library coverage state. Never throws. The caller
 * decides what to do with `required_missing` — typically the Library
 * workspace and library-centered tasks surface it to the user; other
 * workspaces just log it.
 */
export function evaluateLibraryCoverage(
  inputs: LibraryCoverageInputs,
): LibraryCoverageState {
  if (!inputs.libraryQueried) {
    return "not_needed";
  }
  if (inputs.libraryHitCount > 0) {
    return "used";
  }
  if (inputs.rules.libraryUse === "required") {
    return "required_missing";
  }
  return "no_relevant_hits";
}

// ─── Web gating (advisory in MVP) ────────────────────────────────

export type WebGateDecision =
  | { shouldQuery: false; reason: WebGateSkipReason }
  | { shouldQuery: true; reason: WebGateRunReason };

export type WebGateSkipReason =
  | "web_mode_off"
  | "no_web_capability_wired"
  | "opportunistic_no_signal";

export type WebGateRunReason =
  | "required_for_current_facts"
  | "opportunistic_signal";

export interface WebGateInputs {
  /**
   * Whether the calling surface has a real web/search tool available
   * to invoke. The Strategy chat path currently has none, so this is
   * `false` and we log only.
   */
  webCapabilityAvailable: boolean;
  /** Whether the existing surface has decided to call the web tool. */
  legacyWouldQuery: boolean;
}

/** Decide whether to invoke the web retriever for this turn. */
export function decideWebQuery(
  rules: RetrievalRules,
  inputs: WebGateInputs,
): WebGateDecision {
  const mode: WebMode = rules.webMode;
  if (mode === "off") {
    return { shouldQuery: false, reason: "web_mode_off" };
  }
  if (!inputs.webCapabilityAvailable) {
    // Honest no-op: log the intent, do not fake a web call.
    return { shouldQuery: false, reason: "no_web_capability_wired" };
  }
  if (mode === "required_for_current_facts") {
    return { shouldQuery: true, reason: "required_for_current_facts" };
  }
  if (inputs.legacyWouldQuery) {
    return { shouldQuery: true, reason: "opportunistic_signal" };
  }
  return { shouldQuery: false, reason: "opportunistic_no_signal" };
}

// ─── Context block ordering ──────────────────────────────────────

export type ContextBlockKind =
  | "thread"
  | "draft"
  | "artifact"
  | "project"
  | "library"
  | "account";

export interface OrderableContextBlock {
  kind: ContextBlockKind;
  /** Optional label for telemetry only. */
  label?: string;
  /** Pre-rendered text. Empty strings are still ordered (tracked) but the consumer can drop them. */
  text: string;
}

const CONTEXT_MODE_PRIORITY: Readonly<
  Record<ContextMode, ReadonlyArray<ContextBlockKind>>
> = Object.freeze({
  thread_first: ["thread", "artifact", "draft", "project", "account", "library"],
  draft_first: ["draft", "thread", "artifact", "project", "account", "library"],
  artifact_first: ["artifact", "draft", "thread", "project", "account", "library"],
  project_first: ["project", "thread", "artifact", "draft", "account", "library"],
});

/**
 * Reorder a heterogenous list of context blocks per the workspace's
 * declared `contextMode`. Stable for blocks of the same kind. Unknown
 * kinds are appended in their original order.
 */
export function orderContextBlocks(
  blocks: OrderableContextBlock[],
  rules: RetrievalRules,
): OrderableContextBlock[] {
  const priority = CONTEXT_MODE_PRIORITY[rules.contextMode] ??
    CONTEXT_MODE_PRIORITY.thread_first;
  const rank = new Map<ContextBlockKind, number>();
  priority.forEach((k, i) => rank.set(k, i));
  // Stable sort: tag each block with its original index to preserve order
  // among blocks of the same kind.
  return blocks
    .map((b, i) => ({ b, i, r: rank.get(b.kind) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, z) => a.r - z.r || a.i - z.i)
    .map((x) => x.b);
}

// ─── Telemetry ────────────────────────────────────────────────────

export interface RetrievalDecisionLog {
  workspace: WorkspaceKey;
  contractVersion: string;
  libraryUse: LibraryUse;
  libraryQueried: boolean;
  libraryHitCount: number;
  libraryCoverageState: LibraryCoverageState;
  webMode: WebMode;
  webQueried: boolean;
  webHitCount: number;
  contextMode: ContextMode;
  citationMode: CitationMode;
  /** Telemetry note when workspace key was coerced or fell back. */
  fallbackUsed: boolean;
  fallbackNote:
    | "workspace_key_alias"
    | "workspace_key_fallback"
    | null;
  /** Optional: which surface emitted this decision (chat | task | probe). */
  surface?: string;
}

/** Emit a single structured retrieval-decision log line. */
export function logRetrievalDecision(decision: RetrievalDecisionLog): void {
  // Single-line JSON so the existing edge log scrapers can grep
  // `workspace:retrieval_decision`.
  console.log(
    `workspace:retrieval_decision ${JSON.stringify(decision)}`,
  );
}

/**
 * Build a `RetrievalDecisionLog` payload from the resolved contract +
 * the runtime retrieval outcomes. Convenience helper so callers don't
 * have to remember every field.
 */
export function buildRetrievalDecisionLog(args: {
  resolved: ResolvedServerContract;
  libraryDecision: LibraryGateDecision;
  libraryHitCount: number;
  libraryCoverageState: LibraryCoverageState;
  webDecision: WebGateDecision;
  webHitCount: number;
  surface?: string;
}): RetrievalDecisionLog {
  const { resolved } = args;
  const libraryQueried = args.libraryDecision.shouldQuery;
  const webQueried = args.webDecision.shouldQuery;
  return {
    workspace: resolved.workspace,
    contractVersion: resolved.contractVersion,
    libraryUse: resolved.retrievalRules.libraryUse,
    libraryQueried,
    libraryHitCount: args.libraryHitCount,
    libraryCoverageState: args.libraryCoverageState,
    webMode: resolved.retrievalRules.webMode,
    webQueried,
    webHitCount: args.webHitCount,
    contextMode: resolved.retrievalRules.contextMode,
    citationMode: resolved.retrievalRules.citationMode,
    fallbackUsed: resolved.normalization.fellBack,
    fallbackNote: resolved.normalization.note?.code ?? null,
    surface: args.surface,
  };
}
