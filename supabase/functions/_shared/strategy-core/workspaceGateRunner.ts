// ════════════════════════════════════════════════════════════════
// Strategy Core — W6 Quality Gate Runner (shadow-only)
//
// Executes the per-workspace `qualityGates` defined in
// `WorkspaceContract` after generation completes. Reports results
// via `workspace:gate_result` telemetry and returns a summary the
// caller can persist to message/task metadata.
//
// MVP boundaries (do NOT relax without a contract change):
//
//   • Shadow-only — every gate is forced to `mode: "shadow"`,
//     regardless of what the contract or registry says. W6 never
//     blocks, never retries, never mutates output, never alters UI.
//
//   • Deterministic + heuristic only — `llm_judge` enforcement is
//     deferred. The registry returns `skipped: true` for any gate
//     whose `enforcementType` is `llm_judge` or whose `checkRef`
//     has no implementation.
//
//   • Pure — no I/O, no model calls. Telemetry emission is the
//     caller's job (use `logGateResults`).
//
//   • Non-throwing — checks that throw are caught and reported as
//     `error`. A failing gate must never crash a chat turn.
//
// W7 (escalation) and W8 (enforced gates) build on top of W6's
// telemetry; W6 is the foundation.
// ════════════════════════════════════════════════════════════════

import type {
  CitationCheckResult,
} from "./citationEnforcement.ts";
import type {
  RetrievalDecisionLog,
} from "./retrievalEnforcement.ts";
import type {
  QualityGate,
  WorkspaceContract,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";

// ─── Types ────────────────────────────────────────────────────────

export type GateRunnerSurface = "strategy-chat" | "run-task";

export type GateOutcome =
  | "pass"
  | "fail"
  | "skipped" // intentionally not run (e.g. preconditions not met, LLM judge)
  | "error"; // check threw — recorded but never propagated

export interface GateCheckInputs {
  /** Resolved workspace contract (W1). */
  contract: WorkspaceContract;
  /** Final assistant text the user/persistence layer will see. */
  assistantText: string;
  /**
   * Parsed structured output where available (e.g. runTask draft
   * sections). Optional — many gates only need text.
   */
  parsedOutput?: unknown;
  /** Library hits actually injected into context. */
  libraryHits?: Array<{ id: string; title: string }>;
  /** True when library was queried AND returned hits used in context. */
  libraryUsed?: boolean;
  /** W3 retrieval telemetry (helps `requirements`/coverage gates). */
  retrievalDecision?: RetrievalDecisionLog | null;
  /** W5 citation result (helps citation-coverage gates). */
  citationCheck?: CitationCheckResult | null;
  /**
   * runTask-only: the task type so gates can introspect locked
   * artifact templates. Strategy-chat passes undefined.
   */
  taskType?: string;
  /**
   * runTask-only: required section ids declared by the locked task
   * template (e.g. Discovery Prep). When present, the
   * `artifacts.required_sections_present` gate uses it.
   */
  requiredSectionIds?: readonly string[];
  /** Did the user explicitly ask to expand/lengthen? (Refine.) */
  expandRequested?: boolean;
  /** Original text being refined (Refine.length_reduced gate). */
  originalTextForRefine?: string;
}

export interface GateResult {
  /** Mirror of QualityGate.id for stable filtering downstream. */
  id: string;
  checkRef: string;
  enforcementType: QualityGate["enforcementType"];
  severity: QualityGate["severity"];
  outcome: GateOutcome;
  /** True when the runner forced shadow mode (always true in W6). */
  shadow: true;
  /** Human-readable reason or "ok". Truncated to ~280 chars. */
  detail: string;
  /** Optional metric for dashboards (e.g. counts, ratios). */
  metric?: number;
}

export interface GateRunSummary {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: GateRunnerSurface;
  taskType?: string;
  runId?: string;
  /** Snapshot of all gate outcomes. */
  results: GateResult[];
  /** Aggregate counts for fast dashboard reads. */
  totals: {
    total: number;
    pass: number;
    fail: number;
    skipped: number;
    error: number;
  };
}

// ─── Tiny check helpers (deterministic, no allocations on hot path) ──

const truncate = (s: string, n = 280) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const lower = (s: string) => (s ?? "").toLowerCase();

function hasHeading(text: string, heading: string): boolean {
  // Match "## Heading", "### Heading", or "Heading:" forms.
  const t = lower(text);
  const h = lower(heading);
  return (
    t.includes(`## ${h}`) ||
    t.includes(`### ${h}`) ||
    t.includes(`# ${h}`) ||
    t.includes(`${h}:`)
  );
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

// ─── Registry ─────────────────────────────────────────────────────

type GateImpl = (inp: GateCheckInputs) => Pick<GateResult, "outcome" | "detail" | "metric">;

const REGISTRY: Record<string, GateImpl> = {
  // ─── Brainstorm ─────────────────────────────────────────────────
  "brainstorm.min_options": ({ assistantText }) => {
    // Look for two or more "[Angle: X]" markers OR numbered options.
    const angleCount = countMatches(assistantText, /\[Angle:\s*[^\]]+\]/gi);
    const numberedCount = countMatches(assistantText, /^\s*(?:\d+\.|[-*])\s+/gm);
    const total = Math.max(angleCount, Math.min(numberedCount, 6));
    return total >= 2
      ? { outcome: "pass", detail: `options=${total}`, metric: total }
      : { outcome: "fail", detail: `expected ≥2 options, found ${total}`, metric: total };
  },
  "brainstorm.angle_diversity": ({ assistantText }) => {
    const angles = (assistantText.match(/\[Angle:\s*([^\]]+)\]/gi) ?? []).map(lower);
    const unique = new Set(angles).size;
    if (angles.length < 2) {
      return { outcome: "skipped", detail: "fewer than 2 angles to compare" };
    }
    return unique === angles.length
      ? { outcome: "pass", detail: `unique=${unique}/${angles.length}`, metric: unique }
      : { outcome: "fail", detail: `duplicate angle labels (${unique}/${angles.length})`, metric: unique };
  },
  "brainstorm.hypothesis_labeling": ({ assistantText }) => {
    // Heuristic: ≥1 "Hypothesis:" or "[Hypothesis]" marker.
    const matches = countMatches(assistantText, /(^|\n)\s*(\[?\s*hypothesis\s*\]?\s*[:\-])/gi);
    return matches >= 1
      ? { outcome: "pass", detail: `hypotheses=${matches}`, metric: matches }
      : { outcome: "fail", detail: "no hypothesis label detected", metric: 0 };
  },
  "brainstorm.next_move_present": ({ assistantText }) => {
    const t = lower(assistantText);
    const present =
      t.includes("next move") ||
      t.includes("next step") ||
      /\bnext\s*:\s/i.test(assistantText);
    return present
      ? { outcome: "pass", detail: "next-move marker present" }
      : { outcome: "fail", detail: "no 'next move' / 'next step' marker" };
  },
  "brainstorm.citation_only_if_library_used": ({ citationCheck, libraryUsed }) => {
    if (!citationCheck) return { outcome: "skipped", detail: "no citation check available" };
    // If library wasn't used, citations should not be required.
    // If library WAS used, the W5 issue list is the source of truth.
    if (!libraryUsed) return { outcome: "pass", detail: "library not used" };
    const violated = citationCheck.issues.some((i) =>
      i.code === "library_used_without_attribution"
    );
    return violated
      ? { outcome: "fail", detail: "library used but no attribution" }
      : { outcome: "pass", detail: `citations=${citationCheck.citationsFound}`, metric: citationCheck.citationsFound };
  },

  // ─── Deep Research ──────────────────────────────────────────────
  "deep_research.thesis_first_sentence": ({ assistantText }) => {
    const first = (assistantText.trim().split(/\n+/)[0] ?? "").trim();
    if (!first) return { outcome: "fail", detail: "empty output" };
    // Heuristic: thesis = at least 6 words and not a heading/question.
    const words = first.replace(/^[#>\-*]+\s*/, "").split(/\s+/).filter(Boolean).length;
    const isQuestion = first.trim().endsWith("?");
    return words >= 6 && !isQuestion
      ? { outcome: "pass", detail: `thesis_words=${words}`, metric: words }
      : { outcome: "fail", detail: `weak opening (${words} words${isQuestion ? ", question" : ""})`, metric: words };
  },
  "deep_research.confidence_tagging": ({ assistantText }) => {
    const re = /\[(verified|inferred|speculative)\]/gi;
    const tags = countMatches(assistantText, re);
    return tags >= 1
      ? { outcome: "pass", detail: `tags=${tags}`, metric: tags }
      : { outcome: "fail", detail: "no [Verified]/[Inferred]/[Speculative] tag", metric: 0 };
  },
  "deep_research.unknowns_section_present": ({ assistantText }) => {
    return hasHeading(assistantText, "unknowns") || hasHeading(assistantText, "open questions")
      ? { outcome: "pass", detail: "unknowns section present" }
      : { outcome: "fail", detail: "missing 'Unknowns' / 'Open questions' section" };
  },
  "deep_research.contradictions_surfaced": ({ assistantText }) => {
    const t = lower(assistantText);
    const present =
      t.includes("contradiction") ||
      t.includes("conflict") ||
      t.includes("tension") ||
      hasHeading(assistantText, "contradictions");
    return present
      ? { outcome: "pass", detail: "contradiction marker present" }
      : { outcome: "skipped", detail: "no contradiction signal — heuristic, non-fatal" };
  },
  "deep_research.next_questions_present": ({ assistantText }) => {
    return hasHeading(assistantText, "next questions") || hasHeading(assistantText, "questions to test")
      ? { outcome: "pass", detail: "next-questions section present" }
      : { outcome: "fail", detail: "missing next-questions section" };
  },

  // ─── Refine ──────────────────────────────────────────────────────
  "refine.no_new_facts": () => ({
    outcome: "skipped",
    detail: "heuristic — requires source diff (deferred to W8)",
  }),
  "refine.diff_present": ({ assistantText }) => {
    const hasImproved = hasHeading(assistantText, "improved version");
    const hasChanges = hasHeading(assistantText, "changes");
    return hasImproved && hasChanges
      ? { outcome: "pass", detail: "improved + changes headings present" }
      : {
        outcome: "fail",
        detail: `missing ${[!hasImproved && "improved version", !hasChanges && "changes"].filter(Boolean).join(" + ")}`,
      };
  },
  "refine.length_reduced_unless_expand_requested": ({
    assistantText,
    originalTextForRefine,
    expandRequested,
  }) => {
    if (expandRequested) return { outcome: "skipped", detail: "expand requested" };
    if (!originalTextForRefine) return { outcome: "skipped", detail: "no baseline" };
    const before = originalTextForRefine.length;
    const after = assistantText.length;
    return after <= before
      ? { outcome: "pass", detail: `len ${before}→${after}`, metric: after - before }
      : { outcome: "fail", detail: `length grew (${before}→${after})`, metric: after - before };
  },
  "refine.voice_match_proxy": () => ({
    outcome: "skipped",
    detail: "heuristic — voice matching deferred",
  }),
  "refine.variant_count_and_labels": ({ assistantText, contract }) => {
    const variantCount = countMatches(assistantText, /(^|\n)\s*(?:variant|option)\s*[a-d]?\s*[:\-]/gi);
    const cap = contract.refineConfig?.maxVariants ?? 2;
    if (variantCount === 0) return { outcome: "skipped", detail: "no variants requested" };
    return variantCount <= cap
      ? { outcome: "pass", detail: `variants=${variantCount}/${cap}`, metric: variantCount }
      : { outcome: "fail", detail: `variants exceed cap (${variantCount}>${cap})`, metric: variantCount };
  },

  // ─── Library ─────────────────────────────────────────────────────
  "library.attribution_for_meaningful_borrowings": ({ citationCheck, libraryUsed }) => {
    if (!libraryUsed) return { outcome: "skipped", detail: "no library hits used" };
    if (!citationCheck) return { outcome: "skipped", detail: "no citation check" };
    return citationCheck.citationsFound >= 1
      ? { outcome: "pass", detail: `citations=${citationCheck.citationsFound}`, metric: citationCheck.citationsFound }
      : { outcome: "fail", detail: "library used but no citations" };
  },
  "library.no_padding_on_generic_concepts": ({ assistantText }) => {
    // Heuristic: penalize bullet lists with > 12 items where each is < 60 chars.
    const lines = assistantText.split("\n").filter((l) => /^\s*[-*]\s+/.test(l));
    const generic = lines.filter((l) => l.replace(/^\s*[-*]\s+/, "").length < 60).length;
    return generic <= 12
      ? { outcome: "pass", detail: `short_bullets=${generic}`, metric: generic }
      : { outcome: "fail", detail: `padded with ${generic} short bullets`, metric: generic };
  },
  "library.empty_library_disclosed": ({ assistantText, libraryHits }) => {
    if ((libraryHits ?? []).length > 0) return { outcome: "skipped", detail: "library returned hits" };
    const t = lower(assistantText);
    const disclosed =
      t.includes("library is empty") ||
      t.includes("no matching") ||
      t.includes("no resources") ||
      t.includes("nothing in your library");
    return disclosed
      ? { outcome: "pass", detail: "empty library disclosed" }
      : { outcome: "fail", detail: "empty library not disclosed" };
  },
  "library.sources_used_summary": ({ assistantText }) => {
    return hasHeading(assistantText, "sources used") || hasHeading(assistantText, "sources")
      ? { outcome: "pass", detail: "sources-used section present" }
      : { outcome: "fail", detail: "missing 'Sources used' section" };
  },
  "library.gaps_section_present": ({ assistantText }) => {
    return hasHeading(assistantText, "gaps") || hasHeading(assistantText, "what's missing")
      ? { outcome: "pass", detail: "gaps section present" }
      : { outcome: "fail", detail: "missing 'Gaps' section" };
  },

  // ─── Artifacts ──────────────────────────────────────────────────
  "artifacts.required_sections_present": ({ assistantText, parsedOutput, requiredSectionIds }) => {
    const ids = (requiredSectionIds ?? []).map((s) => s.toLowerCase());
    if (ids.length === 0) {
      return { outcome: "skipped", detail: "no task-config required sections supplied" };
    }
    // Prefer parsedOutput.sections[].id when available; fall back to text scan.
    let foundIds = new Set<string>();
    const sections = (parsedOutput as any)?.sections;
    if (Array.isArray(sections)) {
      for (const s of sections) {
        if (s && typeof s.id === "string") foundIds.add(s.id.toLowerCase());
      }
    }
    if (foundIds.size === 0) {
      const t = lower(assistantText);
      foundIds = new Set(ids.filter((id) => t.includes(id.replace(/_/g, " "))));
    }
    const missing = ids.filter((id) => !foundIds.has(id));
    return missing.length === 0
      ? { outcome: "pass", detail: `sections ok (${ids.length})`, metric: ids.length }
      : { outcome: "fail", detail: `missing: ${missing.join(", ")}`, metric: missing.length };
  },
  "artifacts.gaps_marked_explicitly": ({ assistantText }) => {
    const t = lower(assistantText);
    const present =
      t.includes("gap:") || t.includes("[gap]") || hasHeading(assistantText, "gaps");
    return present
      ? { outcome: "pass", detail: "gaps marker present" }
      : { outcome: "skipped", detail: "no gaps marker — heuristic, non-fatal" };
  },
  "artifacts.tldr_only_when_required_or_helpful": ({ assistantText }) => {
    const tldrCount = countMatches(assistantText, /\b(tl;dr|tldr)\b/gi);
    return tldrCount <= 1
      ? { outcome: "pass", detail: `tldr=${tldrCount}`, metric: tldrCount }
      : { outcome: "fail", detail: `multiple TL;DR sections (${tldrCount})`, metric: tldrCount };
  },
  "artifacts.format_matches_contract": ({ parsedOutput, requiredSectionIds }) => {
    if (!requiredSectionIds || requiredSectionIds.length === 0) {
      return { outcome: "skipped", detail: "no task contract" };
    }
    const sections = (parsedOutput as any)?.sections;
    if (!Array.isArray(sections)) {
      return { outcome: "skipped", detail: "no parsed sections" };
    }
    return Array.isArray(sections) && sections.length > 0
      ? { outcome: "pass", detail: `sections=${sections.length}`, metric: sections.length }
      : { outcome: "fail", detail: "empty sections array" };
  },

  // ─── Projects ───────────────────────────────────────────────────
  "projects.references_available_context": ({ assistantText, libraryUsed, retrievalDecision }) => {
    const referenced =
      libraryUsed ||
      (retrievalDecision?.libraryCoverageState === "used") ||
      /\bRESOURCE\[[^\]]+\]/.test(assistantText);
    return referenced
      ? { outcome: "pass", detail: "context referenced" }
      : { outcome: "skipped", detail: "no available context to reference" };
  },
  "projects.no_fabricated_continuity": ({ assistantText, retrievalDecision }) => {
    // If library/thread context wasn't actually used, output must NOT
    // claim "as we discussed" / "previously decided" / "last time".
    const usedContext = retrievalDecision?.libraryCoverageState === "used";
    if (usedContext) return { outcome: "pass", detail: "context present" };
    const t = lower(assistantText);
    const fabricated =
      t.includes("as we discussed") ||
      t.includes("as we agreed") ||
      t.includes("previously decided") ||
      t.includes("last time we");
    return fabricated
      ? { outcome: "fail", detail: "fabricated continuity phrase without context" }
      : { outcome: "pass", detail: "no fabricated continuity" };
  },
  "projects.decisions_surfaced": ({ assistantText }) => {
    const t = lower(assistantText);
    const present =
      t.includes("decision:") ||
      hasHeading(assistantText, "decisions") ||
      hasHeading(assistantText, "decisions made");
    return present
      ? { outcome: "pass", detail: "decisions surfaced" }
      : { outcome: "skipped", detail: "no decision marker — heuristic" };
  },
  "projects.recommendation_grounded_in_context": ({ assistantText, libraryUsed, retrievalDecision }) => {
    const t = lower(assistantText);
    const hasRecommendation =
      t.includes("recommend") || hasHeading(assistantText, "recommendation");
    if (!hasRecommendation) return { outcome: "skipped", detail: "no recommendation" };
    const grounded =
      libraryUsed ||
      retrievalDecision?.libraryCoverageState === "used" ||
      /\bRESOURCE\[[^\]]+\]/.test(assistantText);
    return grounded
      ? { outcome: "pass", detail: "recommendation grounded" }
      : { outcome: "fail", detail: "recommendation without grounded context" };
  },

  // ─── Work ────────────────────────────────────────────────────────
  "work.answer_stands_alone": ({ assistantText }) => {
    // Find "Consider: <workspace>" trailing routing nudge.
    const lines = assistantText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    const startsWithConsider = /^consider\s*[:\-]/i.test(last);
    if (!startsWithConsider) return { outcome: "pass", detail: "no routing nudge" };
    // If the only substantive content IS the routing nudge → fail.
    return lines.length >= 3
      ? { outcome: "pass", detail: "answer + nudge" }
      : { outcome: "fail", detail: "answer is essentially just a routing nudge" };
  },
  "work.length_proportional": ({ assistantText }) => {
    const len = assistantText.length;
    // Soft cap: 4 KB. Above 8 KB → fail; 4–8 KB → info-only skipped.
    if (len > 8000) {
      return { outcome: "fail", detail: `bloated (${len} chars)`, metric: len };
    }
    return { outcome: "pass", detail: `len=${len}`, metric: len };
  },
  "work.recommendation_only_when_material": ({ assistantText, contract }) => {
    const lower = assistantText.toLowerCase();
    const hasNudge = /consider\s*[:\-]/i.test(assistantText);
    if (!hasNudge) return { outcome: "pass", detail: "no nudge" };
    // Materiality rules live in workspaceConfig. If none configured,
    // we cannot evaluate — skip rather than fail.
    const rules: any[] = (contract.workspaceConfig as any)?.materialityRules ?? [];
    if (rules.length === 0) {
      return { outcome: "skipped", detail: "no materiality rules in contract" };
    }
    const triggered = rules.some((r) => {
      const trigger = String(r?.trigger ?? "").toLowerCase();
      return trigger.length > 0 && lower.includes(trigger);
    });
    return triggered
      ? { outcome: "pass", detail: "nudge backed by materiality rule" }
      : { outcome: "fail", detail: "nudge fired with no material trigger" };
  },
};

// ─── Public API ───────────────────────────────────────────────────

/** True when the registry has an implementation for `checkRef`. */
export function hasGateImplementation(checkRef: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, checkRef);
}

/**
 * Run every gate defined on the contract. Always returns a summary;
 * never throws. Forces shadow=true on every result regardless of
 * the gate's declared `shadow` field.
 */
export function runWorkspaceGates(args: {
  inputs: GateCheckInputs;
  surface: GateRunnerSurface;
  taskType?: string;
  runId?: string;
}): GateRunSummary {
  const { inputs, surface, taskType, runId } = args;
  const { contract } = inputs;
  const results: GateResult[] = [];

  for (const gate of contract.qualityGates ?? []) {
    // LLM-judge gates are deferred — record as skipped.
    if (gate.enforcementType === "llm_judge") {
      results.push({
        id: gate.id,
        checkRef: gate.checkRef,
        enforcementType: gate.enforcementType,
        severity: gate.severity,
        outcome: "skipped",
        shadow: true,
        detail: "llm_judge deferred (W6 deterministic/heuristic only)",
      });
      continue;
    }
    const impl = REGISTRY[gate.checkRef];
    if (!impl) {
      results.push({
        id: gate.id,
        checkRef: gate.checkRef,
        enforcementType: gate.enforcementType,
        severity: gate.severity,
        outcome: "skipped",
        shadow: true,
        detail: "no registry implementation",
      });
      continue;
    }
    try {
      const out = impl(inputs);
      results.push({
        id: gate.id,
        checkRef: gate.checkRef,
        enforcementType: gate.enforcementType,
        severity: gate.severity,
        outcome: out.outcome,
        shadow: true,
        detail: truncate(out.detail ?? "ok"),
        metric: typeof out.metric === "number" ? out.metric : undefined,
      });
    } catch (err) {
      results.push({
        id: gate.id,
        checkRef: gate.checkRef,
        enforcementType: gate.enforcementType,
        severity: gate.severity,
        outcome: "error",
        shadow: true,
        detail: truncate(`gate threw: ${(err as Error)?.message ?? String(err)}`),
      });
    }
  }

  const totals = {
    total: results.length,
    pass: results.filter((r) => r.outcome === "pass").length,
    fail: results.filter((r) => r.outcome === "fail").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    error: results.filter((r) => r.outcome === "error").length,
  };

  return {
    workspace: contract.workspace,
    contractVersion: contract.contractVersion,
    surface,
    taskType,
    runId,
    results,
    totals,
  };
}

// ─── Telemetry ────────────────────────────────────────────────────

export interface GateResultLog {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: GateRunnerSurface;
  taskType?: string;
  runId?: string;
  gateId: string;
  checkRef: string;
  enforcementType: QualityGate["enforcementType"];
  severity: QualityGate["severity"];
  outcome: GateOutcome;
  shadow: true;
  detail: string;
  metric?: number;
}

/** Build per-gate log records suitable for `workspace:gate_result` lines. */
export function buildGateResultLogs(summary: GateRunSummary): GateResultLog[] {
  return summary.results.map((r) => ({
    workspace: summary.workspace,
    contractVersion: summary.contractVersion,
    surface: summary.surface,
    taskType: summary.taskType,
    runId: summary.runId,
    gateId: r.id,
    checkRef: r.checkRef,
    enforcementType: r.enforcementType,
    severity: r.severity,
    outcome: r.outcome,
    shadow: true,
    detail: r.detail,
    metric: r.metric,
  }));
}

/** Emit one `workspace:gate_result` log line per gate. Never throws. */
export function logGateResults(summary: GateRunSummary): void {
  try {
    for (const log of buildGateResultLogs(summary)) {
      console.log(`workspace:gate_result ${JSON.stringify(log)}`);
    }
  } catch {
    /* never throw from telemetry */
  }
}

/** Compact summary suitable for writing into message/task metadata. */
export interface GatePersistenceBlock {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: GateRunnerSurface;
  totals: GateRunSummary["totals"];
  /** Per-gate results trimmed to id + outcome + detail for storage. */
  gates: Array<Pick<GateResult, "id" | "checkRef" | "outcome" | "severity" | "detail" | "metric">>;
}

export function buildGatePersistenceBlock(summary: GateRunSummary): GatePersistenceBlock {
  return {
    workspace: summary.workspace,
    contractVersion: summary.contractVersion,
    surface: summary.surface,
    totals: summary.totals,
    gates: summary.results.map((r) => ({
      id: r.id,
      checkRef: r.checkRef,
      outcome: r.outcome,
      severity: r.severity,
      detail: r.detail,
      metric: r.metric,
    })),
  };
}
