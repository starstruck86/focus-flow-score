// ════════════════════════════════════════════════════════════════
// Strategy Core — W6.5 Pass B: Library Calibration
//
// After W6 quality gates and BEFORE W7 escalation, compare the
// generated output against the SAME `ExemplarSet` produced by W6.5
// Pass A (libraryStandard). Produces strengths, gaps, upgrade
// suggestions, dimension scores, a verdict, and a fabrication guard.
//
// Hard rules (Phase 1 — do NOT relax):
//
//   • Shadow only. Calibration NEVER mutates assistant output.
//
//   • Heuristic only. NO LLM judge call in Phase 1. Every dimension
//     resolves via deterministic checks against `assistantText` /
//     `parsedOutput` and the exemplar set.
//
//   • improvedDraftEnabled === false. The result type carries a
//     placeholder field but it is never populated in Phase 1.
//
//   • Pure (besides the runtime clock). No I/O, no model calls.
//     Telemetry emission is the caller's job.
//
//   • Non-throwing. Dimension evaluators that throw are caught and
//     reported as `score: 0, rationale: 'evaluator threw'`.
//
//   • Same ExemplarSet as Pass A. If Pass A skipped, Pass B also
//     short-circuits to `insufficient_exemplars` — we never re-run
//     selection here. What the model was *taught* is what the model
//     is *graded on*.
//
//   • Fabrication guard. Every strengths / gaps / upgradeSuggestions
//     entry MUST reference an `ExemplarRef.id` from the set. Findings
//     with unknown ids are dropped and `fabricationGuard.ok` flips to
//     `false`.
// ════════════════════════════════════════════════════════════════

import type {
  ExemplarRef,
  ExemplarRole,
  ExemplarSet,
} from "./libraryStandard.ts";
import type { WorkspaceKey } from "./workspaceContractTypes.ts";

// ─── Types ────────────────────────────────────────────────────────

export type CalibrationSurface = "strategy-chat" | "run-task";

export type CalibrationVerdict =
  | "on_standard"
  | "near_standard"
  | "below_standard"
  | "insufficient_exemplars";

export type CalibrationConfidence = "low" | "medium" | "high";

export interface DimensionScore {
  /** Stable id within a workspace registry. */
  id: string;
  label: string;
  /** 0..5. 0 = unrateable / N/A. 1–5 vs. exemplar. */
  score: 0 | 1 | 2 | 3 | 4 | 5;
  /** Multiplied into the weighted average. */
  weight: number;
  rationale: string;
  /** Optional exemplar refs that informed this score. */
  exemplarRefs: string[];
}

export interface CalibrationFinding {
  text: string;
  /** Must be non-empty. Drops with empty refs are filtered out. */
  exemplarRefs: string[];
  dimensionId?: string;
}

export interface UpgradeSuggestion {
  target: "section" | "option" | "overall";
  targetRef?: string;
  change: string;
  rationale: string;
  /** Must be non-empty. */
  exemplarRefs: string[];
}

export interface CalibrationInputs {
  workspace: WorkspaceKey;
  surface: CalibrationSurface;
  taskType?: string;
  runId?: string;
  threadId?: string;
  messageId?: string;

  /** Final assistant/task output text the user will see. */
  outputText: string;
  /** Parsed structured output where available (sections, options...). */
  parsedOutput?: unknown;
  /** Optional user prompt — used for some heuristics (e.g. answer-first). */
  userPromptText?: string;

  /** The single ExemplarSet shared with Pass A. */
  exemplarSet: ExemplarSet;

  /**
   * Optional task-template hints (runTask only). When supplied, the
   * Artifacts dimension `section_completeness_vs_template` rates how
   * many required sections appear.
   */
  requiredSectionIds?: readonly string[];
}

export interface CalibrationResult {
  id: string;
  workspace: WorkspaceKey;
  surface: CalibrationSurface;
  taskType?: string;
  runId?: string;
  threadId?: string;
  messageId?: string;
  /** Always true in Phase 1. */
  shadow: true;

  /** Same id as `exemplarSet.exemplarSetId` — join key for telemetry. */
  exemplarSetId: string;
  /** True when Pass A actually injected the standards block. */
  standardContextInjected: boolean;
  /** Verbatim copy of the exemplar set actually used. */
  exemplarsUsed: ExemplarRef[];

  dimensions: DimensionScore[];
  strengths: CalibrationFinding[];
  gaps: CalibrationFinding[];
  upgradeSuggestions: UpgradeSuggestion[];

  /** Reserved — Phase 1 always leaves this undefined. */
  improvedDraft?: undefined;

  weightedScore: number; // 0..5
  overallVerdict: CalibrationVerdict;
  overallConfidence: CalibrationConfidence;
  reason: string;

  fabricationGuard: { ok: boolean; offending: string[] };

  ranAt: string;
  durationMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

const lower = (s: string) => (s ?? "").toLowerCase();

function clamp05(n: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(n)) return 0;
  const r = Math.max(0, Math.min(5, Math.round(n)));
  return r as 0 | 1 | 2 | 3 | 4 | 5;
}

function countMatches(text: string, re: RegExp): number {
  const m = (text ?? "").match(re);
  return m ? m.length : 0;
}

function hasHeading(text: string, heading: string): boolean {
  const t = lower(text);
  const h = lower(heading);
  return (
    t.includes(`## ${h}`) ||
    t.includes(`### ${h}`) ||
    t.includes(`# ${h}`) ||
    t.includes(`${h}:`)
  );
}

function refsByRole(set: ExemplarSet, roles: ExemplarRole[]): string[] {
  const wanted = new Set(roles);
  return set.exemplars.filter((e) => wanted.has(e.role)).map((e) => e.id);
}

/** Pick the first exemplar id matching one of `roles`, else any first. */
function firstRefRef(set: ExemplarSet, roles: ExemplarRole[]): string[] {
  const byRole = refsByRole(set, roles);
  if (byRole.length) return [byRole[0]];
  if (set.exemplars.length) return [set.exemplars[0].id];
  return [];
}

function makeId(): string {
  try {
    return (globalThis as any)?.crypto?.randomUUID?.() ??
      `cal_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return `cal_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ─── Dimension registry ──────────────────────────────────────────
//
// Each evaluator inspects `inputs` + the shared `ExemplarSet` and
// returns a partial `DimensionScore` plus optional findings. All
// evaluators are heuristic (Phase 1 — no LLM judge). They MUST NOT
// throw; the dispatcher catches anyway.

interface EvalContext {
  inputs: CalibrationInputs;
  set: ExemplarSet;
}

interface EvalOutput {
  score: number; // 0..5 — clamped by dispatcher
  rationale: string;
  exemplarRefs?: string[];
  strengths?: CalibrationFinding[];
  gaps?: CalibrationFinding[];
  upgrades?: UpgradeSuggestion[];
}

interface DimensionDef {
  id: string;
  label: string;
  weight: number;
  evaluator: (ctx: EvalContext) => EvalOutput;
}

// ─── Brainstorm ──────────────────────────────────────────────────

function dimBrainstormOptionDistinctness(): DimensionDef {
  return {
    id: "option_distinctness",
    label: "Option distinctness vs. multi-angle exemplars",
    weight: 1.2,
    evaluator: ({ inputs, set }) => {
      const text = inputs.outputText;
      // Count [Angle: …] markers OR numbered top-level options.
      const angles = (text.match(/\[Angle:\s*([^\]]+)\]/gi) ?? []).map(lower);
      const numbered = countMatches(text, /^\s*(?:\d+\.|[-*])\s+/gm);
      const optionCount = Math.max(angles.length, Math.min(numbered, 6));
      const refs = firstRefRef(set, ["pattern", "exemplar"]);

      if (optionCount < 2) {
        return {
          score: 1,
          rationale: `Only ${optionCount} option(s) detected; exemplar pattern expects ≥2 distinct angles.`,
          exemplarRefs: refs,
          gaps: refs.length
            ? [{
              text: "Output offers fewer than 2 distinct angles.",
              exemplarRefs: refs,
              dimensionId: "option_distinctness",
            }]
            : [],
          upgrades: refs.length
            ? [{
              target: "overall",
              change: "Add at least 2 angles with distinct reasons-to-engage.",
              rationale: "Exemplar pattern requires multi-angle coverage.",
              exemplarRefs: refs,
            }]
            : [],
        };
      }

      // Distinctness on labels when present.
      if (angles.length >= 2) {
        const unique = new Set(angles).size;
        if (unique < angles.length) {
          return {
            score: 2,
            rationale:
              `Found ${angles.length} angles but only ${unique} unique labels.`,
            exemplarRefs: refs,
            gaps: refs.length
              ? [{
                text: "Angles repeat — distinctness is shallow.",
                exemplarRefs: refs,
                dimensionId: "option_distinctness",
              }]
              : [],
            upgrades: refs.length
              ? [{
                target: "overall",
                change:
                  "Replace duplicate angle with one rooted in a different trigger (e.g. event vs. peer pull vs. exec reframe).",
                rationale: "Pattern calls for non-overlapping angles.",
                exemplarRefs: refs,
              }]
              : [],
          };
        }
      }

      const score = optionCount >= 3 ? 4 : 3;
      return {
        score,
        rationale: `Found ${optionCount} options; meets distinctness floor.`,
        exemplarRefs: refs,
        strengths: refs.length
          ? [{
            text: `Multi-angle coverage (${optionCount}) matches exemplar pattern.`,
            exemplarRefs: refs,
            dimensionId: "option_distinctness",
          }]
          : [],
      };
    },
  };
}

function dimBrainstormActionability(): DimensionDef {
  return {
    id: "actionability",
    label: "Actionability of options",
    weight: 0.8,
    evaluator: ({ inputs, set }) => {
      const t = lower(inputs.outputText);
      const verbs = countMatches(
        t,
        /\b(send|call|book|email|propose|run|share|introduce|ask|open|set up|invite|follow up|push)\b/g,
      );
      const refs = firstRefRef(set, ["pattern", "tactic"]);
      if (verbs >= 3) {
        return {
          score: 4,
          rationale: `Found ${verbs} actionable verbs across options.`,
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Options use concrete action verbs.",
              exemplarRefs: refs,
              dimensionId: "actionability",
            }]
            : [],
        };
      }
      if (verbs >= 1) {
        return {
          score: 3,
          rationale: `Only ${verbs} action verbs — partial actionability.`,
          exemplarRefs: refs,
        };
      }
      return {
        score: 2,
        rationale: "No action verbs detected — options read abstract.",
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: "Options lack concrete next-actions.",
            exemplarRefs: refs,
            dimensionId: "actionability",
          }]
          : [],
        upgrades: refs.length
          ? [{
            target: "overall",
            change:
              "Lead each option with a concrete verb (e.g. 'Send…', 'Book…', 'Propose…').",
            rationale: "Exemplar tactic shows verb-led action lines.",
            exemplarRefs: refs,
          }]
          : [],
      };
    },
  };
}

// ─── Deep Research ───────────────────────────────────────────────

function dimResearchConfidenceTagging(): DimensionDef {
  return {
    id: "confidence_tagging",
    label: "Confidence tagging on forward claims",
    weight: 1.1,
    evaluator: ({ inputs, set }) => {
      const tags = countMatches(
        inputs.outputText,
        /\[(verified|inferred|speculative|valid|infer|hypo|unkn)\]/gi,
      );
      const refs = firstRefRef(set, ["standard", "pattern"]);
      if (tags >= 2) {
        return {
          score: 4,
          rationale: `Found ${tags} confidence tags.`,
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Claims are tagged with confidence labels.",
              exemplarRefs: refs,
              dimensionId: "confidence_tagging",
            }]
            : [],
        };
      }
      if (tags === 1) {
        return {
          score: 3,
          rationale: "Single confidence tag — partial coverage.",
          exemplarRefs: refs,
        };
      }
      return {
        score: 2,
        rationale: "No confidence tags detected on forward-looking claims.",
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text:
              "Forward-looking claims are presented without confidence labels.",
            exemplarRefs: refs,
            dimensionId: "confidence_tagging",
          }]
          : [],
        upgrades: refs.length
          ? [{
            target: "overall",
            change:
              "Tag each forward claim with [VALID]/[INFER]/[HYPO]/[UNKN] per the standard.",
            rationale: "Library standard requires confidence labeling.",
            exemplarRefs: refs,
          }]
          : [],
      };
    },
  };
}

function dimResearchOpenQuestions(): DimensionDef {
  return {
    id: "open_questions_present",
    label: "Open questions / what we couldn't verify",
    weight: 0.9,
    evaluator: ({ inputs, set }) => {
      const present = hasHeading(inputs.outputText, "open questions") ||
        hasHeading(inputs.outputText, "unknowns") ||
        hasHeading(inputs.outputText, "what we couldn't verify");
      const refs = firstRefRef(set, ["pattern", "exemplar"]);
      if (present) {
        return {
          score: 4,
          rationale: "Open-questions / unknowns section present.",
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Output transparently lists what wasn't verified.",
              exemplarRefs: refs,
              dimensionId: "open_questions_present",
            }]
            : [],
        };
      }
      return {
        score: 2,
        rationale: "No open-questions / unknowns section.",
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: "Research is missing an explicit open-questions section.",
            exemplarRefs: refs,
            dimensionId: "open_questions_present",
          }]
          : [],
        upgrades: refs.length
          ? [{
            target: "section",
            targetRef: "open_questions",
            change: "Add an 'Open Questions' section listing what wasn't verified.",
            rationale: "Pattern calls for transparency on gaps.",
            exemplarRefs: refs,
          }]
          : [],
      };
    },
  };
}

// ─── Refine ──────────────────────────────────────────────────────

function dimRefineDriftGuard(): DimensionDef {
  return {
    id: "no_drift_from_source",
    label: "No drift from source intent",
    weight: 1.1,
    evaluator: ({ inputs, set }) => {
      // Heuristic — penalize obvious new-fact tells in a refine output.
      const t = lower(inputs.outputText);
      const tellsRe =
        /\b(\d{1,3}%\s+(off|discount)|free\s+(month|trial|shipping)|no\s+commitment)\b/g;
      const driftHits = countMatches(t, tellsRe);
      const refs = firstRefRef(set, ["pattern", "tactic"]);
      if (driftHits === 0) {
        return {
          score: 4,
          rationale: "No obvious new-fact tells in refined output.",
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Refine preserves original intent (no new commercial offers introduced).",
              exemplarRefs: refs,
              dimensionId: "no_drift_from_source",
            }]
            : [],
        };
      }
      return {
        score: 1,
        rationale:
          `Detected ${driftHits} new-fact tell(s) (e.g. discount/offer language) not implied by source.`,
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: "Refine introduced facts not present in the source draft.",
            exemplarRefs: refs,
            dimensionId: "no_drift_from_source",
          }]
          : [],
        upgrades: refs.length
          ? [{
            target: "overall",
            change:
              "Remove new commercial offers / facts not present in the original; surface them as a question instead.",
            rationale: "Refine pattern preserves source intent.",
            exemplarRefs: refs,
          }]
          : [],
      };
    },
  };
}

function dimRefineChangeClarity(): DimensionDef {
  return {
    id: "change_clarity",
    label: "Clarity of change vs. original",
    weight: 0.8,
    evaluator: ({ inputs, set }) => {
      const present = hasHeading(inputs.outputText, "changes") ||
        hasHeading(inputs.outputText, "what changed");
      const refs = firstRefRef(set, ["pattern", "tactic"]);
      return present
        ? {
          score: 4,
          rationale: "Change summary present.",
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Output explains what was changed.",
              exemplarRefs: refs,
              dimensionId: "change_clarity",
            }]
            : [],
        }
        : {
          score: 2,
          rationale: "No 'Changes' / 'What changed' summary.",
          exemplarRefs: refs,
          gaps: refs.length
            ? [{
              text: "Refine output doesn't enumerate what changed.",
              exemplarRefs: refs,
              dimensionId: "change_clarity",
            }]
            : [],
          upgrades: refs.length
            ? [{
              target: "section",
              targetRef: "changes",
              change: "Add a brief 'Changes' summary so the user can audit edits.",
              rationale: "Pattern requires change visibility on refines.",
              exemplarRefs: refs,
            }]
            : [],
        };
    },
  };
}

// ─── Library ─────────────────────────────────────────────────────

function dimLibrarySourcesUsed(): DimensionDef {
  return {
    id: "sources_used_completeness",
    label: "Sources-used summary present",
    weight: 0.9,
    evaluator: ({ inputs, set }) => {
      const present = hasHeading(inputs.outputText, "sources used") ||
        hasHeading(inputs.outputText, "sources");
      const refs = firstRefRef(set, ["pattern", "standard"]);
      return present
        ? {
          score: 4,
          rationale: "Sources-used section present.",
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Synthesis names the sources it leaned on.",
              exemplarRefs: refs,
              dimensionId: "sources_used_completeness",
            }]
            : [],
        }
        : {
          score: 2,
          rationale: "No 'Sources used' section.",
          exemplarRefs: refs,
          gaps: refs.length
            ? [{
              text: "Library synthesis omits a 'Sources used' section.",
              exemplarRefs: refs,
              dimensionId: "sources_used_completeness",
            }]
            : [],
          upgrades: refs.length
            ? [{
              target: "section",
              targetRef: "sources_used",
              change: "Append a short 'Sources used' list.",
              rationale: "Pattern requires transparent sourcing.",
              exemplarRefs: refs,
            }]
            : [],
        };
    },
  };
}

function dimLibraryGaps(): DimensionDef {
  return {
    id: "gap_transparency",
    label: "Gap transparency",
    weight: 0.7,
    evaluator: ({ inputs, set }) => {
      const t = lower(inputs.outputText);
      const present = hasHeading(inputs.outputText, "gaps") ||
        t.includes("[gap]") ||
        t.includes("what's missing");
      const refs = firstRefRef(set, ["pattern", "standard"]);
      return present
        ? {
          score: 4,
          rationale: "Gap transparency present.",
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Output flags what is missing.",
              exemplarRefs: refs,
              dimensionId: "gap_transparency",
            }]
            : [],
        }
        : {
          score: 3,
          rationale: "No explicit gap markers — neutral, non-fatal.",
          exemplarRefs: refs,
        };
    },
  };
}

// ─── Artifacts ───────────────────────────────────────────────────

function dimArtifactsSectionCompleteness(): DimensionDef {
  return {
    id: "section_completeness_vs_template",
    label: "Section completeness vs. template/exemplar",
    weight: 1.3,
    evaluator: ({ inputs, set }) => {
      const refs = firstRefRef(set, ["exemplar", "pattern"]);
      const ids = (inputs.requiredSectionIds ?? []).map(lower);
      if (ids.length === 0) {
        // No locked template — fall back to a heading count signal.
        const headingCount = countMatches(inputs.outputText, /^\s{0,3}#{1,3}\s+\S/gm);
        if (headingCount >= 4) {
          return {
            score: 4,
            rationale: `Found ${headingCount} top-level headings.`,
            exemplarRefs: refs,
          };
        }
        return {
          score: 2,
          rationale: `Only ${headingCount} headings — likely missing structure.`,
          exemplarRefs: refs,
        };
      }
      // Required-id mode.
      let foundIds = new Set<string>();
      const sections = (inputs.parsedOutput as any)?.sections;
      if (Array.isArray(sections)) {
        for (const s of sections) {
          if (s && typeof s.id === "string") foundIds.add(s.id.toLowerCase());
        }
      }
      if (foundIds.size === 0) {
        const t = lower(inputs.outputText);
        foundIds = new Set(ids.filter((id) => t.includes(id.replace(/_/g, " "))));
      }
      const missing = ids.filter((id) => !foundIds.has(id));
      if (missing.length === 0) {
        return {
          score: 5,
          rationale: `All ${ids.length} required sections present.`,
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: `Artifact has all ${ids.length} required sections.`,
              exemplarRefs: refs,
              dimensionId: "section_completeness_vs_template",
            }]
            : [],
        };
      }
      const ratio = (ids.length - missing.length) / ids.length;
      const score = clamp05(Math.round(1 + ratio * 3));
      return {
        score,
        rationale: `Missing sections: ${missing.join(", ")}.`,
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: `Artifact is missing required section(s): ${missing.join(", ")}.`,
            exemplarRefs: refs,
            dimensionId: "section_completeness_vs_template",
          }]
          : [],
        upgrades: refs.length
          ? missing.slice(0, 3).map((m) => ({
            target: "section" as const,
            targetRef: m,
            change: `Add the '${m}' section per the locked template.`,
            rationale: "Exemplar artifact carries this section.",
            exemplarRefs: refs,
          }))
          : [],
      };
    },
  };
}

function dimArtifactsPovClarity(): DimensionDef {
  return {
    id: "pov_clarity",
    label: "Point-of-view clarity",
    weight: 1.0,
    evaluator: ({ inputs, set }) => {
      const t = lower(inputs.outputText);
      const refs = firstRefRef(set, ["standard", "pattern"]);
      // PoV markers: the word "leakage", a $ amount, or a thesis sentence.
      const hasLeakage = t.includes("leakage");
      const hasDollar = /\$\s?\d/.test(inputs.outputText);
      const hasThesis = /\bthesis\b/.test(t);
      const score = (hasLeakage ? 2 : 0) + (hasDollar ? 2 : 0) +
        (hasThesis ? 1 : 0);
      const clamped = clamp05(score);
      if (clamped >= 4) {
        return {
          score: clamped,
          rationale:
            `PoV markers present (leakage=${hasLeakage}, dollar=${hasDollar}, thesis=${hasThesis}).`,
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "PoV names a concrete value leakage with economic framing.",
              exemplarRefs: refs,
              dimensionId: "pov_clarity",
            }]
            : [],
        };
      }
      return {
        score: clamp05(Math.max(2, score)),
        rationale: "PoV is generic — missing leakage / economic frame / thesis.",
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: "PoV doesn't name a specific value leakage with an economic frame.",
            exemplarRefs: refs,
            dimensionId: "pov_clarity",
          }]
          : [],
        upgrades: refs.length
          ? [{
            target: "section",
            targetRef: "pov",
            change:
              "Sharpen PoV: name the leakage, attach a $ / % frame, state a falsifiable thesis.",
            rationale: "Library standard for PoV specificity.",
            exemplarRefs: refs,
          }]
          : [],
      };
    },
  };
}

// ─── Work ────────────────────────────────────────────────────────

function dimWorkAnswerFirst(): DimensionDef {
  return {
    id: "answers_question_directly",
    label: "Answers the question directly",
    weight: 1.2,
    evaluator: ({ inputs, set }) => {
      const refs = firstRefRef(set, ["standard", "pattern"]);
      const text = inputs.outputText.trim();
      if (!text) {
        return { score: 0, rationale: "empty output", exemplarRefs: refs };
      }
      // Strip leading markdown scaffolding and check if first
      // substantive content is a recommendation/answer line.
      const firstLine =
        (text.split(/\n+/).find((l) => l.trim().length > 0) ?? "").trim();
      const lc = lower(firstLine.replace(/^[#>\-*]+\s*/, ""));
      const looksLikeAnswer = /^(recommend|answer|do this|here'?s|short answer|the move|next step)/.test(lc) ||
        lc.length >= 40 && !lc.endsWith("?") && !lc.startsWith("first,");
      if (looksLikeAnswer) {
        return {
          score: 4,
          rationale: "First line is a substantive answer / recommendation.",
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Output leads with the answer (no preamble).",
              exemplarRefs: refs,
              dimensionId: "answers_question_directly",
            }]
            : [],
        };
      }
      return {
        score: 2,
        rationale: "Output buries the answer behind setup / framing.",
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: "Operator-style answer is buried beneath reasoning.",
            exemplarRefs: refs,
            dimensionId: "answers_question_directly",
          }]
          : [],
        upgrades: refs.length
          ? [{
            target: "overall",
            change:
              "Lead with the recommendation; move reasoning into a short 'Why' paragraph.",
            rationale: "Library standard: answer-first.",
            exemplarRefs: refs,
          }]
          : [],
      };
    },
  };
}

function dimWorkLengthDiscipline(): DimensionDef {
  return {
    id: "length_discipline",
    label: "Length discipline (no bloat)",
    weight: 0.6,
    evaluator: ({ inputs, set }) => {
      const len = inputs.outputText.length;
      const refs = firstRefRef(set, ["standard", "pattern"]);
      if (len <= 3500) {
        return {
          score: 4,
          rationale: `len=${len} chars (within operator scope).`,
          exemplarRefs: refs,
        };
      }
      if (len <= 6000) {
        return {
          score: 3,
          rationale: `len=${len} chars (slightly long).`,
          exemplarRefs: refs,
        };
      }
      return {
        score: 2,
        rationale: `len=${len} chars (bloated).`,
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: "Operator answer runs long — exceeds expected scope.",
            exemplarRefs: refs,
            dimensionId: "length_discipline",
          }]
          : [],
      };
    },
  };
}

// ─── Projects ────────────────────────────────────────────────────

function dimProjectsContinuityRealism(): DimensionDef {
  return {
    id: "continuity_realism",
    label: "Continuity realism (no fabricated history)",
    weight: 1.1,
    evaluator: ({ inputs, set }) => {
      const t = lower(inputs.outputText);
      const refs = firstRefRef(set, ["pattern", "standard"]);
      const fabricated = t.includes("as we discussed") ||
        t.includes("previously decided") ||
        t.includes("last time we") ||
        t.includes("as we agreed");
      if (!fabricated) {
        return {
          score: 4,
          rationale: "No fabricated continuity phrases.",
          exemplarRefs: refs,
          strengths: refs.length
            ? [{
              text: "Project narrative avoids inventing prior discussions.",
              exemplarRefs: refs,
              dimensionId: "continuity_realism",
            }]
            : [],
        };
      }
      return {
        score: 1,
        rationale: "Output uses 'as we discussed'-style phrases without verified context.",
        exemplarRefs: refs,
        gaps: refs.length
          ? [{
            text: "Continuity language used without grounded prior context.",
            exemplarRefs: refs,
            dimensionId: "continuity_realism",
          }]
          : [],
        upgrades: refs.length
          ? [{
            target: "overall",
            change:
              "Replace 'as we discussed' with explicit references to recorded thread / project notes, or remove.",
            rationale: "Pattern: continuity must be verifiable.",
            exemplarRefs: refs,
          }]
          : [],
      };
    },
  };
}

// ─── Registry ─────────────────────────────────────────────────────

const REGISTRY: Readonly<Record<WorkspaceKey, DimensionDef[]>> = Object.freeze({
  brainstorm: [
    dimBrainstormOptionDistinctness(),
    dimBrainstormActionability(),
  ],
  deep_research: [
    dimResearchConfidenceTagging(),
    dimResearchOpenQuestions(),
  ],
  refine: [
    dimRefineDriftGuard(),
    dimRefineChangeClarity(),
  ],
  library: [
    dimLibrarySourcesUsed(),
    dimLibraryGaps(),
  ],
  artifacts: [
    dimArtifactsSectionCompleteness(),
    dimArtifactsPovClarity(),
  ],
  projects: [
    dimProjectsContinuityRealism(),
  ],
  work: [
    dimWorkAnswerFirst(),
    dimWorkLengthDiscipline(),
  ],
});

/** Public read-only accessor for tests / dashboards. */
export function dimensionsFor(workspace: WorkspaceKey): readonly DimensionDef[] {
  return REGISTRY[workspace] ?? [];
}

// ─── Verdict mapping ─────────────────────────────────────────────

function mapVerdict(
  weighted: number,
  exemplarCount: number,
  injected: boolean,
): { verdict: CalibrationVerdict; confidence: CalibrationConfidence; reason: string } {
  if (!injected || exemplarCount === 0) {
    return {
      verdict: "insufficient_exemplars",
      confidence: "low",
      reason: "No exemplars available — Pass A skipped.",
    };
  }
  // Confidence rises with exemplar count (2 → low, 3 → med, 4 → high).
  const confidence: CalibrationConfidence = exemplarCount >= 4
    ? "high"
    : exemplarCount === 3
    ? "medium"
    : "low";
  if (weighted >= 4.0) {
    return {
      verdict: "on_standard",
      confidence,
      reason: `Weighted score ${weighted.toFixed(2)} meets exemplar bar.`,
    };
  }
  if (weighted >= 3.0) {
    return {
      verdict: "near_standard",
      confidence,
      reason: `Weighted score ${weighted.toFixed(2)} approaches the exemplar bar.`,
    };
  }
  return {
    verdict: "below_standard",
    confidence,
    reason: `Weighted score ${weighted.toFixed(2)} is below the exemplar bar.`,
  };
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Run W6.5 Pass B. Always returns a result; never throws. Phase 1 is
 * heuristic-only and never produces an `improvedDraft`. Same
 * `ExemplarSet` as Pass A is used verbatim — if Pass A skipped,
 * verdict is `insufficient_exemplars`.
 */
export function runLibraryCalibration(
  inputs: CalibrationInputs,
): CalibrationResult {
  const startedAt = Date.now();
  const set = inputs.exemplarSet;
  const exemplarIds = new Set(set.exemplars.map((e) => e.id));

  const baseResult: CalibrationResult = {
    id: makeId(),
    workspace: inputs.workspace,
    surface: inputs.surface,
    taskType: inputs.taskType,
    runId: inputs.runId,
    threadId: inputs.threadId,
    messageId: inputs.messageId,
    shadow: true,
    exemplarSetId: set.exemplarSetId,
    standardContextInjected: set.injected,
    exemplarsUsed: set.exemplars,
    dimensions: [],
    strengths: [],
    gaps: [],
    upgradeSuggestions: [],
    weightedScore: 0,
    overallVerdict: "insufficient_exemplars",
    overallConfidence: "low",
    reason: "",
    fabricationGuard: { ok: true, offending: [] },
    ranAt: new Date().toISOString(),
    durationMs: 0,
  };

  // Short-circuit: Pass A skipped → Pass B skips too.
  if (!set.injected || set.exemplars.length === 0) {
    const v = mapVerdict(0, 0, false);
    return {
      ...baseResult,
      overallVerdict: v.verdict,
      overallConfidence: v.confidence,
      reason: v.reason,
      durationMs: Date.now() - startedAt,
    };
  }

  const defs = dimensionsFor(inputs.workspace);
  if (defs.length === 0) {
    return {
      ...baseResult,
      overallVerdict: "insufficient_exemplars",
      overallConfidence: "low",
      reason: `No calibration dimensions registered for workspace '${inputs.workspace}'.`,
      durationMs: Date.now() - startedAt,
    };
  }

  const dimensions: DimensionScore[] = [];
  const strengths: CalibrationFinding[] = [];
  const gaps: CalibrationFinding[] = [];
  const upgrades: UpgradeSuggestion[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const def of defs) {
    let out: EvalOutput;
    try {
      out = def.evaluator({ inputs, set });
    } catch (err) {
      console.warn(
        `[library:calibration] dimension '${def.id}' threw: ${
          String(err).slice(0, 200)
        }`,
      );
      out = {
        score: 0,
        rationale: "evaluator threw",
        exemplarRefs: [],
      };
    }
    const clamped = clamp05(out.score);
    dimensions.push({
      id: def.id,
      label: def.label,
      score: clamped,
      weight: def.weight,
      rationale: out.rationale,
      exemplarRefs: out.exemplarRefs ?? [],
    });
    if (clamped > 0) {
      weightedSum += clamped * def.weight;
      weightTotal += def.weight;
    }
    for (const s of out.strengths ?? []) strengths.push(s);
    for (const g of out.gaps ?? []) gaps.push(g);
    for (const u of out.upgrades ?? []) upgrades.push(u);
  }

  // ─── Fabrication guard ────────────────────────────────────────
  const offending: string[] = [];
  const filterRefs = (
    refs: string[],
  ): { kept: string[]; bad: string[] } => {
    const kept: string[] = [];
    const bad: string[] = [];
    for (const r of refs) {
      if (exemplarIds.has(r)) kept.push(r);
      else bad.push(r);
    }
    return { kept, bad };
  };

  const filteredStrengths = strengths
    .map((f) => {
      const { kept, bad } = filterRefs(f.exemplarRefs);
      offending.push(...bad);
      return { ...f, exemplarRefs: kept };
    })
    .filter((f) => f.exemplarRefs.length > 0);
  const filteredGaps = gaps
    .map((f) => {
      const { kept, bad } = filterRefs(f.exemplarRefs);
      offending.push(...bad);
      return { ...f, exemplarRefs: kept };
    })
    .filter((f) => f.exemplarRefs.length > 0);
  const filteredUpgrades = upgrades
    .map((u) => {
      const { kept, bad } = filterRefs(u.exemplarRefs);
      offending.push(...bad);
      return { ...u, exemplarRefs: kept };
    })
    .filter((u) => u.exemplarRefs.length > 0);

  // Also clean dimension exemplarRefs of unknown ids (don't drop the
  // dimension itself — the score still stands).
  const cleanDimensions = dimensions.map((d) => {
    const { kept, bad } = filterRefs(d.exemplarRefs);
    offending.push(...bad);
    return { ...d, exemplarRefs: kept };
  });

  const fabricationOk = offending.length === 0;
  if (!fabricationOk) {
    console.warn(
      `[library:calibration] fabrication guard tripped — ${offending.length} unknown exemplar id(s) dropped.`,
    );
  }

  const weighted = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const v = mapVerdict(weighted, set.exemplars.length, true);

  return {
    ...baseResult,
    dimensions: cleanDimensions,
    strengths: filteredStrengths,
    gaps: filteredGaps,
    upgradeSuggestions: filteredUpgrades,
    weightedScore: Number(weighted.toFixed(3)),
    overallVerdict: v.verdict,
    overallConfidence: v.confidence,
    reason: v.reason,
    fabricationGuard: {
      ok: fabricationOk,
      offending: Array.from(new Set(offending)),
    },
    durationMs: Date.now() - startedAt,
  };
}

// ─── Telemetry ───────────────────────────────────────────────────

export interface CalibrationResultLog {
  workspace: WorkspaceKey;
  surface: CalibrationSurface;
  taskType?: string;
  runId?: string;
  threadId?: string;
  messageId?: string;
  exemplarSetId: string;
  standardContextInjected: boolean;
  exemplarCount: number;
  dimensionScores: Array<Pick<DimensionScore, "id" | "score" | "weight">>;
  weightedScore: number;
  overallVerdict: CalibrationVerdict;
  overallConfidence: CalibrationConfidence;
  strengthsCount: number;
  gapsCount: number;
  upgradesCount: number;
  fabricationGuardOk: boolean;
  improvedDraftEmitted: false;
  durationMs: number;
  shadow: true;
}

export function buildCalibrationLog(
  result: CalibrationResult,
): CalibrationResultLog {
  return {
    workspace: result.workspace,
    surface: result.surface,
    taskType: result.taskType,
    runId: result.runId,
    threadId: result.threadId,
    messageId: result.messageId,
    exemplarSetId: result.exemplarSetId,
    standardContextInjected: result.standardContextInjected,
    exemplarCount: result.exemplarsUsed.length,
    dimensionScores: result.dimensions.map((d) => ({
      id: d.id,
      score: d.score,
      weight: d.weight,
    })),
    weightedScore: result.weightedScore,
    overallVerdict: result.overallVerdict,
    overallConfidence: result.overallConfidence,
    strengthsCount: result.strengths.length,
    gapsCount: result.gaps.length,
    upgradesCount: result.upgradeSuggestions.length,
    fabricationGuardOk: result.fabricationGuard.ok,
    improvedDraftEmitted: false,
    durationMs: result.durationMs,
    shadow: true,
  };
}

/** Emit a `workspace:calibration_result` log line. Never throws. */
export function logCalibrationResult(result: CalibrationResult): void {
  try {
    console.log(
      `workspace:calibration_result ${
        JSON.stringify(buildCalibrationLog(result))
      }`,
    );
  } catch {
    /* never throw from telemetry */
  }
}

// ─── Persistence ─────────────────────────────────────────────────

export interface CalibrationPersistenceBlock {
  workspace: WorkspaceKey;
  surface: CalibrationSurface;
  exemplarSetId: string;
  standardContextInjected: boolean;
  weightedScore: number;
  overallVerdict: CalibrationVerdict;
  overallConfidence: CalibrationConfidence;
  reason: string;
  dimensions: Array<Pick<DimensionScore, "id" | "label" | "score" | "weight" | "rationale">>;
  strengths: CalibrationFinding[];
  gaps: CalibrationFinding[];
  upgradeSuggestions: UpgradeSuggestion[];
  fabricationGuard: { ok: boolean; offending: string[] };
}

export function buildCalibrationPersistenceBlock(
  result: CalibrationResult,
): CalibrationPersistenceBlock {
  return {
    workspace: result.workspace,
    surface: result.surface,
    exemplarSetId: result.exemplarSetId,
    standardContextInjected: result.standardContextInjected,
    weightedScore: result.weightedScore,
    overallVerdict: result.overallVerdict,
    overallConfidence: result.overallConfidence,
    reason: result.reason,
    dimensions: result.dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      score: d.score,
      weight: d.weight,
      rationale: d.rationale,
    })),
    strengths: result.strengths,
    gaps: result.gaps,
    upgradeSuggestions: result.upgradeSuggestions,
    fabricationGuard: result.fabricationGuard,
  };
}
