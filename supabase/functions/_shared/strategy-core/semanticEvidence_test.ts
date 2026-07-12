import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatLibraryContext } from "../strategy-orchestrator/libraryRetrieval.ts";
import {
  buildStrategyChatEvidenceBlocks,
  buildStrategyChatSystemPromptParts,
} from "./chatPrompt.ts";
import { renderStandardBlock } from "./libraryStandard.ts";
import { renderLibraryTotalsBlock } from "./libraryTotals.ts";
import { renderResourceContextBlock } from "./resourceRetrieval.ts";
import { renderWorkingThesisStateBlock } from "./thesisMemory.ts";
import { WORKSPACE_CONTRACTS } from "./workspaceContracts.ts";

Deno.test("semantic evidence: resource renderer is data-only", () => {
  const text = renderResourceContextBlock({
    hits: [{
      id: "resource-12345678",
      title: "Picked Structure",
      resource_type: "template",
      is_template: true,
      template_category: "business_case",
      account_id: null,
      opportunity_id: null,
      tags: ["template"],
      matchKind: "picked",
      matchReason: "explicitly selected",
      matchSnippet: "Situation / Ask / Value / Outcome",
      description: null,
      bodyExcerpt: "## Situation\nKnown account facts",
      sourceShape: "structured",
      sourceShapeReason: "headings detected",
    }],
    kiHits: [],
    userAskedForResource: true,
    extractedPhrases: ["picked structure"],
    inferredCategories: ["template"],
  });
  assertStringIncludes(text, "USER-PICKED");
  assertStringIncludes(text, "source-shape: structured");
  for (
    const retiredDirective of [
      "BEHAVIOR (mandatory",
      "CLOSED RESOURCE SET",
      "GROUNDING DEPTH",
      "required response shape",
      "RULES (mandatory)",
      "[TBD:",
    ]
  ) {
    assert(!text.includes(retiredDirective), retiredDirective);
  }
});

Deno.test("semantic evidence: no-hit resources contain no behavioral command", () => {
  const text = renderResourceContextBlock({
    hits: [],
    userAskedForResource: true,
    extractedPhrases: ["missing"],
    inferredCategories: [],
  });
  assertEquals(
    text,
    "=== LIBRARY RESOURCES (resources table — exact retrievals only) ===\n(no matching resources or knowledge items)",
  );
});

Deno.test("semantic evidence: thesis renderer contains state, not behavior", () => {
  const text = renderWorkingThesisStateBlock({
    account_id: "account",
    current_thesis: "Expansion depends on mobile ownership.",
    current_leakage: "Web traffic does not reach app conversion.",
    confidence: "INFER",
    supporting_evidence: ["Seller confirmed web conversion is falling."],
    killed_hypotheses: [{
      hypothesis: "No app",
      killed_by: "App is live",
      killed_at: "2026-07-11T00:00:00.000Z",
    }],
    open_questions: ["Who owns web-to-app?"],
    thread_id: null,
    last_updated_at: "2026-07-11T00:00:00.000Z",
  });
  assertStringIncludes(text, "CURRENT THESIS");
  assertStringIncludes(text, "DEAD HYPOTHESES");
  assert(!text.includes("BEHAVIOR:"));
  assert(!text.includes("Do NOT silently restart"));
  assert(!text.includes("CONFIRMS, WEAKENS, or KILLS"));
});

Deno.test("semantic evidence: standards and playbook payloads carry no prompt commands", () => {
  const standards = renderStandardBlock({
    exemplarSetId: "test-exemplar-set",
    workspace: "work",
    surface: "strategy-chat",
    injected: true,
    exemplars: [{
      id: "standard-abc12345",
      shortId: "abc12345",
      title: "Executive Discovery",
      role: "standard",
      whenToUse: "CFO call",
      theMove: "Quantify delay",
      whyItWorks: "Creates urgency",
      antiPatterns: [],
      exampleSnippet: null,
      appliesToContexts: ["discovery"],
      confidence: 1,
      score: 1,
    }],
    roleCounts: { standard: 1, exemplar: 0, pattern: 0, tactic: 0 },
    approxTokens: 20,
    durationMs: 1,
  }, { dataOnly: true });
  assert(!standards.includes("Use them to shape"));
  assert(!standards.includes("Do NOT cite"));

  const library = formatLibraryContext(
    [],
    [{
      id: "playbook-12345678",
      title: "CFO Discovery",
      problem_type: "discovery",
      tactic_steps: ["Quantify the delay"],
      key_questions: ["What does a quarter cost?"],
      score: 1,
    }],
    { dataOnly: true },
  );
  assertStringIncludes(library, "RETRIEVED PLAYBOOKS");
  assertStringIncludes(library, "[PRIMARY]");
  assert(!library.includes("run every step"));
});

Deno.test("semantic evidence: totals state provenance without instructions", () => {
  const text = renderLibraryTotalsBlock({
    resources_total: 12,
    knowledge_items_total: 34,
    playbooks_total: 5,
    computed_at: "2026-07-11T00:00:00.000Z",
  });
  assertStringIncludes(text, "count_scope: exact Postgres COUNT");
  assert(!text.includes("ONLY numbers you may quote"));
  assert(!text.includes("say you cannot verify"));
});

Deno.test("semantic evidence: contextMode ordering remains authoritative", () => {
  const evidence = buildStrategyChatEvidenceBlocks({
    accountContext: "Account",
    libraryContext: "Library",
    resourceContextBlock: "Resources",
    libraryTotalsBlock: "Totals",
    workingThesisBlock: "Thesis",
    contextSection: "Thread",
    workspaceContract: WORKSPACE_CONTRACTS.projects,
  });
  assertEquals(
    evidence.map((block) => block.id),
    [
      "working_thesis",
      "context_section",
      "account_context",
      "internal_library",
      "library_resources",
      "library_totals",
    ],
  );
  assert(!evidence[3].text.includes("ground your answer"));
});

Deno.test("semantic evidence: strategy-chat uses data-only Current State projection", async () => {
  const source = await Deno.readTextFile(
    new URL("../../strategy-chat/index.ts", import.meta.url),
  );
  assertStringIncludes(
    source,
    "const currentStateBlock = renderCurrentStateEvidence(currentStateResult);",
  );
  for (
    const preservedField of [
      "intelligence.app_posture",
      "intelligence.measurement_motion",
      "intelligence.branch_expansion_map",
      "signal.customer_behavior_implication",
      "signal.marketing_motion_implication",
      "signal.future_state_implication",
      "change.before_basis",
      "change.now_basis",
      "change.next_basis",
    ]
  ) {
    assertStringIncludes(source, preservedField);
  }
  assertStringIncludes(
    source,
    'segment.id === "runtime.global-sop"',
  );
  assertStringIncludes(source, "promptSegments.splice(");
  assertStringIncludes(
    source,
    'const requiredLibraryWorkspace =\n    __retrievalRules.libraryUse === "required"',
  );
  assertStringIncludes(source, "!requiredLibraryWorkspace &&");
  assertStringIncludes(
    source,
    '|| __retrievalRules.libraryUse === "required"',
  );
  assertEquals(
    (source.match(/const hybrid = enforceHybridSchema\(/g) ?? []).length,
    1,
    "hybrid rewrite must remain streaming-only",
  );
  assertEquals(
    (source.match(/const hybridGuard = evaluateHybridGuard\(/g) ?? []).length,
    1,
    "non-stream must retain telemetry without rewriting output",
  );
  assertEquals(
    (source.match(/hasCiteableLibraryEvidence: citeableLibraryHitCount > 0/g) ??
      [])
      .length,
    2,
    "both output paths must make citation telemetry evidence-aware",
  );
  assertEquals(
    (source.match(/requiresLiteralLibraryCitation,/g) ?? []).length,
    2,
    "both output paths must honor the active literal-citation posture",
  );
  assertEquals(
    (source.match(/citationMode: effectiveCitationMode/g) ?? []).length,
    2,
    "forced literal posture must make W5 verify citations on both paths",
  );
  assertStringIncludes(
    source,
    'behaviorIntent.intent !== "artifact_creation"',
  );
  assertStringIncludes(
    source,
    "situationIntelligence?.competitiveSources || []",
  );
  assertStringIncludes(source, "cardHits: citationCardHits");
  assertStringIncludes(source, "citationCardHits.length");
  assertStringIncludes(source, "totalHits: citeableLibraryHitCount");
  assert(
    !/id:\s*"evidence\.current-state"[\s\S]{0,180}promptBlock/.test(source),
    "raw Current State prompt contract leaked back into evidence.current-state",
  );
});

Deno.test("semantic evidence: durable identity defers volatile facts to Territory", () => {
  const fixed = buildStrategyChatSystemPromptParts({
    depth: "Standard",
  }).fixedInstructions;
  assertStringIncludes(fixed, "Live Territory Profile evidence");
  assert(!fixed.includes("$1.4M"));
  assert(!fixed.includes("14 enterprise accounts"));
});

Deno.test("semantic evidence: obsolete V2 identity and parallel prompt API are removed", () => {
  const orchestrator = Deno.readTextFileSync(
    new URL("./v2/orchestrator.ts", import.meta.url),
  );
  const publicApi = Deno.readTextFileSync(
    new URL("./v2/index.ts", import.meta.url),
  );
  for (const source of [orchestrator, publicApi]) {
    assert(!source.includes("buildV2Prompt"));
    assert(!source.includes("V2OrchestratorPrompt"));
    assert(!source.includes("14 enterprise accounts"));
    assert(!source.includes("$1.4M"));
  }
  let obsoleteBuilderExists = true;
  try {
    Deno.statSync(
      new URL("./v2/extendedReasoningContract.ts", import.meta.url),
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) obsoleteBuilderExists = false;
    else throw error;
  }
  assertEquals(obsoleteBuilderExists, false);
});
