/**
 * Per-depth scope budgets — Phase 2 (inert).
 * Caps the planner passes to the (future) retriever. Never id enumeration.
 */
import type { PlannerScope } from './contextTypes';
import type { SkillDepth } from '../types';

type BudgetTable = Readonly<Record<SkillDepth, Readonly<Record<PlannerScope, number>>>>;

export const SCOPE_BUDGETS: BudgetTable = Object.freeze({
  quick: Object.freeze({
    knowledge_items: 4, playbooks: 2, standards: 2, exemplars: 1, patterns: 1, templates: 1,
  }),
  standard: Object.freeze({
    knowledge_items: 8, playbooks: 3, standards: 3, exemplars: 2, patterns: 2, templates: 2,
  }),
  deep: Object.freeze({
    knowledge_items: 14, playbooks: 5, standards: 4, exemplars: 3, patterns: 2, templates: 2,
  }),
  artifact: Object.freeze({
    knowledge_items: 20, playbooks: 6, standards: 5, exemplars: 4, patterns: 3, templates: 3,
  }),
});

export const TOTAL_CAPS: Readonly<Record<SkillDepth, number>> = Object.freeze({
  quick: 8, standard: 14, deep: 22, artifact: 30,
});

export function budgetsForDepth(
  depth: SkillDepth,
  scopes: ReadonlyArray<PlannerScope>,
): Record<PlannerScope, number> {
  const table = SCOPE_BUDGETS[depth];
  const out = {} as Record<PlannerScope, number>;
  for (const s of scopes) out[s] = table[s];
  return out;
}
