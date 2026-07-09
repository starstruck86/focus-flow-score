/**
 * Strategy Skills — Phase 1 manifest types (additive, inert).
 *
 * A Skill is a declarative orchestration recipe. It does NOT contain
 * reasoning logic, prompt text, or library content. It binds a known
 * Strategy `behaviorIntent` to a known workspace SOP, declares a
 * dynamic library retrieval plan (never static IDs), and specifies
 * how output should be shaped and validated.
 *
 * Phase 1 is **inert**: no runtime code imports these manifests.
 * They are reachable only from tests in `src/lib/strategy-skills/_tests__/`.
 *
 * Hard rules enforced by the schema validator:
 *   • No static `resource_ids` / hardcoded library item references.
 *   • Retrieval is expressed as a query plan (terms, filters, scopes).
 *   • `behavior_intent` MUST be one of the existing Strategy intents.
 *   • `workspace` MUST be a known WorkspaceKey.
 *   • Each skill MUST declare a quality rubric.
 *   • Depth is one of quick | standard | deep | artifact.
 */

/** Mirrors existing Strategy behavior intents. Phase 1 is read-only. */
export type SkillBehaviorIntent =
  | 'conversation_strategy'
  | 'pov_synthesis'
  | 'research_brief'
  | 'idea_generation'
  | 'refine_message'
  | 'discovery_prep'
  | 'account_brief'
  | 'ninety_day_plan'
  | 'objection_handling'
  | 'stakeholder_map';

/** Mirrors WorkspaceKey from workspaceContractTypes.ts. */
export type SkillWorkspace =
  | 'brainstorm'
  | 'deep_research'
  | 'refine'
  | 'library'
  | 'artifacts'
  | 'projects'
  | 'work';

export type SkillDepth = 'quick' | 'standard' | 'deep' | 'artifact';

export type SkillSourceMode = 'library_first' | 'library_required' | 'library_relevant';

/**
 * Dynamic retrieval plan. Phase 1 forbids any static identifier list
 * (no `resource_ids`, no `playbook_ids`). Skills retrieve from the
 * library by SHAPE, not by ID, so they scale as the library grows.
 */
export interface SkillRetrievalPlan {
  /** Logical scopes the planner should query (KIs, playbooks, standards, exemplars). */
  scopes: ReadonlyArray<'knowledge_items' | 'playbooks' | 'standards' | 'exemplars' | 'patterns' | 'templates'>;
  /**
   * Term seeds expressed as input-binding expressions, e.g.
   * `"${inputs.industry}"`, `"${inputs.persona}"`, `"${inputs.methodology}"`.
   * The planner resolves them at runtime; manifests carry no literal
   * library content.
   */
  termBindings: ReadonlyArray<string>;
  /**
   * Static methodology terms always injected into retrieval alongside
   * resolved bindings. These are the skill's inherent domain vocabulary
   * (e.g. MEDDICC components for a MEDDICC review).
   */
  methodologySeeds?: ReadonlyArray<string>;
  /** Optional structural filters (knowledge_type, chapter, etc.). */
  filters?: Readonly<Record<string, string>>;
  /** Minimum number of relevant items before the skill should warn (not block) the user. */
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
  location: 'section' | 'embedded';
  /** Parent section id/name when location = "embedded". */
  parentSection?: string;
  /** Minimum word count for substance validation (default 40). */
  minWords?: number;
}

/** Quality rubric used by the post-generation auditor for this skill. */
export interface SkillQualityRubric {
  /** Required output qualities (POV-bearing, specific, usable, grounded). */
  mustHave: ReadonlyArray<string>;
  /** Patterns that mark the output as generic / failure. */
  genericMarkers: ReadonlyArray<string>;
  /** Maximum allowable generic-marker hits before audit downgrades. */
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
  /** Free-form prose vs. structured artifact. Phase 1 only declares it. */
  shape: 'prose' | 'list' | 'structured_artifact';
  /** Soft length budget (words). Auditor uses this as a hint, not a hard cap. */
  targetWords?: { min: number; max: number };
  /** Forbidden patterns at the surface (e.g. headings for conversation_strategy). */
  forbid?: ReadonlyArray<'headings' | 'bullets' | 'tables'>;
}

export interface SkillManifest {
  /** Stable slash-command id, e.g. "pov", "research". */
  id: string;
  /** Human label shown in the (future) picker. */
  label: string;
  /** One-line description of what the skill does. */
  description: string;
  /** Existing Strategy behavior intent this skill binds to. */
  behaviorIntent: SkillBehaviorIntent;
  /** Existing workspace SOP this skill activates. */
  workspace: SkillWorkspace;
  /** Default depth posture for the skill. */
  depth: SkillDepth;
  /** Library posture — never disables the library, only how aggressively it leads. */
  sourceMode: SkillSourceMode;
  /** Dynamic retrieval plan (no static IDs). */
  retrieval: SkillRetrievalPlan;
  /** Output shape contract. */
  output: SkillOutputContract;
  /** Quality rubric for the post-generation auditor. */
  rubric: SkillQualityRubric;
  /** Manifest schema version. Phase 1 = "1". */
  version: '1';
}
