// ════════════════════════════════════════════════════════════════
// Tests — Workspace Prompt Composer (Phase W4)
//
// These tests pin the prompt-composition contract:
//   • Brainstorm overlay surfaces the [Angle: ] marker.
//   • Deep Research overlay surfaces [Verified] / [Inferred] /
//     [Speculative] tags.
//   • Refine overlay surfaces "## Improved version" and "## Changes".
//   • Artifacts overlay does NOT echo workspace section headings and
//     DOES emit the "TASK TEMPLATE TAKES PRECEDENCE" guard.
//   • The composition telemetry payload includes the expected block
//     ids and the contract version.
// ════════════════════════════════════════════════════════════════

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getWorkspaceContract } from "./workspaceContracts.ts";
import {
  ALL_WORKSPACE_PROMPT_BLOCKS,
  buildPromptCompositionLog,
  buildWorkspaceOverlay,
} from "./workspacePrompt.ts";

Deno.test("brainstorm overlay surfaces [Angle: ] marker", () => {
  const contract = getWorkspaceContract("brainstorm");
  const { text, blocksIncluded } = buildWorkspaceOverlay({ contract });
  assertStringIncludes(text, "[Angle:");
  // Marker block must always be emitted.
  assert(blocksIncluded.includes("output_formatting_hints"));
  // Sanity — universal blocks present.
  assert(blocksIncluded.includes("workspace_header"));
  assert(blocksIncluded.includes("mission"));
  assert(blocksIncluded.includes("cognitive_posture"));
  assert(blocksIncluded.includes("retrieval_posture"));
});

Deno.test("deep_research overlay surfaces confidence tags", () => {
  const contract = getWorkspaceContract("deep_research");
  const { text } = buildWorkspaceOverlay({ contract });
  assertStringIncludes(text, "[Verified]");
  assertStringIncludes(text, "[Inferred]");
  assertStringIncludes(text, "[Speculative]");
  // Section headings come from the contract for non-artifacts workspaces.
  assertStringIncludes(text, "## Thesis");
  assertStringIncludes(text, "## Evidence");
});

Deno.test("refine overlay surfaces required improved-version / changes headings", () => {
  const contract = getWorkspaceContract("refine");
  const { text } = buildWorkspaceOverlay({ contract });
  assertStringIncludes(text, "## Improved version");
  assertStringIncludes(text, "## Changes");
});

Deno.test("artifacts overlay defers required sections to the task template", () => {
  const contract = getWorkspaceContract("artifacts");
  const { text, blocksIncluded } = buildWorkspaceOverlay({
    contract,
    // Even without explicitly locking, artifacts contracts are flagged
    // `deferRequiredSectionsToTaskConfig: true` and must emit the guard.
    taskTemplateLocked: false,
  });
  assertStringIncludes(text, "TASK TEMPLATE TAKES PRECEDENCE");
  assert(blocksIncluded.includes("task_template_precedence"));
  // Artifacts contract intentionally has no sectionHeadings, but make
  // doubly sure no "Required section headings" line was emitted.
  assert(
    !text.includes("Required section headings"),
    "artifacts overlay must not list workspace-level section headings",
  );
});

Deno.test("runTask overlay always shows the TASK TEMPLATE precedence guard", () => {
  // Any non-artifacts contract, when called with taskTemplateLocked,
  // must emit the guard so locked task templates win over the overlay.
  const contract = getWorkspaceContract("deep_research");
  const { text, blocksIncluded } = buildWorkspaceOverlay({
    contract,
    taskTemplateLocked: true,
  });
  assertStringIncludes(text, "TASK TEMPLATE TAKES PRECEDENCE");
  assert(blocksIncluded.includes("task_template_precedence"));
});

Deno.test("escalation rules suppressed for runTask surface when requested", () => {
  const contract = getWorkspaceContract("brainstorm");
  const { blocksIncluded } = buildWorkspaceOverlay({
    contract,
    taskTemplateLocked: true,
    includeEscalationRules: false,
  });
  assert(!blocksIncluded.includes("escalation_rules"));
});

Deno.test("Global SOP is NOT restated by the overlay", () => {
  const contract = getWorkspaceContract("deep_research");
  const { text } = buildWorkspaceOverlay({ contract });
  // The overlay references the global rules but must not redefine them.
  assert(
    !text.includes("Account specificity") ||
      text.includes("Global Strategy SOP above remains in force"),
    "overlay should reference, not redefine, global SOP",
  );
});

Deno.test("composition telemetry includes block ids, version, and surface", () => {
  const contract = getWorkspaceContract("brainstorm");
  const result = buildWorkspaceOverlay({ contract });
  const log = buildPromptCompositionLog({
    contract,
    result,
    taskTemplateLocked: false,
    surface: "strategy-chat",
  });
  assertEquals(log.workspace, "brainstorm");
  assertEquals(log.contractVersion, contract.version);
  assertEquals(log.contextMode, contract.retrievalRules.contextMode);
  assertEquals(log.surface, "strategy-chat");
  assertEquals(log.outputFormattingHintsIncluded, true);
  assertEquals(log.taskTemplateLocked, false);
  // Every emitted id must be a known stable id.
  for (const id of log.blocksIncluded) {
    assert(
      ALL_WORKSPACE_PROMPT_BLOCKS.includes(id),
      `unknown block id in telemetry: ${id}`,
    );
  }
  assert(log.blocksIncluded.includes("workspace_header"));
  assert(log.blocksIncluded.includes("output_formatting_hints"));
});

Deno.test("composition telemetry forwards taskType + runId for run-task surface", () => {
  const contract = getWorkspaceContract("artifacts");
  const result = buildWorkspaceOverlay({
    contract,
    taskTemplateLocked: true,
  });
  const log = buildPromptCompositionLog({
    contract,
    result,
    taskTemplateLocked: true,
    surface: "run-task",
    taskType: "discovery_prep",
    runId: "run_abc123",
  });
  assertEquals(log.surface, "run-task");
  assertEquals(log.taskType, "discovery_prep");
  assertEquals(log.runId, "run_abc123");
  assertEquals(log.taskTemplateLocked, true);
  assert(log.blocksIncluded.includes("task_template_precedence"));
});
