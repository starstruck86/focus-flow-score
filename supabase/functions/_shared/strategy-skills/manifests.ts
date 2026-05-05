/**
 * Server-side mirror of the frontend skill manifests.
 *
 * The frontend manifests in `src/lib/strategy-skills/manifests/*` are
 * the authoring surface; this file MUST stay byte-equivalent (after
 * trivial syntactic differences) to those files. A cross-runtime test
 * asserts structural parity.
 */
import type { SkillManifest } from "./types.ts";

export const conversationPovManifest: SkillManifest = {
  id: "conversation-pov",
  label: "Conversation POV",
  description: "Compressed, POV-bearing prep for an upcoming live conversation.",
  behaviorIntent: "conversation_strategy",
  workspace: "work",
  depth: "standard",
  sourceMode: "library_first",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "standards"],
    termBindings: ["${inputs.account}", "${inputs.persona}", "${inputs.stage}", "${inputs.topic}"],
    minRelevantItems: 2,
  },
  output: {
    shape: "prose",
    targetWords: { min: 80, max: 220 },
    forbid: ["headings", "bullets"],
  },
  rubric: {
    mustHave: [
      "verified signals", "current state reasoning", "change vectors",
      "commercial insight", "strategic why", "friction",
    ],
    genericMarkers: ["build rapport", "understand their needs", "add value"],
    maxGenericMarkers: 1,
  },
  version: "1",
};

export const discoveryPrepManifest: SkillManifest = {
  id: "discovery-prep",
  label: "Discovery Prep",
  description: "Full discovery preparation artifact grounded in the library.",
  behaviorIntent: "discovery_prep",
  workspace: "artifacts",
  depth: "artifact",
  sourceMode: "library_required",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "standards", "exemplars"],
    termBindings: ["${inputs.account}", "${inputs.persona}", "${inputs.stage}", "${inputs.topic}"],
    minRelevantItems: 3,
  },
  output: { shape: "structured_artifact" },
  rubric: {
    mustHave: [
      "verified signals", "current state reasoning", "change vectors",
      "commercial insight", "strategic why", "friction", "cited sources",
    ],
    genericMarkers: ["build rapport", "understand their needs", "best practice"],
    maxGenericMarkers: 1,
  },
  version: "1",
};

export const commercialInsightManifest: SkillManifest = {
  id: "commercial-insight",
  label: "Commercial Insight",
  description: "Sharpen a single commercial insight with full reasoning, compressed delivery.",
  behaviorIntent: "pov_synthesis",
  workspace: "refine",
  depth: "standard",
  sourceMode: "library_first",
  retrieval: {
    scopes: ["knowledge_items", "standards", "exemplars"],
    termBindings: ["${inputs.topic}", "${inputs.industry}", "${inputs.persona}"],
    minRelevantItems: 2,
  },
  output: { shape: "prose", targetWords: { min: 60, max: 180 }, forbid: ["headings", "bullets"] },
  rubric: {
    mustHave: ["clear POV", "specific to inputs", "commercial insight", "usable verbatim"],
    genericMarkers: ["it depends", "best practice", "leverage synergies", "in today’s landscape"],
    maxGenericMarkers: 1,
  },
  version: "1",
};

export const accountResearchManifest: SkillManifest = {
  id: "account-research",
  label: "Account Research",
  description: "Deep, grounded research brief on an account or industry.",
  behaviorIntent: "research_brief",
  workspace: "deep_research",
  depth: "deep",
  sourceMode: "library_first",
  retrieval: {
    scopes: ["knowledge_items", "standards", "exemplars", "patterns"],
    termBindings: ["${inputs.account}", "${inputs.industry}", "${inputs.topic}"],
    minRelevantItems: 3,
  },
  output: { shape: "structured_artifact" },
  rubric: {
    mustHave: ["verified signals", "change vectors", "commercial insight", "cited sources"],
    genericMarkers: ["industry leader", "innovative solutions", "cutting-edge"],
    maxGenericMarkers: 1,
  },
  version: "1",
};

export const discoveryQuestionsManifest: SkillManifest = {
  id: "discovery-questions",
  label: "Discovery Question Builder",
  description: "Generate sharp, stage- and persona-fit discovery questions.",
  behaviorIntent: "idea_generation",
  workspace: "brainstorm",
  depth: "standard",
  sourceMode: "library_first",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "exemplars", "patterns"],
    termBindings: ["${inputs.persona}", "${inputs.stage}", "${inputs.topic}", "${inputs.industry}"],
    minRelevantItems: 2,
  },
  output: { shape: "list" },
  rubric: {
    mustHave: ["POV-bearing", "specific to inputs", "opens change vectors", "avoids yes/no"],
    genericMarkers: ["tell me about your business", "what keeps you up at night", "walk me through"],
    maxGenericMarkers: 1,
  },
  version: "1",
};

export const meddiccReviewManifest: SkillManifest = {
  id: "meddicc-review",
  label: "MEDDICC Deal Review",
  description: "Structured MEDDICC review of a deal grounded in library standards.",
  behaviorIntent: "account_brief",
  workspace: "artifacts",
  depth: "deep",
  sourceMode: "library_required",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "standards"],
    termBindings: ["${inputs.account}", "${inputs.opportunity}", "${inputs.stage}", "${inputs.persona}"],
    methodologySeeds: [
      "MEDDICC", "metrics", "economic buyer", "decision criteria",
      "decision process", "identified pain", "champion", "competition",
      "qualification", "deal review",
    ],
    minRelevantItems: 3,
  },
  output: { shape: "structured_artifact" },
  rubric: {
    mustHave: [
      "metrics", "economic buyer", "decision criteria", "decision process",
      "identified pain", "champion", "competition", "gaps named",
    ],
    genericMarkers: ["looks healthy", "no concerns", "on track"],
    maxGenericMarkers: 0,
  },
  version: "1",
};

export const demoStrategyManifest: SkillManifest = {
  id: "demo-strategy",
  label: "Demo Strategy",
  description: "Plan a tailored, POV-led demo for a specific persona and use case.",
  behaviorIntent: "conversation_strategy",
  workspace: "work",
  depth: "standard",
  sourceMode: "library_first",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "standards", "exemplars"],
    termBindings: ["${inputs.account}", "${inputs.persona}", "${inputs.use_case}", "${inputs.stage}"],
    minRelevantItems: 2,
  },
  output: { shape: "prose", targetWords: { min: 100, max: 260 }, forbid: ["headings"] },
  rubric: {
    mustHave: ["POV-led narrative", "persona-specific value", "change vectors", "proof moments", "commercial insight"],
    genericMarkers: ["standard demo", "show all features", "walk through the product"],
    maxGenericMarkers: 1,
  },
  version: "1",
};

export const followUpEmailManifest: SkillManifest = {
  id: "follow-up-email",
  label: "Follow-Up Email",
  description: "Sharp, send-ready follow-up email with POV and clear next step.",
  behaviorIntent: "refine_message",
  workspace: "refine",
  depth: "quick",
  sourceMode: "library_first",
  retrieval: {
    scopes: ["knowledge_items", "exemplars", "standards"],
    termBindings: ["${inputs.account}", "${inputs.persona}", "${inputs.topic}", "${inputs.stage}"],
    minRelevantItems: 1,
  },
  output: { shape: "prose", targetWords: { min: 60, max: 160 }, forbid: ["headings", "bullets"] },
  rubric: {
    mustHave: ["POV-bearing", "specific to call context", "clear next step", "usable verbatim"],
    genericMarkers: ["just checking in", "circling back", "thought I would follow up", "per our conversation"],
    maxGenericMarkers: 0,
  },
  version: "1",
};

export const objectionStrategyManifest: SkillManifest = {
  id: "objection-strategy",
  label: "Objection Strategy",
  description: "POV-led strategy for handling a specific objection in context.",
  behaviorIntent: "objection_handling",
  workspace: "work",
  depth: "standard",
  sourceMode: "library_first",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "standards", "exemplars"],
    termBindings: ["${inputs.objection}", "${inputs.persona}", "${inputs.stage}", "${inputs.account}"],
    minRelevantItems: 2,
  },
  output: { shape: "prose", targetWords: { min: 80, max: 200 }, forbid: ["headings", "bullets"] },
  rubric: {
    mustHave: ["root cause named", "reframe with POV", "evidence or proof", "next-step move"],
    genericMarkers: ["feel felt found", "i hear you", "great question"],
    maxGenericMarkers: 0,
  },
  version: "1",
};

export const executiveBriefManifest: SkillManifest = {
  id: "executive-brief",
  label: "Executive Brief",
  description: "Concise, executive-ready brief on an account or deal with POV and asks.",
  behaviorIntent: "account_brief",
  workspace: "artifacts",
  depth: "artifact",
  sourceMode: "library_required",
  retrieval: {
    scopes: ["knowledge_items", "playbooks", "standards"],
    termBindings: ["${inputs.account}", "${inputs.persona}", "${inputs.stage}", "${inputs.topic}"],
    minRelevantItems: 3,
  },
  output: { shape: "structured_artifact" },
  rubric: {
    mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"],
    genericMarkers: ["going well", "no major issues", "continued engagement"],
    maxGenericMarkers: 0,
  },
  version: "1",
};

export const SKILL_MANIFESTS: ReadonlyArray<SkillManifest> = Object.freeze([
  conversationPovManifest,
  discoveryPrepManifest,
  commercialInsightManifest,
  accountResearchManifest,
  discoveryQuestionsManifest,
  meddiccReviewManifest,
  demoStrategyManifest,
  followUpEmailManifest,
  objectionStrategyManifest,
  executiveBriefManifest,
]);

export const SKILL_REGISTRY: Readonly<Record<string, SkillManifest>> = Object.freeze(
  SKILL_MANIFESTS.reduce<Record<string, SkillManifest>>((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {}),
);
