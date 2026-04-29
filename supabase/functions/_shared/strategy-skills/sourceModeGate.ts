/**
 * Source-mode gate (Phase 3, pure).
 *
 * Enforces the proof burden each `sourceMode` declares:
 *
 *   library_required  → must hit `minRelevantItems` AND have ≥1 standardish hit
 *                       (standards or playbooks). Otherwise → REFUSE.
 *
 *   library_first     → must hit `minRelevantItems`. Otherwise → WARN
 *                       (gate returns `degrade=true`; runtime decides
 *                       whether to refuse or continue with caveat).
 *
 *   library_relevant  → no hard floor; only WARN when zero hits.
 *
 * The gate NEVER silently falls back to a generic answer. Refusals
 * surface a structured reason the runtime returns to the client.
 */
import type {
  RetrievalConfidence,
  RetrievalCounts,
  SkillSourceMode,
} from "./planner.ts";

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

  if (input.sourceMode === "library_required") {
    if (total === 0) {
      return {
        decision: "refuse",
        reason: "library_required: no library hits — refusing to answer without proof",
      };
    }
    if (total < input.minRelevantItems || standardish < 1) {
      return {
        decision: "refuse",
        reason: `library_required: hits=${total}/${input.minRelevantItems}, standardish=${standardish} — proof burden not met`,
      };
    }
    return { decision: "pass" };
  }

  if (input.sourceMode === "library_first") {
    if (total === 0) {
      return {
        decision: "refuse",
        reason: "library_first: zero library hits — refusing silent fallback",
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
