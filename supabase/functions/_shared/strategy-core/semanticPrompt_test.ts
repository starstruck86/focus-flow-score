import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  detectRequestedEntryCount,
  renderConversationEnforcementBlock,
} from "./outputMode.ts";
import {
  composePrompt,
  FIXED_INSTRUCTION_BUDGET_CHARS,
  type PromptSegment,
} from "./promptComposition.ts";
import {
  buildCompactWorkspaceDelta,
  buildConsolidatedCoreInvariants,
  buildCurrentStateReasoningPolicy,
  buildResolvedTurnContract,
  buildResourceGroundingPolicy,
  buildSemanticPromptSegments,
  buildThesisContinuityPolicy,
  buildV2ReasoningDelta,
  buildV2StrongSynthesisTail,
  type SemanticChatIntent,
  type SemanticLibraryMode,
  type SemanticV2Decision,
  THESIS_PERSISTENCE_CONTRACT,
} from "./semanticPrompt.ts";
import { WORKSPACE_CONTRACTS } from "./workspaceContracts.ts";
import type { WorkspaceContract } from "./workspaceContractTypes.ts";

const INTENTS: SemanticChatIntent[] = [
  "bootstrap",
  "synthesis",
  "creation",
  "evaluation",
  "template",
  "email",
  "message",
  "pitch",
  "next_steps",
  "analysis",
  "account_brief",
  "ninety_day_plan",
  "provenance",
  "freeform",
];
const DEPTHS = ["Fast", "Standard", "Deep"];
const LIBRARY_MODES: SemanticLibraryMode[] = [
  "strong",
  "partial",
  "general",
  "thin",
  "short_form",
];
const SHORT_FORM_KINDS = [
  "subject_lines",
  "opener",
  "hook_lines",
  "voicemail",
  "talk_track_snippet",
  "one_liner",
];
const V2_ROUTES: Array<SemanticV2Decision | null> = [
  null,
  { mode: "A_strong", askShape: "synthesis_framework" },
  { mode: "B_partial", askShape: "synthesis_framework" },
  { mode: "C_general", askShape: "general" },
  { mode: "D_thin", askShape: "account_brief" },
  { mode: "A_strong", askShape: "ninety_day_plan" },
  { mode: "B_partial", askShape: "rewrite_audience" },
  { mode: "A_strong", askShape: "evaluation_grading" },
  { mode: "C_general", askShape: "short_form" },
];

const BEHAVIOR = {
  intent: "conversation_strategy" as const,
  suppressed: [],
  matched_signal: "test",
  confidence: "high" as const,
};
const BEHAVIORS = [
  BEHAVIOR,
  {
    intent: "idea_generation" as const,
    suppressed: [],
    matched_signal: "test",
    confidence: "high" as const,
  },
  {
    intent: "research_analysis" as const,
    suppressed: [],
    matched_signal: "test",
    confidence: "high" as const,
  },
  {
    intent: "artifact_creation" as const,
    suppressed: [],
    matched_signal: "test",
    confidence: "high" as const,
  },
];
const OUTPUT = {
  mode: "conversation" as const,
  reason: "test",
  workspace_default_mode: "conversation" as const,
  explicit_format_override: "brief" as const,
  conversation_trigger_matched: "test",
};
const MAX_RESOURCE_POLICY = {
  hasHits: true,
  userAskedForResource: true,
  hasPicked: true,
  hasStructuredPicked: true,
  hasUnstructuredPicked: true,
  hasEmptyPicked: true,
};

function buildWorstCase(args: {
  contract: WorkspaceContract;
  intent: SemanticChatIntent;
  depth: string;
  libraryMode: SemanticLibraryMode;
  shortFormKind?: string | null;
  v2Decision?: SemanticV2Decision | null;
  outputMode?: "conversation" | "structured" | "preserve" | "adaptive";
  behaviorIntent?: (typeof BEHAVIORS)[number];
}): ReturnType<typeof composePrompt> {
  const base: PromptSegment[] = [
    {
      id: "fixed.core-invariants",
      kind: "fixed_instruction",
      text: buildConsolidatedCoreInvariants({
        depth: args.depth,
        strategyContext: true,
      }),
    },
    {
      id: "fixed.workspace-delta",
      kind: "fixed_instruction",
      text: buildCompactWorkspaceDelta(args.contract),
    },
    {
      id: "evidence.core.account",
      kind: "retrieved_evidence",
      text: "Account data can grow without affecting the fixed budget.",
    },
  ];
  const segments = buildSemanticPromptSegments({
    territoryEvidence: "Territory data",
    baseSegments: base,
    globalSopBlock:
      "━━━ GLOBAL STRATEGY SOP (OPERATING STANDARD) ━━━\nUser SOP",
    workspaceSopBlock: "━━━ WORKSPACE SOP (WORK MODE) ━━━\nWorkspace SOP",
    intent: {
      intent: args.intent,
      sentenceCap: 3,
      isBusinessCase: true,
      isCFO: true,
      subIntent: args.intent === "message" ? "rewrite_audience" : undefined,
    },
    behaviorIntent: args.behaviorIntent ?? BEHAVIOR,
    outputModeDecision: {
      ...OUTPUT,
      mode: args.outputMode ?? OUTPUT.mode,
    },
    workspaceContract: args.contract,
    libraryMode: args.libraryMode,
    shortFormKind: args.shortFormKind,
    v2Decision: args.v2Decision,
    forceLiteralCitations: true,
    resourceGrounding: MAX_RESOURCE_POLICY,
    hasDossierEvidence: true,
    hasCurrentStateEvidence: true,
    hasWorkingThesis: true,
    persistThesis: true,
  });
  const beforeSop = segments.findIndex(
    (segment) => segment.id === "runtime.global-sop",
  );
  segments.splice(beforeSop, 0, {
    id: "evidence.standards",
    kind: "retrieved_evidence",
    text: "Standard exemplar data",
  });
  segments.push({
    id: "runtime.global-instructions",
    kind: "runtime_instruction",
    text: "Persistent user formatting preference",
  });

  const tail = buildV2StrongSynthesisTail({
    decision: args.v2Decision,
    totalHits: 3,
  });
  if (tail) {
    segments.push({
      id: "fixed.v2-strong-synthesis-final",
      kind: "fixed_instruction",
      text: tail,
    });
  } else if (
    (args.outputMode ?? OUTPUT.mode) === "conversation" &&
    args.intent === "freeform"
  ) {
    segments.push({
      id: "fixed.conversation-enforcement-final",
      kind: "fixed_instruction",
      text: renderConversationEnforcementBlock(args.contract.workspace, {
        currentStateUsed: true,
        behaviorIntent: (args.behaviorIntent ?? BEHAVIOR).intent,
      }),
    });
  }
  return composePrompt(segments);
}

Deno.test("semantic prompt: exhaustive fixed-instruction matrix stays within 20k", () => {
  let maximum = 0;
  let maximumCase = "";
  let maximumSegments: Array<{ id: string; chars: number }> = [];
  for (const contract of Object.values(WORKSPACE_CONTRACTS)) {
    for (const intent of INTENTS) {
      for (const depth of DEPTHS) {
        for (const libraryMode of LIBRARY_MODES) {
          const kinds = libraryMode === "short_form"
            ? SHORT_FORM_KINDS
            : [null];
          for (const shortFormKind of kinds) {
            for (const v2Decision of V2_ROUTES) {
              for (
                const outputMode of [
                  "conversation",
                  "structured",
                  "preserve",
                  "adaptive",
                ] as const
              ) {
                for (const behaviorIntent of BEHAVIORS) {
                  const plan = buildWorstCase({
                    contract,
                    intent,
                    depth,
                    libraryMode,
                    shortFormKind,
                    v2Decision,
                    outputMode,
                    behaviorIntent,
                  });
                  if (plan.fixedInstructionChars > maximum) {
                    maximum = plan.fixedInstructionChars;
                    maximumCase = [
                      contract.workspace,
                      intent,
                      depth,
                      libraryMode,
                      shortFormKind,
                      v2Decision?.mode,
                      v2Decision?.askShape,
                      outputMode,
                      behaviorIntent.intent,
                    ].join("/");
                    maximumSegments = plan.segments
                      .filter((segment) => segment.kind === "fixed_instruction")
                      .map((segment) => ({
                        id: segment.id,
                        chars: segment.text.length,
                      }));
                  }
                  assert(
                    plan.fixedInstructionChars <=
                      FIXED_INSTRUCTION_BUDGET_CHARS,
                    `${maximumCase} exceeded budget: ${plan.fixedInstructionChars}`,
                  );
                }
              }
            }
          }
        }
      }
    }
  }
  // Keep meaningful headroom for future gated Competitive/Industry policies.
  assert(
    maximum <= 17_500,
    `semantic shell lost its safety margin: ${maximum} (${maximumCase}) ${
      JSON.stringify(maximumSegments)
    }`,
  );
});

Deno.test("semantic prompt: every V2 route and output mode is budget-safe", () => {
  const contract = WORKSPACE_CONTRACTS.deep_research;
  for (const v2Decision of V2_ROUTES) {
    for (
      const outputMode of [
        "conversation",
        "structured",
        "preserve",
        "adaptive",
      ] as const
    ) {
      const base = buildWorstCase({
        contract,
        intent: v2Decision?.askShape === "synthesis_framework"
          ? "synthesis"
          : "freeform",
        depth: "Deep",
        libraryMode: "partial",
        v2Decision,
        outputMode,
      });
      assert(base.fixedInstructionChars <= FIXED_INSTRUCTION_BUDGET_CHARS);
    }
  }
});

Deno.test("semantic prompt: SOP order is segment-based and finals stay last", () => {
  const regular = buildWorstCase({
    contract: WORKSPACE_CONTRACTS.work,
    intent: "freeform",
    depth: "Standard",
    libraryMode: "general",
    v2Decision: null,
  });
  const ids = regular.segments.map((segment) => segment.id);
  assert(
    ids.indexOf("evidence.standards") < ids.indexOf("runtime.global-sop"),
  );
  assert(
    ids.indexOf("runtime.global-sop") < ids.indexOf("runtime.workspace-sop"),
  );
  assert(
    ids.indexOf("runtime.workspace-sop") < ids.indexOf("fixed.turn-contract"),
  );
  assertEquals(ids.at(-1), "fixed.conversation-enforcement-final");

  const synthesis = buildWorstCase({
    contract: WORKSPACE_CONTRACTS.library,
    intent: "synthesis",
    depth: "Deep",
    libraryMode: "strong",
    v2Decision: { mode: "A_strong", askShape: "synthesis_framework" },
  });
  assertEquals(
    synthesis.segments.at(-1)?.id,
    "fixed.v2-strong-synthesis-final",
  );
});

Deno.test("semantic prompt: V2 synthesis sentinel markers remain intact", () => {
  const tail = buildV2StrongSynthesisTail({
    decision: { mode: "B_partial", askShape: "synthesis_framework" },
    totalHits: 3,
  });
  for (
    const marker of [
      "OPEN WITH POV",
      "UNEQUAL WEIGHTING",
      "CITE LITERAL TITLES INLINE",
      "WHAT'S OVERRATED",
      "COMMERCIAL CONSEQUENCE",
      "EXECUTABLE NEXT MOVES",
    ]
  ) {
    assertStringIncludes(tail, marker);
  }
  assertEquals(
    buildV2StrongSynthesisTail({
      decision: { mode: "B_partial", askShape: "synthesis_framework" },
      totalHits: 2,
    }),
    "",
  );
});

Deno.test("semantic prompt: distinct legacy rules have one executable destination", () => {
  const turn = (intent: SemanticChatIntent, libraryMode: SemanticLibraryMode) =>
    buildResolvedTurnContract({
      intent: { intent },
      behaviorIntent: BEHAVIOR,
      outputModeDecision: OUTPUT,
      libraryMode,
      v2Decision: intent === "synthesis"
        ? { mode: "A_strong", askShape: "synthesis_framework" }
        : null,
    });

  const synthesis = turn("synthesis", "partial");
  assertStringIncludes(synthesis, "at least two actual sources per pattern");
  assertStringIncludes(synthesis, "Mark each major section **Grounded**");
  const evaluation = turn("evaluation", "strong");
  assertStringIncludes(evaluation, "Use three to six dimensions");
  const shortForm = buildResolvedTurnContract({
    intent: { intent: "freeform" },
    behaviorIntent: BEHAVIOR,
    outputModeDecision: OUTPUT,
    libraryMode: "short_form",
    shortFormKind: "opener",
  });
  assertStringIncludes(
    shortForm,
    "prefix that option [Grounded] or [Extended]",
  );

  const accountBrief = turn("account_brief", "strong");
  assertStringIncludes(accountBrief, "likely buying motion");
  assertStringIncludes(accountBrief, "angles to skip");
  assertStringIncludes(
    accountBrief,
    "When any named contact is on file, at least one move must use one from Stakeholders",
  );
  assertStringIncludes(
    accountBrief,
    "put material library-derived claims only in Next Moves and cite them there",
  );
  const ninety = turn("ninety_day_plan", "strong");
  assertStringIncludes(ninety, "70% of territory/account time");
  assertStringIncludes(ninety, "weekly pipeline target");
  assertStringIncludes(
    ninety,
    "put material library-derived claims only in Engage/Advance and cite them there",
  );

  const creation = turn("creation", "strong");
  assertStringIncludes(
    creation,
    'otherwise write "None." without narrating retrieval',
  );
  assertStringIncludes(creation, "Every Reused line cites its actual source");
  assertStringIncludes(
    creation,
    "every line without an actual source belongs under Created",
  );
  assertStringIncludes(
    creation,
    "mark every line in Reused vs Created as **Created (extended)**",
  );

  const evaluated = turn("evaluation", "strong");
  assertStringIncludes(
    evaluated,
    "exactly the highest-leverage one to three fixes, numbered in priority order",
  );

  const currentState = buildCurrentStateReasoningPolicy(true);
  assertStringIncludes(currentState, "never skip/reorder");
  assertStringIncludes(currentState, "Rewrite once unless all five pass");

  const artifactTurn = buildResolvedTurnContract({
    intent: { intent: "freeform" },
    behaviorIntent: {
      intent: "artifact_creation",
      suppressed: [],
      matched_signal: "proposal",
      confidence: "high",
    },
    outputModeDecision: OUTPUT,
    libraryMode: "general",
  });
  assertStringIncludes(artifactTurn, "Artifact behavior wins");
  assert(!artifactTurn.includes("Use conversational prose"));

  const v2 = buildV2ReasoningDelta({
    mode: "A_strong",
    askShape: "account_brief",
  });
  assertStringIncludes(
    v2,
    "*Extended beyond your library on: [specific topic]. Add a resource on this to ground next time.*",
  );
  for (const mode of ["B_partial", "D_thin"] as const) {
    const shortV2 = buildV2ReasoningDelta({ mode, askShape: "short_form" });
    assertStringIncludes(shortV2, "Short-form adds no extension marker");
    assert(!shortV2.includes("Extended beyond your library"));
    assert(!shortV2.includes("limited library signal"));
  }

  const brainstorm = buildCompactWorkspaceDelta(
    WORKSPACE_CONTRACTS.brainstorm,
  );
  assertStringIncludes(
    brainstorm,
    "at least one genuinely distinct option per relevant dimension",
  );
  assertStringIncludes(brainstorm, "picked option → Refine");
  const research = buildCompactWorkspaceDelta(
    WORKSPACE_CONTRACTS.deep_research,
  );
  assertStringIncludes(research, "three to six needed subquestions");
  assertStringIncludes(research, "best available source class");

  const picked = buildResourceGroundingPolicy({
    hasHits: true,
    userAskedForResource: true,
    hasPicked: true,
    hasStructuredPicked: true,
    hasUnstructuredPicked: false,
    hasEmptyPicked: false,
  });
  assertStringIncludes(
    picked,
    "otherwise ground silently inside the locked asset",
  );
  assertStringIncludes(
    buildThesisContinuityPolicy(true),
    "only when Turn permits commentary",
  );
  assertStringIncludes(THESIS_PERSISTENCE_CONTRACT, "server-stripped metadata");
});

Deno.test("conversation final reconciles path count by behavior without embedding evidence", () => {
  const strategy = renderConversationEnforcementBlock("work", {
    currentStateUsed: true,
    currentStateDigest: "SECRET_DYNAMIC_EVIDENCE",
    behaviorIntent: "conversation_strategy",
  });
  assertStringIncludes(strategy, "one primary path");
  assertStringIncludes(strategy, "at most one materially different backup");
  assert(!strategy.includes("SECRET_DYNAMIC_EVIDENCE"));

  const brainstorm = renderConversationEnforcementBlock("brainstorm", {
    currentStateUsed: false,
    behaviorIntent: "idea_generation",
  });
  assertStringIncludes(brainstorm, "at least five genuinely distinct");
  assertStringIncludes(
    brainstorm,
    "Each entry needs a genuinely different angle",
  );
  assert(!brainstorm.includes("Each path weaves together"));

  const research = renderConversationEnforcementBlock("deep_research", {
    behaviorIntent: "research_analysis",
  });
  assertStringIncludes(research, "verified fact or labeled inference");
  assertStringIncludes(research, "not a coaching script");

  const explicit = detectRequestedEntryCount(
    "Generate 8 expansion angles for Peacock",
  );
  assertEquals(explicit, 8);
  assertStringIncludes(
    renderConversationEnforcementBlock("brainstorm", {
      behaviorIntent: "conversation_strategy",
      requestedEntryCount: explicit,
    }),
    "Return exactly 8 distinct conversational entries",
  );
});
