/**
 * Source-mode gate (Phase 3, pure).
 *
 * Enforces the proof burden each `sourceMode` declares:
 *
 *   library_required  → must have real library proof with quality awareness.
 *                       Accepts if:
 *                       • standardish (playbooks/standards) ≥ 1, OR
 *                       • KI influence quality meets proof burden:
 *                         - primary + supporting >= minRelevantItems, OR
 *                         - primary >= 1 AND total >= minRelevantItems
 *                       Refuses when total === 0, confidence === insufficient,
 *                       or ALL KIs are weak (no primary/supporting influence).
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

/** Optional influence quality breakdown for KIs. */
export interface InfluenceCounts {
  primary?: number;
  supporting?: number;
  weak?: number;
}

export interface SourceGateInput {
  sourceMode: SkillSourceMode;
  counts: RetrievalCounts;
  confidence: RetrievalConfidence;
  minRelevantItems: number;
  /** When provided, enables quality-aware proof for library_required. */
  influence?: InfluenceCounts;
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
    // Accept if standardish proof exists (playbooks/standards)
    if (standardish >= 1) {
      return { decision: "pass" };
    }
    // Quality-aware KI proof: if influence data is available, require meaningful influence
    const inf = input.influence;
    if (inf) {
      const primary = inf.primary ?? 0;
      const supporting = inf.supporting ?? 0;
      const meaningful = primary + supporting;
      // All KIs are weak — no meaningful influence → refuse for artifact-grade
      if (meaningful === 0 && kiHits > 0) {
        return {
          decision: "refuse",
          reason: `library_required: ${kiHits} KIs but all weak influence (p=${primary}, s=${supporting}, w=${inf.weak ?? 0}) — refusing artifact-grade execution`,
        };
      }
      // KI-dominant proof: meaningful influence meets threshold
      if (meaningful >= input.minRelevantItems || (primary >= 1 && total >= input.minRelevantItems)) {
        return { decision: "pass" };
      }
      // Some meaningful but not enough
      return {
        decision: "warn",
        reason: `library_required: meaningful=${meaningful}, total=${total} — partial proof, proceeding with caveat`,
      };
    }
    // No influence data provided — fall back to count-based KI-dominant check
    if (kiHits >= input.minRelevantItems) {
      return { decision: "pass" };
    }
    // Some hits but below proof threshold → warn
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

  // library_relevant
  if (total === 0) {
    return {
      decision: "warn",
      reason: "library_relevant: no library matches — answering from general reasoning",
    };
  }
  return { decision: "pass" };
}
