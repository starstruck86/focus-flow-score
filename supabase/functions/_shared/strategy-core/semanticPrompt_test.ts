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
  buildEvidencePolicy,
  buildResolvedTurnContract,
  buildResourceGroundingPolicy,
  buildSemanticPromptSegments,
  buildThesisContinuityPolicy,
  buildV2ReasoningDelta,
  buildV2StrongSynthesisTail,
  renderLibraryDisclosureContract,
  resolveLibraryDisclosurePlan,
  type SemanticChatIntent,
  type SemanticLibraryMode,
  type SemanticV2Decision,
  THESIS_PERSISTENCE_CONTRACT,
} from "./semanticPrompt.ts";
import { STRICT_LIBRARY_CITATION_INSTRUCTION } from "./citationSyntax.ts";
import { WORKSPACE_CONTRACTS } from "./workspaceContracts.ts";
import type { WorkspaceContract } from "./workspaceContractTypes.ts";
import type { LibraryCoverageState } from "./retrievalEnforcement.ts";
import {
  type BehaviorIntentResult,
  classifyBehaviorIntent,
} from "./behaviorIntent.ts";

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
  behaviorIntent?: BehaviorIntentResult;
  libraryCoverageState?: LibraryCoverageState;
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
      text: buildCompactWorkspaceDelta(args.contract, {
        explicitOutputCount: args.behaviorIntent?.requested_count,
      }),
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
    libraryCoverageState: args.libraryCoverageState ??
      (args.contract.retrievalRules.libraryUse === "required" &&
          args.libraryMode === "thin"
        ? "required_missing"
        : args.libraryMode === "thin"
        ? "no_relevant_hits"
        : "used"),
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
                  assertEquals(
                    plan.segments.filter((segment) =>
                      segment.id === "fixed.library-disclosure"
                    ).length,
                    1,
                  );
                  const competingDisclosureText = plan.segments
                    .filter((segment) =>
                      segment.id !== "fixed.library-disclosure"
                    )
                    .map((segment) => segment.text)
                    .join("\n");
                  for (
                    const retiredCommand of [
                      "Open once with *Extended",
                      "Resources that would close this gap",
                      "With zero relevant hits, disclose once",
                      "Mark only a material extension beyond the evidence",
                    ]
                  ) {
                    assert(!competingDisclosureText.includes(retiredCommand));
                  }
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
  console.log(
    `[prompt-budget] maximum_fixed_instruction_chars=${maximum} case=${maximumCase}`,
  );
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
  assertStringIncludes(tail, "it alone owns namespace syntax");
  for (const competingSyntax of ["RESOURCE[", "KI[", "CARD[", "PLAYBOOK["]) {
    assert(!tail.includes(competingSyntax));
  }
});

Deno.test("semantic prompt: strict citation syntax has one canonical owner", () => {
  const policy = buildEvidencePolicy({
    rules: WORKSPACE_CONTRACTS.library.retrievalRules,
    mode: "strong",
    forceLiteralCitations: true,
  });
  assertStringIncludes(policy, STRICT_LIBRARY_CITATION_INSTRUCTION);
  for (const namespace of ["RESOURCE", "KI", "CARD", "PLAYBOOK"]) {
    assertStringIncludes(policy, `${namespace}["title"]`);
  }

  const tail = buildV2StrongSynthesisTail({
    decision: { mode: "A_strong", askShape: "synthesis_framework" },
    totalHits: 5,
  });
  assertStringIncludes(tail, "follow Evidence Policy");
  assert(!tail.includes('only listed RESOURCE["title"] or KI[id]'));

  const plan = buildWorstCase({
    contract: WORKSPACE_CONTRACTS.library,
    intent: "synthesis",
    depth: "Deep",
    libraryMode: "strong",
    v2Decision: { mode: "A_strong", askShape: "synthesis_framework" },
  });
  assertEquals(
    plan.segments
      .filter((segment) =>
        segment.kind === "fixed_instruction" &&
        /(?:RESOURCE|KI|CARD|PLAYBOOK)\[/.test(segment.text)
      )
      .map((segment) => segment.id),
    ["fixed.evidence-policy"],
  );
});

Deno.test("semantic prompt: source-derived facts require tags while unsourced prose stays clean", () => {
  const exactInstruction =
    `- Facts drawn from Retrieved Intelligence MUST carry a valid RESOURCE["title"], KI["title"], CARD["title"], or PLAYBOOK["title"] tag; no uncited source claims. Reasoning, opinion, and general knowledge stay untagged.`;
  for (
    const contract of [
      WORKSPACE_CONTRACTS.work,
      WORKSPACE_CONTRACTS.brainstorm,
      WORKSPACE_CONTRACTS.library,
    ]
  ) {
    const policy = buildEvidencePolicy({
      rules: contract.retrievalRules,
      mode: "general",
    });

    assertEquals(policy.split(exactInstruction).length - 1, 1);
  }

  assertEquals(
    WORKSPACE_CONTRACTS.work.retrievalRules.citationMode,
    "light",
  );
  assertEquals(
    WORKSPACE_CONTRACTS.brainstorm.retrievalRules.citationMode,
    "none_unless_library_used",
  );
});

Deno.test("semantic prompt: library disclosure resolves every collision to one outcome", () => {
  const plan = (
    overrides: Partial<Parameters<typeof resolveLibraryDisclosurePlan>[0]> = {},
  ) =>
    resolveLibraryDisclosurePlan({
      intent: "freeform",
      behaviorIntent: BEHAVIORS[2],
      outputModeDecision: { ...OUTPUT, mode: "structured" },
      rules: WORKSPACE_CONTRACTS.work.retrievalRules,
      coverageState: "used",
      mode: "general",
      v2Decision: null,
      ...overrides,
    });

  const libraryThin = plan({
    rules: WORKSPACE_CONTRACTS.library.retrievalRules,
    coverageState: "required_missing",
    mode: "thin",
    v2Decision: { mode: "D_thin", askShape: "account_brief" },
  });
  assertEquals(libraryThin, {
    kind: "library_required_gap",
    placement: "section",
    includeLibrarySummary: true,
    reason: "library_required",
  });
  const libraryText = renderLibraryDisclosureContract(libraryThin);
  assertEquals(libraryText.match(/## Sources used/g)?.length, 1);
  assertEquals(libraryText.match(/## Gaps/g)?.length, 1);
  assert(!libraryText.includes("Resources that would close this gap"));

  assertEquals(
    plan({
      rules: WORKSPACE_CONTRACTS.library.retrievalRules,
      coverageState: "required_missing",
      mode: "thin",
      outputModeDecision: { ...OUTPUT, mode: "conversation" },
      v2Decision: { mode: "D_thin", askShape: "account_brief" },
    }).placement,
    "inline",
  );
  assertEquals(
    plan({
      intent: "creation",
      rules: WORKSPACE_CONTRACTS.library.retrievalRules,
      coverageState: "required_missing",
      mode: "thin",
      v2Decision: { mode: "D_thin", askShape: "account_brief" },
    }).placement,
    "creation_gaps",
  );

  for (
    const [intent, placement] of [
      ["analysis", "analysis_thesis"],
      ["synthesis", "synthesis_attribution"],
      ["creation", "creation_gaps"],
      ["evaluation", "evaluation_attribution"],
    ] as const
  ) {
    const resolved = plan({
      intent,
      rules: WORKSPACE_CONTRACTS.library.retrievalRules,
      coverageState: "required_missing",
      mode: "general",
    });
    assertEquals(resolved.placement, placement);
    const rendered = renderLibraryDisclosureContract(resolved);
    assertStringIncludes(
      rendered,
      placement === "analysis_thesis"
        ? "Account thesis"
        : placement === "creation_gaps"
        ? "Gaps / Missing Anchors"
        : "Source Attribution",
    );
    assertStringIncludes(rendered, "including Application");
    assertStringIncludes(rendered, "selected outcome");
  }

  for (const mode of ["general", "partial"] as const) {
    assertEquals(
      plan({
        rules: WORKSPACE_CONTRACTS.library.retrievalRules,
        coverageState: "required_missing",
        mode,
      }).kind,
      "library_required_gap",
    );
  }
  assertEquals(
    plan({
      rules: WORKSPACE_CONTRACTS.library.retrievalRules,
      coverageState: "used",
      mode: "thin",
    }).kind,
    "library_summary",
  );

  for (
    const v2Decision of [
      { mode: "D_thin", askShape: "general" },
      { mode: "A_strong", askShape: "general" },
      { mode: "B_partial", askShape: "general" },
    ] as const
  ) {
    const rendered = renderLibraryDisclosureContract(plan({
      rules: WORKSPACE_CONTRACTS.library.retrievalRules,
      coverageState: "used",
      mode: v2Decision.mode === "D_thin" ? "thin" : "partial",
      v2Decision,
    }));
    assertEquals(rendered.match(/## Sources used/g)?.length, 1);
    assertEquals(rendered.match(/## Gaps/g)?.length, 1);
    assert(!rendered.includes("Open once with *Extended"));
  }

  for (const outputMode of ["structured", "adaptive"] as const) {
    assertEquals(
      plan({
        rules: WORKSPACE_CONTRACTS.library.retrievalRules,
        coverageState: "required_missing",
        mode: "general",
        outputModeDecision: { ...OUTPUT, mode: outputMode },
        behaviorIntent: BEHAVIORS[0],
      }).placement,
      "inline",
    );
  }

  assertEquals(
    plan({
      rules: WORKSPACE_CONTRACTS.library.retrievalRules,
      coverageState: "required_missing",
      mode: "general",
      behaviorIntent: BEHAVIORS[3],
    }).reason,
    "closed_turn",
  );

  for (
    const intent of [
      "bootstrap",
      "template",
      "email",
      "message",
      "pitch",
      "account_brief",
      "ninety_day_plan",
      "next_steps",
      "provenance",
    ] as const
  ) {
    assertEquals(
      plan({
        intent,
        rules: WORKSPACE_CONTRACTS.library.retrievalRules,
        coverageState: "required_missing",
        mode: "thin",
        v2Decision: { mode: "D_thin", askShape: "account_brief" },
      }).reason,
      "closed_turn",
    );
  }

  for (
    const shortPlan of [
      plan({
        rules: WORKSPACE_CONTRACTS.library.retrievalRules,
        coverageState: "required_missing",
        mode: "short_form",
      }),
      plan({
        rules: WORKSPACE_CONTRACTS.library.retrievalRules,
        coverageState: "required_missing",
        mode: "thin",
        v2Decision: { mode: "D_thin", askShape: "short_form" },
      }),
    ]
  ) {
    assertEquals(shortPlan.reason, "short_form");
    assertEquals(shortPlan.kind, "none");
  }

  const v2Thin = plan({
    mode: "thin",
    v2Decision: { mode: "D_thin", askShape: "account_brief" },
  });
  assertEquals(v2Thin.kind, "v2_thin_notice");
  const v2ThinText = renderLibraryDisclosureContract(v2Thin);
  assertEquals(
    v2ThinText.match(/Extended — limited library signal/g)?.length,
    1,
  );
  assert(!v2ThinText.includes("Resources that would close this gap"));

  for (
    const extensionPlan of [
      plan({
        mode: "strong",
        v2Decision: { mode: "A_strong", askShape: "general" },
      }),
      plan({
        mode: "partial",
        v2Decision: { mode: "B_partial", askShape: "general" },
      }),
      plan({ mode: "partial", v2Decision: null }),
    ]
  ) {
    assertEquals(extensionPlan.kind, "material_extension");
  }
  assertEquals(plan({ mode: "thin" }).reason, "ordinary_thin");
});

Deno.test("semantic prompt: every closed asset suppresses visible library disclosure", () => {
  for (
    const intent of [
      "bootstrap",
      "template",
      "email",
      "message",
      "pitch",
      "account_brief",
      "ninety_day_plan",
      "next_steps",
      "provenance",
    ] as const
  ) {
    const prompt = buildWorstCase({
      contract: WORKSPACE_CONTRACTS.library,
      intent,
      depth: "Deep",
      libraryMode: "thin",
      libraryCoverageState: "required_missing",
      v2Decision: { mode: "D_thin", askShape: "account_brief" },
      outputMode: "structured",
    });
    const disclosure = prompt.segments.find((segment) =>
      segment.id === "fixed.library-disclosure"
    );
    assertStringIncludes(disclosure?.text ?? "", "Outcome: NONE (closed_turn)");
    assert(!prompt.systemPrompt.includes("Extended — limited library signal"));
    assert(!prompt.systemPrompt.includes("Extended beyond your library"));
    assert(!prompt.systemPrompt.includes("I don't see that exact resource"));
    assert(!prompt.systemPrompt.includes("body is not loaded"));
    assert(!prompt.systemPrompt.includes("name one gap"));
    assertStringIncludes(
      prompt.systemPrompt,
      "Closed/short Turn owns visible shape",
    );
  }
});

Deno.test("semantic prompt: Library plus V2 thin emits one disclosure segment", () => {
  const prompt = buildWorstCase({
    contract: WORKSPACE_CONTRACTS.library,
    intent: "freeform",
    depth: "Standard",
    libraryMode: "thin",
    v2Decision: { mode: "D_thin", askShape: "account_brief" },
    outputMode: "structured",
    behaviorIntent: BEHAVIORS[2],
  });
  assertEquals(
    prompt.segments.filter((segment) =>
      segment.id === "fixed.library-disclosure"
    ).length,
    1,
  );
  assertEquals(prompt.systemPrompt.match(/## Gaps/g)?.length, 1);
  assertEquals(prompt.systemPrompt.match(/## Sources used/g)?.length, 1);
  assert(!prompt.systemPrompt.includes("Open once with *Extended"));
  assert(!prompt.systemPrompt.includes("Resources that would close this gap"));
  assert(
    !prompt.systemPrompt.includes("With zero relevant hits, disclose once"),
  );
});

Deno.test("semantic prompt: required Library folds resource absence into its sole disclosure", () => {
  const prompt = buildWorstCase({
    contract: WORKSPACE_CONTRACTS.library,
    intent: "freeform",
    depth: "Deep",
    libraryMode: "thin",
    libraryCoverageState: "required_missing",
    v2Decision: null,
    outputMode: "structured",
    behaviorIntent: BEHAVIORS[2],
  });
  const resource =
    prompt.segments.find((segment) => segment.id === "fixed.resource-grounding")
      ?.text ?? "";
  assertStringIncludes(
    resource,
    "Library Disclosure's selected location",
  );
  for (
    const competingCommand of [
      'open "Using <exact title>',
      "name one gap",
      "say the body is not loaded",
      "I don't see that exact resource",
      "ask at most one useful refinement",
    ]
  ) {
    assert(!resource.includes(competingCommand), competingCommand);
  }
  assertEquals(prompt.systemPrompt.match(/## Sources used/g)?.length, 1);
  assertEquals(prompt.systemPrompt.match(/## Gaps/g)?.length, 1);
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
  const synthesisSections = [
    "**1. Pattern Extraction**",
    "**2. <Artifact Name> — Dimensions**",
    "**3. Weighting Rationale**",
    "**4. Example Scoring**",
    "**5. Source Attribution**",
  ];
  for (let index = 1; index < synthesisSections.length; index++) {
    assert(
      synthesis.indexOf(synthesisSections[index - 1]) <
        synthesis.indexOf(synthesisSections[index]),
    );
  }
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
  assert(
    evaluated.indexOf("**4. Improvements (Grounded)**") <
      evaluated.indexOf("**5. Optional Rewrite**"),
  );
  assert(
    evaluated.indexOf("**5. Optional Rewrite**") <
      evaluated.indexOf("**6. Source Attribution**"),
  );
  assert(
    evaluated.indexOf("**6. Source Attribution**") <
      evaluated.indexOf("═══ APPLICATION ═══"),
  );

  const currentState = buildCurrentStateReasoningPolicy(true);
  assertStringIncludes(currentState, "never skip/reorder");
  assertStringIncludes(currentState, "Rewrite once unless all five pass");
  assertStringIncludes(
    buildConsolidatedCoreInvariants({
      depth: "Standard",
      strategyContext: true,
    }),
    "Territory Profile—not fixed identity—owns current role/company/quota/account count/motion/team/dates",
  );

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
    "Library Disclosure alone owns coverage/gap/extension wording",
  );
  for (const mode of ["B_partial", "D_thin"] as const) {
    const shortV2 = buildV2ReasoningDelta({ mode, askShape: "short_form" });
    assertStringIncludes(shortV2, "Library Disclosure alone owns");
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
  for (
    const [text, expected] of [
      ["Give me 4 conversation paths", 4],
      ["Write four scripts", 4],
      ["Draft 6 messages", 6],
      ["Create three talk tracks", 3],
      ["Return 5 versions", 5],
    ] as const
  ) {
    assertEquals(detectRequestedEntryCount(text), expected, text);
  }
  assertEquals(detectRequestedEntryCount("Give me 21 options"), null);
  assertEquals(detectRequestedEntryCount("Give me thirteen options"), null);
  for (
    const factual of [
      "We sent 4 messages yesterday—what should I do next?",
      "The buyer reviewed 4 scripts",
      "I have 4 options already; choose one",
    ]
  ) {
    assertEquals(detectRequestedEntryCount(factual), null, factual);
  }
});

Deno.test("explicit counted output replaces behavior defaults in the Turn contract", () => {
  for (const text of ["give me 4 scripts", "4 messages", "4 paths"]) {
    const behaviorIntent = classifyBehaviorIntent(text, {
      hasAccountContext: true,
    });
    const turn = buildResolvedTurnContract({
      intent: { intent: "freeform" },
      behaviorIntent,
      outputModeDecision: OUTPUT,
      libraryMode: "general",
    });
    assertStringIncludes(turn, "exactly 4", text);
    assert(!turn.includes("at most one materially different backup"), text);
    assert(!turn.includes("Generate multiple genuinely distinct"), text);
  }
});

Deno.test("explicit output count survives creation and short-form intent routes", () => {
  for (
    const text of [
      "Write 4 cold call scripts",
      "Give me 4 outreach messages",
    ]
  ) {
    const behaviorIntent = classifyBehaviorIntent(text, {
      hasAccountContext: true,
    });
    const creationTurn = buildResolvedTurnContract({
      intent: { intent: "creation" },
      behaviorIntent,
      outputModeDecision: OUTPUT,
      libraryMode: "general",
    });
    assertStringIncludes(creationTurn, "exactly 4", text);
    assertStringIncludes(creationTurn, "═══ APPLICATION ═══", text);
    assertStringIncludes(
      creationTurn,
      "Non-counted sections required by the resolved asset contract remain allowed.",
      text,
    );
    assert(!creationTurn.includes("appendix item beyond"), text);
    assert(
      !creationTurn.includes("at most one materially different backup"),
      text,
    );
    assert(
      !creationTurn.includes("Generate multiple genuinely distinct"),
      text,
    );
  }

  const countedTalkTracks = classifyBehaviorIntent(
    "Write 4 talk-track scripts",
    { hasAccountContext: true },
  );
  const shortTurn = buildResolvedTurnContract({
    intent: { intent: "message" },
    behaviorIntent: countedTalkTracks,
    outputModeDecision: OUTPUT,
    libraryMode: "short_form",
    shortFormKind: "talk_track_snippet",
  });
  assertStringIncludes(shortTurn, "exactly 4");
  assert(!shortTurn.includes("2–3 numbered"));
  assert(!shortTurn.includes("3–5 numbered"));
});

Deno.test("assembled counted brainstorm prompt omits competing quantity defaults", () => {
  const countedBehavior = classifyBehaviorIntent(
    "Give me 4 paths and recommend one",
    { hasAccountContext: true },
  );
  const prompt = buildWorstCase({
    contract: WORKSPACE_CONTRACTS.brainstorm,
    intent: "freeform",
    depth: "Standard",
    libraryMode: "general",
    outputMode: "conversation",
    behaviorIntent: countedBehavior,
  });
  assertStringIncludes(prompt.systemPrompt, "exactly 4");
  assert(!prompt.systemPrompt.includes("at least five numbered options"));
  assert(
    !prompt.systemPrompt.includes("at most one materially different backup"),
  );
  assert(!prompt.systemPrompt.includes("Return 2–3 numbered"));
  assert(!prompt.systemPrompt.includes("Return 3–5 numbered"));
});

Deno.test("required Library conversation preserves one inline disclosure through the final contract", () => {
  const prompt = buildWorstCase({
    contract: WORKSPACE_CONTRACTS.library,
    intent: "freeform",
    depth: "Standard",
    libraryMode: "thin",
    libraryCoverageState: "required_missing",
    v2Decision: null,
    outputMode: "conversation",
    behaviorIntent: BEHAVIORS[2],
  });
  const disclosures = prompt.segments.filter((segment) =>
    segment.id === "fixed.library-disclosure"
  );
  assertEquals(disclosures.length, 1);
  assertStringIncludes(
    disclosures[0].text,
    "LIBRARY_REQUIRED_GAP (inline)",
  );
  assertEquals(prompt.systemPrompt.match(/## Sources used/g)?.length ?? 0, 0);
  assertEquals(prompt.systemPrompt.match(/## Gaps/g)?.length ?? 0, 0);
  assertEquals(
    prompt.segments.at(-1)?.id,
    "fixed.conversation-enforcement-final",
  );
  assertStringIncludes(
    prompt.segments.at(-1)?.text ?? "",
    "If Library Disclosure selects one inline source/coverage statement",
  );
  assertStringIncludes(
    prompt.segments.at(-1)?.text ?? "",
    "Never narrate the search/retrieval process",
  );
});
