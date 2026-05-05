/**
 * Phase 3.5D — Task-to-Manifest Mapping.
 *
 * Maps each TaskType to its corresponding SkillManifest so the
 * universal planner (buildPlan) governs ALL task retrieval.
 *
 * NO skill-specific branching. NO duplicate retrieval logic.
 * The planner is the single source of truth.
 */
import type { TaskType } from "./types.ts";
import type { SkillManifest } from "../strategy-skills/types.ts";
import {
  discoveryPrepManifest,
  executiveBriefManifest,
  meddiccReviewManifest,
} from "../strategy-skills/manifests.ts";
import type { ArtifactManifest } from "./artifactGateEnforcement.ts";

/**
 * Task-type → SkillManifest. Universal mapping.
 * account_brief uses executiveBriefManifest (closest behavioral match).
 * ninety_day_plan uses a synthetic manifest defined below.
 */

/** ninety_day_plan doesn't have a skill manifest yet — create a minimal one. */
const ninetyDayPlanManifest: SkillManifest = {
  id: "ninety-day-plan",
  label: "90-Day Plan",
  description: "Structured 90-day account or territory plan.",
  behaviorIntent: "ninety_day_plan",
  workspace: "artifacts",
  depth: "artifact",
  sourceMode: "library_required",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "standards", "exemplars"],
    termBindings: [
      "${inputs.company_name}",
      "${inputs.opportunity}",
      "${inputs.stage}",
      "${inputs.desired_next_step}",
    ],
    methodologySeeds: [
      "90 day plan", "territory plan", "milestone planning",
      "stakeholder strategy", "ramp", "land", "expand",
      "account planning", "executive engagement",
    ],
    minRelevantItems: 3,
  },
  output: { shape: "structured_artifact" },
  rubric: {
    mustHave: [
      "milestones", "stakeholder strategy", "risks",
      "metrics", "executive alignment", "expansion triggers",
    ],
    genericMarkers: ["build relationships", "drive value"],
    maxGenericMarkers: 1,
  },
  version: "1",
};

// Ensure discoveryPrepManifest and executiveBriefManifest have methodologySeeds
// by creating extended versions if they don't already.
const enrichedDiscoveryPrepManifest: SkillManifest = {
  ...discoveryPrepManifest,
  retrieval: {
    ...discoveryPrepManifest.retrieval,
    methodologySeeds: discoveryPrepManifest.retrieval.methodologySeeds ?? [
      "discovery", "discovery questions", "qualification", "MEDDICC",
      "hypothesis", "value selling", "executive framing",
      "objection handling", "competitive", "pain mapping",
      "champion", "deal progression", "lifecycle",
      "ROI", "business case", "next step", "exit criteria",
    ],
  },
};

const enrichedAccountBriefManifest: SkillManifest = {
  ...executiveBriefManifest,
  retrieval: {
    ...executiveBriefManifest.retrieval,
    methodologySeeds: executiveBriefManifest.retrieval.methodologySeeds ?? [
      "account planning", "account brief", "stakeholder map",
      "buying committee", "executive buyer", "executive engagement",
      "deal strategy", "expansion", "competitive positioning",
    ],
  },
};

const TASK_MANIFEST_MAP: Readonly<Record<TaskType, SkillManifest>> = {
  discovery_prep: enrichedDiscoveryPrepManifest,
  account_brief: enrichedAccountBriefManifest,
  ninety_day_plan: ninetyDayPlanManifest,
};

/**
 * Returns the SkillManifest for a given task type.
 * Universal — no skill-specific branching.
 */
export function getTaskManifest(taskType: TaskType): SkillManifest {
  const m = TASK_MANIFEST_MAP[taskType];
  if (!m) throw new Error(`No manifest for task_type: ${taskType}`);
  return m;
}

/**
 * Returns an ArtifactManifest shape from a SkillManifest
 * (the subset needed by runArtifactGate).
 */
export function toArtifactManifest(manifest: SkillManifest): ArtifactManifest {
  return {
    rubric: { mustHave: manifest.rubric.mustHave },
    output: {
      shape: manifest.output.shape,
      forbid: manifest.output.forbid,
    },
  };
}
