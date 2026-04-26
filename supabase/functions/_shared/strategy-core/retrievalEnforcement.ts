// ════════════════════════════════════════════════════════════════
// Strategy Core — Retrieval Enforcement (Phase W3)
//
// Threads a resolved WorkspaceContract's retrievalRules into the
// server-side retrieval path. This is the *only* gate between a
// workspace's declared posture and the actual library/web/context
// queries we run for a turn.
//
// Scope (W3):
//   • libraryMode  → off | opportunistic | preferred | required
//   • webMode      → off | opportunistic | required_for_current_facts
//   • contextMode  → thread_first | draft_first | artifact_first | project_first
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
  LibraryMode,
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

// ─── Library gating ──────────────────────────────────────────────

export interface LibraryGateInputs {
  /** The current user prompt / turn content. */
  userContent: string;
  /** The library scopes the existing scope-derivation already produced. */
  derivedScopes: string[];
  /**
   * Whether the existing system would have queried the library based
   * on its own heuristics (e.g. accountId present, picked resources,
   * topic intent). Used so `opportunistic` does not silently expand
   * retrieval beyond today's behavior.
   */
  legacyWouldQuery: boolean;
}

export type LibraryGateDecision =
  | { shouldQuery: false; reason: LibraryGateSkipReason }
  | { shouldQuery: true; reason: LibraryGateRunReason };

export type LibraryGateSkipReason =
  | "library_mode_off"
  | "no_scopes_or_signal"
  | "opportunistic_no_legacy_signal";

export type LibraryGateRunReason =
  | "preferred_with_query"
  | "required"
  | "opportunistic_legacy_signal";

/** Decide whether to invoke the library retriever for this turn. */
export function decideLibraryQuery(
  rules: RetrievalRules,
  inputs: LibraryGateInputs,
): LibraryGateDecision {
  const mode: LibraryMode = rules.libraryMode;
  if (mode === "off") {
    return { shouldQuery: false, reason: "library_mode_off" };
  }
  const hasMeaningfulQuery = inputs.derivedScopes.length > 0 ||
    (inputs.userContent && inputs.userContent.trim().length >= 4);

  if (mode === "required") {
    // Required workspaces always query, even with thin signal — they
    // need the library coverage check to fire so the gap can be
    // surfaced honestly.
    return { shouldQuery: true, reason: "required" };
  }
  if (mode === "preferred") {
    if (!hasMeaningfulQuery) {
      return { shouldQuery: false, reason: "no_scopes_or_signal" };
    }
    return { shouldQuery: true, reason: "preferred_with_query" };
  }
  // opportunistic — preserve legacy behavior exactly.
  if (inputs.legacyWouldQuery && hasMeaningfulQuery) {
    return { shouldQuery: true, reason: "opportunistic_legacy_signal" };
  }
  return { shouldQuery: false, reason: "opportunistic_no_legacy_signal" };
}

// ─── Library coverage gap (libraryMode: required) ────────────────

export interface LibraryCoverageInputs {
  rules: RetrievalRules;
  /** Result of the library/resource retrieval. Pass total hit count. */
  libraryHitCount: number;
  /** Whether the library was actually queried this turn. */
  libraryQueried: boolean;
}

export interface LibraryCoverageGap {
  hasGap: boolean;
  reason:
    | "library_required_no_hits"
    | "library_required_not_queried"
    | "no_gap";
}

/**
 * For workspaces where libraryMode === "required", surface a
 * structured coverage gap when retrieval returned nothing. This is a
 * telemetry/state signal — W5/W6 will decide how to surface it to the
 * user. We intentionally do NOT throw here.
 */
export function evaluateLibraryCoverage(
  inputs: LibraryCoverageInputs,
): LibraryCoverageGap {
  if (inputs.rules.libraryMode !== "required") {
    return { hasGap: false, reason: "no_gap" };
  }
  if (!inputs.libraryQueried) {
    return { hasGap: true, reason: "library_required_not_queried" };
  }
  if (inputs.libraryHitCount <= 0) {
    return { hasGap: true, reason: "library_required_no_hits" };
  }
  return { hasGap: false, reason: "no_gap" };
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
  libraryMode: LibraryMode;
  libraryQueried: boolean;
  libraryHitCount: number;
  libraryCoverageGap: LibraryCoverageGap["reason"];
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
  libraryGap: LibraryCoverageGap;
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
    libraryMode: resolved.retrievalRules.libraryMode,
    libraryQueried,
    libraryHitCount: args.libraryHitCount,
    libraryCoverageGap: args.libraryGap.reason,
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
