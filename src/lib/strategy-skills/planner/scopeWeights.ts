/**
 * Per-sourceMode scope weights — Phase 2 (inert).
 * Hints only; the existing retriever owns final ranking.
 */
import type { PlannerScope } from './contextTypes';
import type { SkillSourceMode } from '../types';

type WeightTable = Readonly<Record<SkillSourceMode, Readonly<Record<PlannerScope, number>>>>;

export const SCOPE_WEIGHTS: WeightTable = Object.freeze({
  library_first: Object.freeze({
    knowledge_items: 1.0, playbooks: 0.8, standards: 0.7, exemplars: 0.5, patterns: 0.5, templates: 0.4,
  }),
  library_required: Object.freeze({
    knowledge_items: 1.0, playbooks: 0.9, standards: 0.9, exemplars: 0.6, patterns: 0.6, templates: 0.5,
  }),
  library_relevant: Object.freeze({
    knowledge_items: 0.8, playbooks: 0.6, standards: 0.6, exemplars: 0.4, patterns: 0.4, templates: 0.3,
  }),
});

export function weightsForMode(
  mode: SkillSourceMode,
  scopes: ReadonlyArray<PlannerScope>,
): Record<PlannerScope, number> {
  const table = SCOPE_WEIGHTS[mode];
  const out = {} as Record<PlannerScope, number>;
  for (const s of scopes) out[s] = table[s];
  return out;
}
