// Tests for W7 — Escalation Rules (shadow-only).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEscalationPersistenceBlock,
  evaluateEscalationRules,
} from "./workspaceEscalation.ts";
import { getWorkspaceContract } from "./workspaceContracts.ts";
import type { CitationCheckResult } from "./citationEnforcement.ts";
import type { GateRunSummary } from "./workspaceGateRunner.ts";

function findSuggestion(summary: ReturnType<typeof evaluateEscalationRules>, id: string) {
  return summary.suggestions.find((s) => s.id === id);
}

function emptyCitation(): CitationCheckResult {
  return {
    citationMode: "none",
    auditedText: "",
    citationsFound: 0,
    issues: [],
    surface: "strategy-chat",
  } as unknown as CitationCheckResult;
}

Deno.test("W7: brainstorm suggests refine when user wants to develop an option", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("brainstorm"),
      assistantText: "[Angle: A] ...\n[Angle: B] ...",
      userPrompt: "let's develop option 2 further",
    },
    surface: "strategy-chat",
  });
  const s = findSuggestion(summary, "brainstorm.escalate.refine");
  assert(s, "should suggest refine");
  assertEquals(s!.targetWorkspace, "refine");
  assertEquals(s!.action, "recommend_workspace");
  assertEquals(s!.confidence, "high");
  assertEquals(s!.shadow, true);
});

Deno.test("W7: deep_research suggests artifacts when findings imply a deliverable", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("deep_research"),
      assistantText: "Findings: ...",
      userPrompt: "now turn this into a brief I can send",
    },
    surface: "strategy-chat",
  });
  const s = findSuggestion(summary, "deep_research.escalate.artifacts");
  assert(s);
  assertEquals(s!.targetWorkspace, "artifacts");
  assertEquals(s!.confidence, "high");
});

Deno.test("W7: artifacts logs Projects promotion for ongoing work (account_brief)", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "## Account Brief\n...",
      userPrompt: "draft an account brief",
      taskType: "account_brief",
    },
    surface: "run-task",
    taskType: "account_brief",
  });
  const s = findSuggestion(summary, "artifacts.escalate.projects");
  assert(s, "should log promotion suggestion");
  assertEquals(s!.action, "log_promotion_suggestion");
  assertEquals(s!.targetWorkspace, "projects");
  assertEquals(s!.confidence, "high");
});

Deno.test("W7: work recommends deep_research only when sourcing is needed", () => {
  // No evidence ask, no unverified citations → no suggestion.
  const silent = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("work"),
      assistantText: "Send this email at 9am.",
      userPrompt: "what should I send next?",
    },
    surface: "strategy-chat",
  });
  assertEquals(findSuggestion(silent, "work.escalate.deep_research"), undefined);

  // Evidence ask → fires high-confidence.
  const fires = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("work"),
      assistantText: "Send this email at 9am.",
      userPrompt: "is this true? show me sources.",
    },
    surface: "strategy-chat",
  });
  const s = findSuggestion(fires, "work.escalate.deep_research");
  assert(s);
  assertEquals(s!.confidence, "high");
});

Deno.test("W7: no suggestions when triggers are absent", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("brainstorm"),
      assistantText: "[Angle: A] ...\n[Angle: B] ...\nNext move: pick one.",
      userPrompt: "give me 3 angles",
    },
    surface: "strategy-chat",
  });
  assertEquals(summary.totals.suggestionsEmitted, 0);
});

Deno.test("W7: refine→deep_research fires when citation check has unverified", () => {
  const citation: CitationCheckResult = {
    ...emptyCitation(),
    issues: [{ code: "unverified_citation", detail: "x" } as any],
  } as CitationCheckResult;
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("refine"),
      assistantText: "Refined draft with claim.",
      userPrompt: "tighten this",
      citationCheck: citation,
    },
    surface: "strategy-chat",
  });
  const s = findSuggestion(summary, "refine.escalate.deep_research");
  assert(s);
  assertEquals(s!.confidence, "high");
});

Deno.test("W7: artifacts→deep_research fires when required-section gate fails", () => {
  const gateSummary: GateRunSummary = {
    workspace: "artifacts",
    contractVersion: "x",
    surface: "run-task",
    results: [
      {
        id: "artifacts.required_sections_present",
        checkRef: "artifacts.required_sections_present",
        enforcementType: "deterministic",
        severity: "warning",
        outcome: "fail",
        shadow: true,
        detail: "missing",
      },
    ],
    totals: { total: 1, pass: 0, fail: 1, skipped: 0, error: 0 },
  } as GateRunSummary;
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("artifacts"),
      assistantText: "Partial artifact",
      gateSummary,
    },
    surface: "run-task",
  });
  const s = findSuggestion(summary, "artifacts.escalate.deep_research");
  assert(s);
  assertEquals(s!.confidence, "high");
});

Deno.test("W7: every suggestion is shadow-only", () => {
  for (const ws of ["brainstorm", "deep_research", "refine", "library", "artifacts", "projects", "work"] as const) {
    const summary = evaluateEscalationRules({
      inputs: {
        contract: getWorkspaceContract(ws),
        assistantText: "draft me a brief; is this true?",
        userPrompt: "draft me a brief; is this true? brainstorm options too. develop option 1.",
      },
      surface: "strategy-chat",
    });
    for (const s of summary.suggestions) {
      assertEquals(s.shadow, true, `${ws}/${s.id} must be shadow`);
    }
  }
});

Deno.test("W7: persistence block is compact and shadow-only", () => {
  const summary = evaluateEscalationRules({
    inputs: {
      contract: getWorkspaceContract("brainstorm"),
      assistantText: "[Angle: A]...",
      userPrompt: "develop option 1",
    },
    surface: "strategy-chat",
  });
  const block = buildEscalationPersistenceBlock(summary);
  assertEquals(block.workspace, "brainstorm");
  assert(block.suggestions.length >= 1);
  assert("reason" in block.suggestions[0]);
  assert("confidence" in block.suggestions[0]);
});
