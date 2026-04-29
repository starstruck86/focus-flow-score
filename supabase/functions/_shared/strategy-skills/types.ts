/**
 * Strategy Skills — server types (Phase 3).
 *
 * Mirror of `src/lib/strategy-skills/types.ts` for Deno edge runtime.
 * Kept structurally identical so the frontend planner/manifests can be
 * hashed-compared in cross-runtime tests.
 *
 * INERT until invoked behind STRATEGY_SKILLS_ENABLED + `x-skill-debug`.
 */

export type SkillBehaviorIntent =
  | "conversation_strategy"
  | "pov_synthesis"
  | "research_brief"
  | "idea_generation"
  | "refine_message"
  | "discovery_prep"
  | "account_brief"
  | "ninety_day_plan"
  | "objection_handling"
  | "stakeholder_map";

export type SkillWorkspace =
  | "brainstorm"
  | "deep_research"
  | "refine"
  | "library"
  | "artifacts"
  | "projects"
  | "work";

export type SkillDepth = "quick" | "standard" | "deep" | "artifact";

export type SkillSourceMode =
  | "library_first"
  | "library_required"
  | "library_relevant";

export type PlannerScope =
  | "knowledge_items"
  | "playbooks"
  | "standards"
  | "exemplars"
  | "patterns"
  | "templates";

export interface SkillRetrievalPlan {
  scopes: ReadonlyArray<PlannerScope>;
  termBindings: ReadonlyArray<string>;
  filters?: Readonly<Record<string, string>>;
  minRelevantItems?: number;
}

export interface SkillQualityRubric {
  mustHave: ReadonlyArray<string>;
  genericMarkers: ReadonlyArray<string>;
  maxGenericMarkers: number;
}

export interface SkillOutputContract {
  shape: "prose" | "list" | "structured_artifact";
  targetWords?: { min: number; max: number };
  forbid?: ReadonlyArray<"headings" | "bullets" | "tables">;
}

export interface SkillManifest {
  id: string;
  label: string;
  description: string;
  behaviorIntent: SkillBehaviorIntent;
  workspace: SkillWorkspace;
  depth: SkillDepth;
  sourceMode: SkillSourceMode;
  retrieval: SkillRetrievalPlan;
  output: SkillOutputContract;
  rubric: SkillQualityRubric;
  version: "1";
}
