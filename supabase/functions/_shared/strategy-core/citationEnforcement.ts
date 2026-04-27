// ════════════════════════════════════════════════════════════════
// Strategy Core — W5 Citation Behavior Enforcement
//
// Bridges the existing deterministic `auditResourceCitations` (which
// only knows about "did the model cite something we don't have")
// with the workspace-level POSTURE defined in
// `WorkspaceContract.retrievalRules.citationMode`.
//
// Modes (from W1):
//
//   • none
//       Workspace does not require citations. We still RUN the audit
//       so we can record the citation count, but we do not modify
//       the assistant text and we do not raise issues.
//
//   • none_unless_library_used
//       Citations are not required when no library hits were used.
//       When library hits ARE present, we run the audit in shadow
//       (presence-level) and emit telemetry but do not modify text.
//
//   • light
//       Presence-level check. Run the audit; if library hits exist
//       and the model produced no citations, record an issue
//       (`missing_citations`). Audit text rewrites are SHADOW-only —
//       we keep `audit.text` available to the caller via
//       `auditedText`, but the caller decides whether to use it.
//       (W5 keeps this shadow; W6 owns enforcement.)
//
//   • strict
//       Run the existing strict audit (which detects UNVERIFIED
//       references and would rewrite the text + append a citation
//       banner). In W5, this runs SHADOW-only by default —
//       `auditedText` returns the ORIGINAL assistant text, while
//       `audit.text` and `audit.modified` remain available for
//       telemetry and future enforcement.
//
//       Callers that explicitly need the legacy chat rewrite can
//       opt in via `enableLegacyCitationRewrite: true` on the
//       inputs. This is OUTSIDE the W5 shadow-only contract and
//       must be set deliberately by the caller.
//
// W5 is intentionally SHADOW + REPORTING. We do not block. We do
// not retry. We do not mutate canonical assistant text. Quality-
// gate-style enforcement is W6's job.
// ════════════════════════════════════════════════════════════════

import {
  type CitationAuditHit,
  type CitationAuditOptions,
  type CitationAuditResult,
  auditResourceCitations,
} from "./citationAudit.ts";
import type {
  CitationMode,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";

export type CitationCheckSurface = "strategy-chat" | "run-task";

export type CitationIssueCode =
  | "unverified_citation"
  | "missing_citations"
  | "library_used_without_attribution";

export interface CitationIssue {
  code: CitationIssueCode;
  detail?: string;
}

export interface CitationCheckInputs {
  /** The assistant text after mode-lock + substance enforcement. */
  assistantText: string;
  /** Library hits that were actually injected into context. */
  libraryHits: CitationAuditHit[];
  /** True when library was queried and returned hits used in context. */
  libraryUsed: boolean;
  /** Workspace contract values (resolved upstream). */
  workspace: WorkspaceKey;
  contractVersion: string;
  citationMode: CitationMode;
  /** Optional pass-through to the deterministic auditor. */
  auditOptions?: CitationAuditOptions;
  /**
   * OUTSIDE W5 scope. When true, `strict` mode publishes the
   * deterministic auditor's rewritten text as `auditedText`,
   * preserving the legacy strategy-chat citation rewrite.
   * Defaults to false — W5 is shadow/reporting only.
   */
  enableLegacyCitationRewrite?: boolean;
}

export interface CitationCheckResult {
  /** The mode that governed this check. */
  citationMode: CitationMode;
  /** Number of verified citations observed in the text. */
  citationsFound: number;
  /** Issues raised by W5 (shadow/reporting only). */
  issues: CitationIssue[];
  /** Did we run the deterministic audit? (false for `none` if no hits.) */
  audited: boolean;
  /**
   * The deterministic audit result. Always populated when `audited` is
   * true. `audit.text` and `audit.modified` reflect what the auditor
   * WOULD have published — useful for telemetry — but W5 does not
   * publish that text by default.
   */
  audit: CitationAuditResult | null;
  /**
   * Text the caller should treat as the canonical assistant output.
   * In W5 this is ALWAYS the original input text, regardless of mode.
   * The single exception is when the caller passes
   * `enableLegacyCitationRewrite: true` AND the mode is `strict` —
   * that opt-in path is outside W5 shadow-only behavior and
   * preserves the legacy strategy-chat rewrite.
   */
  auditedText: string;
}

/** Count obvious citation forms in `text`. Conservative: under-counts is OK. */
function countCitationLikeTokens(text: string): number {
  if (!text) return 0;
  // RESOURCE[…] (already-validated form) + verified inline ⚠ UNVERIFIED.
  const resourceMatches = text.match(/RESOURCE\[[^\]]+\]/g) ?? [];
  // Don't count UNVERIFIED — those failed audit.
  return resourceMatches.length;
}

/**
 * Run W5 citation behavior for a single assistant turn.
 *
 * Pure: no I/O, no model calls. Telemetry is the caller's job —
 * use `logCitationCheck` to emit the structured log line.
 */
export function runCitationCheck(
  inputs: CitationCheckInputs,
): CitationCheckResult {
  const {
    assistantText,
    libraryHits,
    libraryUsed,
    citationMode,
    auditOptions,
    enableLegacyCitationRewrite = false,
  } = inputs;

  const issues: CitationIssue[] = [];
  const text = assistantText ?? "";

  // ── Mode: none ─────────────────────────────────────────────────
  // Don't audit. Don't modify. Just report citation count.
  if (citationMode === "none") {
    return {
      citationMode,
      citationsFound: countCitationLikeTokens(text),
      issues,
      audited: false,
      audit: null,
      auditedText: text,
    };
  }

  // ── Mode: none_unless_library_used ─────────────────────────────
  // Skip audit entirely when no library hits were used. Otherwise
  // run audit in shadow and record presence/absence as an issue.
  if (citationMode === "none_unless_library_used") {
    if (!libraryUsed || libraryHits.length === 0) {
      return {
        citationMode,
        citationsFound: countCitationLikeTokens(text),
        issues,
        audited: false,
        audit: null,
        auditedText: text,
      };
    }
    const audit = auditResourceCitations(text, libraryHits, auditOptions);
    const citationsFound = audit.verifiedTitles.length;
    if (citationsFound === 0) {
      issues.push({
        code: "library_used_without_attribution",
        detail: `Library returned ${libraryHits.length} hit(s) but assistant produced no citations.`,
      });
    }
    if (audit.unverifiedCitations.length > 0) {
      issues.push({
        code: "unverified_citation",
        detail: `${audit.unverifiedCitations.length} unverified citation(s).`,
      });
    }
    // SHADOW: do not return audit.text as the canonical text.
    return {
      citationMode,
      citationsFound,
      issues,
      audited: true,
      audit,
      auditedText: text,
    };
  }

  // ── Mode: light ────────────────────────────────────────────────
  // Presence-level check. Always audit. Shadow rewrites.
  if (citationMode === "light") {
    const audit = auditResourceCitations(text, libraryHits, auditOptions);
    const citationsFound = audit.verifiedTitles.length;
    if (libraryHits.length > 0 && citationsFound === 0) {
      issues.push({
        code: "missing_citations",
        detail: `Library hits available (${libraryHits.length}) but no verified citations in output.`,
      });
    }
    if (audit.unverifiedCitations.length > 0) {
      issues.push({
        code: "unverified_citation",
        detail: `${audit.unverifiedCitations.length} unverified citation(s).`,
      });
    }
    return {
      citationMode,
      citationsFound,
      issues,
      audited: true,
      audit,
      auditedText: text, // shadow — caller does not rewrite in W5
    };
  }

  // ── Mode: strict ───────────────────────────────────────────────
  // W5 SHADOW: run the strict auditor for telemetry/issue reporting,
  // but do NOT publish `audit.text` as canonical output by default.
  // Callers that explicitly need the legacy rewrite (pre-W5
  // strategy-chat behavior) must pass `enableLegacyCitationRewrite:
  // true`. That opt-in is outside the W5 shadow-only contract.
  const audit = auditResourceCitations(text, libraryHits, auditOptions);
  const citationsFound = audit.verifiedTitles.length;
  if (audit.unverifiedCitations.length > 0) {
    issues.push({
      code: "unverified_citation",
      detail: `${audit.unverifiedCitations.length} unverified citation(s).`,
    });
  }
  if (libraryHits.length > 0 && citationsFound === 0) {
    issues.push({
      code: "missing_citations",
      detail: `Library hits available (${libraryHits.length}) but no verified citations in output.`,
    });
  }
  return {
    citationMode,
    citationsFound,
    issues,
    audited: true,
    audit,
    auditedText: enableLegacyCitationRewrite ? audit.text : text,
  };
}

// ─── Telemetry ────────────────────────────────────────────────────

export interface CitationCheckLog {
  workspace: WorkspaceKey;
  contractVersion: string;
  citationMode: CitationMode;
  citationsFound: number;
  issues: CitationIssue[];
  audited: boolean;
  modified: boolean;
  surface: CitationCheckSurface;
  /** runTask context. */
  taskType?: string;
  runId?: string;
}

export function buildCitationCheckLog(args: {
  result: CitationCheckResult;
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: CitationCheckSurface;
  taskType?: string;
  runId?: string;
}): CitationCheckLog {
  return {
    workspace: args.workspace,
    contractVersion: args.contractVersion,
    citationMode: args.result.citationMode,
    citationsFound: args.result.citationsFound,
    issues: args.result.issues,
    audited: args.result.audited,
    modified: args.result.audit?.modified === true,
    surface: args.surface,
    taskType: args.taskType,
    runId: args.runId,
  };
}

export function logCitationCheck(payload: CitationCheckLog): void {
  // Single-line JSON for log scrapers (`workspace:citation_check`).
  console.log(`workspace:citation_check ${JSON.stringify(payload)}`);
}
