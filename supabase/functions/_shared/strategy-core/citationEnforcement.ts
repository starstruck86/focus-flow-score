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
//       Workspace does not require citations. By default we report a
//       token count without auditing or modifying the assistant text.
//
//   • none_unless_library_used
//       Citations are not required when no library hits were used.
//       When library hits ARE present, we run the audit in shadow
//       (presence-level) and emit telemetry without modifying text by default.
//
//   • light
//       Presence-level check. Run the audit; if library hits exist
//       and the model produced no citations, record an issue
//       (`missing_citations`). Audit text rewrites are SHADOW-only by
//       default; an explicit caller authenticity opt-in may publish them.
//
//   • strict
//       Run the existing strict audit (which detects UNVERIFIED
//       references and would rewrite the text + append a citation
//       banner). In W5, this runs SHADOW-only by default —
//       `auditedText` returns the ORIGINAL assistant text, while
//       `audit.text` and `audit.modified` remain available for
//       telemetry and future enforcement.
//
//       Callers can opt into authenticity rewrites in every mode via
//       `enforceCitationAuthenticity`, while the legacy strict-only
//       rewrite remains available through `enableLegacyCitationRewrite`.
//
// W5 defaults to SHADOW + REPORTING. We do not block or retry.
// Callers may explicitly publish authenticity-only audit rewrites so
// emitted tags that do not resolve are visibly marked UNVERIFIED;
// missing-citation checks remain telemetry. Quality-gate-style
// enforcement is W6's job.
// ════════════════════════════════════════════════════════════════

import {
  type CitationAuditHit,
  type CitationAuditOptions,
  type CitationAuditResult,
  auditResourceCitations,
} from "./citationAudit.ts";
import { countLiteralLibraryCitations } from "./citationSyntax.ts";
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
   * Caller-level authenticity enforcement. When true, audit supplied
   * citations in every citation posture and publish deterministic
   * UNVERIFIED rewrites. This does not require citations where the
   * workspace posture does not require them; it only prevents a citation
   * the model chose to emit from claiming an unavailable source.
   * Defaults to false, preserving W5 shadow behavior.
   */
  enforceCitationAuthenticity?: boolean;
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
   * By default this is the original input text, preserving W5 shadow
   * behavior. `enforceCitationAuthenticity: true` publishes deterministic
   * audit rewrites in every citation posture. The legacy strict-only
   * `enableLegacyCitationRewrite` opt-in remains supported.
   */
  auditedText: string;
}

/** Count obvious citation forms in `text`. Conservative: under-counts is OK. */
function countCitationLikeTokens(text: string): number {
  return countLiteralLibraryCitations(text);
}

function citableLibraryHitCount(inputs: CitationCheckInputs): number {
  const keyed = new Set<string>();
  const add = (namespace: string, hits: CitationAuditHit[] | undefined) => {
    for (const hit of hits ?? []) {
      if (hit?.id) keyed.add(`${namespace}:${hit.id}`);
    }
  };
  add("RESOURCE", inputs.libraryHits);
  add("KI", inputs.auditOptions?.kiHits);
  add("CARD", inputs.auditOptions?.cardHits);
  add("PLAYBOOK", inputs.auditOptions?.playbookHits);
  return keyed.size;
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
    enforceCitationAuthenticity = false,
    enableLegacyCitationRewrite = false,
  } = inputs;

  const issues: CitationIssue[] = [];
  const text = assistantText ?? "";
  const citableHits = citableLibraryHitCount(inputs);

  // ── Mode: none ─────────────────────────────────────────────────
  // Default remains no-audit. Authenticity enforcement is independent
  // of whether this posture requires citations: citations the model
  // voluntarily emits still must name a supplied source.
  if (citationMode === "none") {
    if (enforceCitationAuthenticity) {
      const audit = auditResourceCitations(text, libraryHits, auditOptions);
      if (audit.unverifiedCitations.length > 0) {
        issues.push({
          code: "unverified_citation",
          detail: `${audit.unverifiedCitations.length} unverified citation(s).`,
        });
      }
      return {
        citationMode,
        citationsFound: audit.verifiedTitles.length,
        issues,
        audited: true,
        audit,
        auditedText: audit.text,
      };
    }
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
    if (
      !enforceCitationAuthenticity &&
      (!libraryUsed || citableHits === 0)
    ) {
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
    if (libraryUsed && citableHits > 0 && citationsFound === 0) {
      issues.push({
        code: "library_used_without_attribution",
        detail: `Library returned ${citableHits} citeable hit(s) but assistant produced no citations.`,
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
      auditedText: enforceCitationAuthenticity ? audit.text : text,
    };
  }

  // ── Mode: light ────────────────────────────────────────────────
  // Presence-level check. Always audit. Shadow rewrites.
  if (citationMode === "light") {
    const audit = auditResourceCitations(text, libraryHits, auditOptions);
    const citationsFound = audit.verifiedTitles.length;
    if (citableHits > 0 && citationsFound === 0) {
      issues.push({
        code: "missing_citations",
        detail: `Library hits available (${citableHits}) but no verified citations in output.`,
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
      auditedText: enforceCitationAuthenticity ? audit.text : text,
    };
  }

  // ── Mode: strict ───────────────────────────────────────────────
  // W5 SHADOW: run the strict auditor for telemetry/issue reporting,
  // but do NOT publish `audit.text` as canonical output by default.
  // Callers that explicitly need the legacy rewrite (pre-W5
  // strategy-chat behavior) must pass `enableLegacyCitationRewrite:
  // true`. That opt-in is outside the W5 shadow-only contract.
  const audit = auditResourceCitations(text, libraryHits, auditOptions);
  // Strict posture has one syntax authority. Count only canonical namespace
  // tokens that survived verification; an exact bare quoted title remains a
  // valid informal attribution signal in lighter postures but cannot satisfy
  // strict Evidence Policy.
  const citationsFound = countLiteralLibraryCitations(audit.text);
  if (audit.unverifiedCitations.length > 0) {
    issues.push({
      code: "unverified_citation",
      detail: `${audit.unverifiedCitations.length} unverified citation(s).`,
    });
  }
  if (citableHits > 0 && citationsFound === 0) {
    issues.push({
      code: "missing_citations",
      detail: `Library hits available (${citableHits}) but no verified citations in output.`,
    });
  }
  return {
    citationMode,
    citationsFound,
    issues,
    audited: true,
    audit,
    auditedText: enforceCitationAuthenticity || enableLegacyCitationRewrite
      ? audit.text
      : text,
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
