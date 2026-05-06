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
  /**
   * Static methodology terms always injected into retrieval alongside
   * resolved bindings. These are NOT user inputs — they are the skill's
   * inherent domain vocabulary (e.g. MEDDICC components for a MEDDICC review).
   */
  methodologySeeds?: ReadonlyArray<string>;
  filters?: Readonly<Record<string, string>>;
  minRelevantItems?: number;
}

/**
 * Maps a mustHave concept to its declared output location.
 * `section`: dedicated heading (e.g. "## Risks & Mitigation").
 * `embedded`: concept lives inside a parent section; gate validates
 *   substance within that parent instead of demanding a standalone heading.
 */
export interface SectionMapping {
  concept: string;
  location: "section" | "embedded";
  /** Parent section id/name when location = "embedded". */
  parentSection?: string;
  /** Minimum word count for substance validation (default 40). */
  minWords?: number;
}

export interface SkillQualityRubric {
  mustHave: ReadonlyArray<string>;
  genericMarkers: ReadonlyArray<string>;
  maxGenericMarkers: number;
  /**
   * Explicit mapping of mustHave concepts to output sections.
   * When present, the artifact gate uses this to find concept content
   * in the correct location instead of scanning the entire document.
   * Every mustHave MUST appear in sectionMap if the map is provided.
   */
  sectionMap?: ReadonlyArray<SectionMapping>;
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
