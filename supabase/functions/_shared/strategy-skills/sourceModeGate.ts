/**
 * Source-mode gate (Phase 3, pure).
 *
 * Enforces the proof burden each `sourceMode` declares:
 *
 *   library_required  → must have real library proof. Accepts ANY of:
 *                       • standardish (playbooks/standards) ≥ 1
 *                       • knowledge_items dominant (KIs ≥ minRelevantItems)
 *                       Refuses ONLY when total === 0 or confidence === insufficient.
 *
 *   library_first     → prefers library but NEVER hard-refuses.
 *                       0 hits → WARN (proceed with SOP).
 *                       < minRelevantItems → WARN (reduced grounding).
 *                       Otherwise → PASS.
 *
 *   library_relevant  → no hard floor; only WARN when zero hits.
 *
 * The gate NEVER silently falls back to a generic answer. Warnings
 * surface a structured reason the runtime can attach as a caveat.
 */
import type {
  RetrievalConfidence,
  RetrievalCounts,
} from "./planner.ts";
import type { SkillSourceMode } from "./types.ts";

export type SourceGateDecision =
  | { decision: "pass" }
  | { decision: "warn"; reason: string }
  | { decision: "refuse"; reason: string };

export interface SourceGateInput {
  sourceMode: SkillSourceMode;
  counts: RetrievalCounts;
  confidence: RetrievalConfidence;
  minRelevantItems: number;
}

function totalHits(c: RetrievalCounts): number {
  let n = 0;
  for (const k of Object.keys(c) as Array<keyof RetrievalCounts>) {
    n += c[k] ?? 0;
  }
  return n;
}

export function applySourceModeGate(input: SourceGateInput): SourceGateDecision {
  const total = totalHits(input.counts);
  const standardish = (input.counts.standards ?? 0) + (input.counts.playbooks ?? 0);
  const kiHits = input.counts.knowledge_items ?? 0;

  if (input.sourceMode === "library_required") {
    // Hard refuse: no library proof at all
    if (total === 0 || input.confidence === "insufficient") {
      return {
        decision: "refuse",
        reason: "library_required: no library hits — refusing to answer without proof",
      };
    }
    // Accept if ANY strong proof path exists:
    //   1. standardish (playbooks/standards) present
    //   2. KIs are dominant (meet the minimum on their own)
    const hasStandardishProof = standardish >= 1;
    const hasKIDominantProof = kiHits >= input.minRelevantItems;
    if (hasStandardishProof || hasKIDominantProof) {
      return { decision: "pass" };
    }
    // Some hits but below proof threshold → warn, not refuse
    // (partial library coverage should degrade, not block)
    return {
      decision: "warn",
      reason: `library_required: hits=${total}, ki=${kiHits}, standardish=${standardish} — partial proof, proceeding with caveat`,
    };
  }

  if (input.sourceMode === "library_first") {
    // NEVER hard-refuse; warn on weak/missing library
    if (total === 0) {
      return {
        decision: "warn",
        reason: "library_first: zero library hits — proceeding with SOP reasoning",
      };
    }
    if (total < input.minRelevantItems) {
      return {
        decision: "warn",
        reason: `library_first: ${total}/${input.minRelevantItems} hits — proceeding with reduced grounding`,
      };
    }
    return { decision: "pass" };
  }

  // library_relevant
  if (total === 0) {
    return {
      decision: "warn",
      reason: "library_relevant: no library matches — answering from general reasoning",
    };
  }
  return { decision: "pass" };
}
