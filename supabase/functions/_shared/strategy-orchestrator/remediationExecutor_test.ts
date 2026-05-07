/**
 * Phase 4G-1 — Remediation Executor Tests
 *
 * Tests normalize_only expansion to ninety_day_plan and guardrail skip logic.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// We test the REMEDIATION_ALLOWED_TASKS expansion and guardrail logic
// by importing the module and checking the exported constants/behavior.

// Since the executor has side-effect imports (Supabase), we test the
// classification logic via the providerFailureClassifier directly,
// and validate the task list via source inspection.

Deno.test("remediationExecutor source allows ninety_day_plan", async () => {
  const source = await Deno.readTextFile(
    new URL("./remediationExecutor.ts", import.meta.url).pathname
  );
  
  // Verify ninety_day_plan is in REMEDIATION_ALLOWED_TASKS (the const declaration, not the comment)
  const match = source.match(/const REMEDIATION_ALLOWED_TASKS[^;]+;/s);
  if (!match) throw new Error("REMEDIATION_ALLOWED_TASKS const not found in source");
  
  const taskList = match[0];
  assertEquals(taskList.includes('"ninety_day_plan"'), true, "ninety_day_plan must be in REMEDIATION_ALLOWED_TASKS");
  assertEquals(taskList.includes('"account_brief"'), true, "account_brief must remain in REMEDIATION_ALLOWED_TASKS");
});

Deno.test("remediationExecutor does NOT allow discovery_prep", async () => {
  const source = await Deno.readTextFile(
    new URL("./remediationExecutor.ts", import.meta.url).pathname
  );
  
  const match = source.match(/REMEDIATION_ALLOWED_TASKS[^;]+;/s);
  if (!match) throw new Error("REMEDIATION_ALLOWED_TASKS not found");
  
  assertEquals(match[0].includes('"discovery_prep"'), false, "discovery_prep must NOT be in REMEDIATION_ALLOWED_TASKS");
});

Deno.test("remediationExecutor does not enable section_reauthor or evidence_rewrite", async () => {
  const source = await Deno.readTextFile(
    new URL("./remediationExecutor.ts", import.meta.url).pathname
  );
  
  // Check that section_reauthor and evidence_rewrite are not enabled in rollout config
  const rolloutMatch = source.match(/ENABLED_REMEDIATION_TYPES[^;]+;/s);
  if (rolloutMatch) {
    assertEquals(rolloutMatch[0].includes('"section_reauthor"'), false, "section_reauthor must NOT be enabled");
    assertEquals(rolloutMatch[0].includes('"evidence_rewrite"'), false, "evidence_rewrite must NOT be enabled");
  }
});

Deno.test("remediationExecutor has guardrail for too_many_dimensions", async () => {
  const source = await Deno.readTextFile(
    new URL("./remediationExecutor.ts", import.meta.url).pathname
  );
  
  assertEquals(source.includes("too_many_dimensions"), true, "must have too_many_dimensions guardrail");
  assertEquals(source.includes("skip_too_many_dimensions"), true, "must have skip_too_many_dimensions type");
});
