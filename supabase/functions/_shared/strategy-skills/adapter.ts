/**
 * Plan → existing-retrieval adapter (Phase 3, pure shape).
 *
 * The skills planner produces a `RetrievalQueryPlan`. The existing
 * Strategy retrieval (`retrieveLibraryContext`) accepts only:
 *   { scopes: string[], maxKIs?: number, maxPlaybooks?: number }
 *
 * This adapter MAPS the planner's structured plan onto that exact
 * shape — no parallel retrieval stack, no new query path. Term seeds
 * become scope keywords; budgets clamp KI/playbook counts.
 */
import type { RetrievalQueryPlan } from "./planner.ts";

export interface ExistingRetrievalArgs {
  /** Keyword scopes used by `retrieveLibraryContext`. */
  scopes: string[];
  /** Cap on Knowledge Items (mirrors retriever's existing arg). */
  maxKIs: number;
  /** Cap on Playbooks (mirrors retriever's existing arg). */
  maxPlaybooks: number;
}

/**
 * Convert a planner plan into the EXACT argument shape the existing
 * retriever already accepts. No new fields. No new pathways.
 */
export function planToRetrievalArgs(plan: RetrievalQueryPlan): ExistingRetrievalArgs {
  // Term seeds drive the existing retriever's keyword scoring. We dedupe
  // (case-insensitive) and trim to keep the keyword payload compact.
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const t of plan.termSeeds) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      keywords.push(t);
    }
  }
  // Filter values are also useful retrieval keywords (e.g. industry).
  for (const v of Object.values(plan.filters)) {
    if (typeof v === "string" && v.trim()) {
      const k = v.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        keywords.push(v);
      }
    }
  }

  // Caps: planner budgets are PER-SCOPE; the existing retriever uses
  // global caps for KIs and playbooks. Use the planner's per-scope
  // budget as the cap (clamped to the totalCap as a safety net).
  const kiBudget = Math.min(
    plan.scopeBudgets.knowledge_items ?? 0,
    plan.totalCap,
  );
  const pbBudget = Math.min(
    plan.scopeBudgets.playbooks ?? 0,
    plan.totalCap,
  );

  return {
    scopes: keywords,
    maxKIs: Math.max(1, kiBudget),
    maxPlaybooks: Math.max(1, pbBudget),
  };
}
