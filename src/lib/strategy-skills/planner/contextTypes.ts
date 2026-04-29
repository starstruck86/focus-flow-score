/**
 * Planner context contracts — Phase 2 (inert).
 *
 * Typed shapes the planner accepts. The planner does not import from
 * hooks, edge functions, or the runtime. Tests pass fixtures.
 */
import type { SkillDepth, SkillManifest, SkillSourceMode } from '../types';

export type PlannerScope =
  | 'knowledge_items'
  | 'playbooks'
  | 'standards'
  | 'exemplars'
  | 'patterns'
  | 'templates';

export interface PlannerThreadContext {
  threadId: string;
  account?: { id?: string; name?: string; industry?: string };
  opportunity?: { id?: string; name?: string; stage?: string };
  persona?: { id?: string; title?: string };
  topic?: string;
  lastBehaviorIntent?: string;
}

export interface PlannerSkillRunState {
  lastSkillId?: string;
  lastResolved?: { inputs: Record<string, string> };
  lastRetrievalPlanHash?: string;
}

export interface PlannerContext {
  thread?: PlannerThreadContext;
  account?: PlannerThreadContext['account'];
  prior?: PlannerSkillRunState;
}

export interface RetrievalQueryPlan {
  skillId: string;
  skillVersion: string;
  depth: SkillDepth;
  sourceMode: SkillSourceMode;
  entityScoped: boolean;
  entityRefs: ReadonlyArray<{ kind: 'account' | 'opportunity' | 'persona'; id: string }>;
  termSeeds: ReadonlyArray<string>;
  unresolvedBindings: ReadonlyArray<string>;
  scopes: ReadonlyArray<PlannerScope>;
  scopeBudgets: Readonly<Record<PlannerScope, number>>;
  scopeWeights: Readonly<Record<PlannerScope, number>>;
  filters: Readonly<Record<string, string>>;
  minRelevantItems: number;
  totalCap: number;
  planHash: string;
  contextHash: string;
}

export type PlannerRefusal =
  | { ok: false; reason: 'insufficient_context'; skillId: string }
  | { ok: false; reason: 'unknown_skill'; token: string }
  | { ok: false; reason: 'forbidden_static_key'; key: string };

export type PlannerResult =
  | { ok: true; plan: RetrievalQueryPlan }
  | PlannerRefusal;

export type RetrievalCounts = Partial<Record<PlannerScope, number>>;

export type RetrievalConfidence = 'high' | 'medium' | 'low' | 'insufficient';
