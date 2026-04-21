// ════════════════════════════════════════════════════════════════
// Strategy V2 — Single Async Quality Audit
//
// Replaces 4 V1 post-gen guards (operator-reasoning, citation,
// body/appendix consistency, application-layer). NEVER blocks.
// NEVER triggers regen. Persists scores to routing_decision so
// we can debug, surface a quality indicator in the UI, and tune
// the rubric over time.
//
// Phase 2.5: adds a strong-signal synthesis STOP-RULE flag —
// `synthesis_strong_fail` — when ask=synthesis_framework,
// mode=A_strong, hits>=5 and the answer lacks POV / literal
// citation / tradeoff / commercial framing. Logging only, no
// regen — but it surfaces the failure loudly.
// ════════════════════════════════════════════════════════════════

import type { V2AskShape, V2Mode } from "./operatorDispatcher.ts";
import { type RubricScores, scoreRubric } from "./reasoningRubric.ts";

export interface QualityAuditResult {
  scores: RubricScores;
  flags: string[]; // human-readable diagnostic flags
  passed: boolean; // overall >= 0.6
}

const VAGUE_LIBRARY_RE = /\b(your\s+(?:KI|ki)\s+on\s+\w+|your\s+library\s+(?:suggests|shows|argues|on)|from\s+your\s+library|your\s+playbook\s+(?:suggests|shows)|your\s+resources?\s+(?:show|suggest))\b/i;
const LITERAL_RESOURCE_RE = /RESOURCE\[\s*"?[^\]"]+"?\s*\]/;
const LITERAL_KI_RE = /KI\[\s*[a-f0-9]{6,}\s*\]/i;
const POV_QUICK_RE = /\b(the (?:dominant|real|core|key|single biggest|highest-leverage)|what (?:actually|really) matters|i'?d (?:lead|weight|prioritize)|the call is|commit to|matters more than)\b/i;
const TRADEOFF_RE = /\b(ignore|table stakes|deprioriti[sz]e|skip|noise|overrated|overweight|correlation,?\s*not\s*cause|doesn't move (?:the )?(?:number|deal|needle))\b/i;
const COMMERCIAL_RE = /\b(pipeline|velocity|win[\s-]rate|acv|arr|churn|payback|cost of inaction|deal[\s-]?slip|no[\s-]decision|cycle time|forecast|conversion rate|quota|attainment)\b/i;
const SURVEY_RE = /\b(operators? (?:converge|diverge) on|multiple (?:themes|patterns) emerge|both approaches have merit|on (?:the )?one hand[^.]{0,200}on the other hand|there are (?:several|many|multiple) (?:patterns|themes|approaches))\b/i;

export function auditQuality(args: {
  body: string;
  mode: V2Mode;
  askShape: V2AskShape;
  hadLibraryHits: boolean;
  audienceMentioned: boolean;
  resourceTitles?: string[];
  kiIds?: string[];
  kiTitles?: string[];
}): QualityAuditResult {
  const scores = scoreRubric({
    body: args.body,
    mode: args.mode,
    askShape: args.askShape,
    hadLibraryHits: args.hadLibraryHits,
    audienceMentioned: args.audienceMentioned,
    resourceTitles: args.resourceTitles,
    kiIds: args.kiIds,
    kiTitles: args.kiTitles,
  });
  const flags: string[] = [];
  const text = args.body || "";
  const resourceHitCount = args.resourceTitles?.length || 0;
  const kiHitCount = args.kiIds?.length || 0;
  const totalStrong = resourceHitCount + kiHitCount;

  if (scores.operatorPOV < 0.5) flags.push("low_operator_pov");
  if (scores.decisionLogic < 0.5 && args.askShape !== "short_form" && args.mode !== "C_general") {
    flags.push("missing_decision_logic");
  }
  if (
    scores.commercialSharpness < 0.5 &&
    args.askShape !== "short_form" &&
    args.askShape !== "general" &&
    args.mode !== "C_general"
  ) {
    flags.push("low_commercial_framing");
  }
  if (args.hadLibraryHits && scores.libraryLeverage < 0.5) {
    flags.push("library_underused");
  }
  if (!args.hadLibraryHits && args.mode === "D_thin" && scores.libraryLeverage < 0.5) {
    flags.push("missing_extension_flag");
  }

  // Phase 2.5: vague-library-references flag — fires when there's strong signal
  // and the model used vague refs like "your KI on…" instead of literal titles.
  if (totalStrong >= 5 && VAGUE_LIBRARY_RE.test(text)) {
    flags.push("vague_library_references");
  }

  // Phase 2.5: descriptive survey flag — fires when balanced-survey markers
  // appear without a strong POV phrase nearby.
  if (SURVEY_RE.test(text) && !POV_QUICK_RE.test(text)) {
    flags.push("descriptive_survey_no_pov");
  }

  // Phase 2.5: STRONG-SIGNAL SYNTHESIS STOP-RULE
  // ask=synthesis_framework + mode=A_strong + hits>=5 → answer MUST contain:
  //   POV + literal citation + tradeoff + commercial consequence
  // Otherwise → loud `synthesis_strong_fail` flag.
  const isStrongSynth =
    args.askShape === "synthesis_framework" &&
    args.mode === "A_strong" &&
    resourceHitCount >= 5;
  if (isStrongSynth) {
    const hasPOV = POV_QUICK_RE.test(text);
    const hasLiteralCitation = LITERAL_RESOURCE_RE.test(text) || LITERAL_KI_RE.test(text);
    const hasTradeoff = TRADEOFF_RE.test(text);
    const hasCommercial = COMMERCIAL_RE.test(text);

    const missing: string[] = [];
    if (!hasPOV) missing.push("pov");
    if (!hasLiteralCitation) missing.push("literal_citation");
    if (!hasTradeoff) missing.push("tradeoff");
    if (!hasCommercial) missing.push("commercial_consequence");

    if (missing.length > 0) {
      flags.push(`synthesis_strong_fail:${missing.join(",")}`);
    }

    // Phase 2.6: descriptive_synthesis_despite_citations
    // Even if literal citations are present, if the structure is still a
    // balanced survey (no committed POV, or survey markers dominate),
    // flag it. Citations alone don't make it operator-grade.
    if (hasLiteralCitation) {
      const surveyMarkerCount = (text.match(SURVEY_RE) || []).length;
      const povMarkerCount = (text.match(POV_QUICK_RE) || []).length;
      const tradeoffCount = (text.match(TRADEOFF_RE) || []).length;
      // Descriptive-survey-despite-citations: survey language present AND
      // (no POV OR survey markers > POV markers OR no tradeoff calls).
      if (
        surveyMarkerCount >= 1 &&
        (!hasPOV || surveyMarkerCount >= povMarkerCount || tradeoffCount === 0)
      ) {
        flags.push("descriptive_synthesis_despite_citations");
      }
    }
  }

  return {
    scores,
    flags,
    passed:
      scores.overall >= 0.6 &&
      !flags.some((f) =>
        f.startsWith("synthesis_strong_fail") ||
        f === "descriptive_synthesis_despite_citations"
      ),
  };
}
