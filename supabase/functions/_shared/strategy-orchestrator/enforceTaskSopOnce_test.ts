// Phase 4 — enforceTaskSopOnce unit tests.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enforceTaskSopOnce } from "./enforceTaskSopOnce.ts";
import type { SopContractLike } from "./sopValidator.ts";

const sop: SopContractLike = {
  enabled: true,
  requiredOutputs: [
    "company overview",
    "key priorities",
    "risks or gaps",
    "recommended angles",
  ],
};

const baseDraft = {
  sections: [
    { id: "company_snapshot", name: "Company overview", content: "TJX is..." },
    { id: "operator_read", name: "Key priorities", content: "Loyalty, supply chain..." },
    { id: "risks", name: "Risks or gaps", content: "Margin pressure..." },
  ],
  markdown: "## Company overview\n...",
};

Deno.test("no-op when taskType is not account_brief", async () => {
  const result = await enforceTaskSopOnce({
    draftOutput: baseDraft,
    sop,
    outputCheck: {
      ran: true,
      sections_total: 3,
      required_outputs_total: 4,
      required_outputs_satisfied: 3,
      required_outputs_missing: ["recommended angles"],
      matched_section_names: [],
    },
    taskType: "discovery_prep",
    callModel: () => Promise.reject(new Error("should not be called")),
  });
  assertEquals(result.correction_attempted, false);
  assertEquals(result.corrected, false);
  assertEquals(result.draftOutput, baseDraft);
});

Deno.test("no-op when nothing is missing", async () => {
  const result = await enforceTaskSopOnce({
    draftOutput: baseDraft,
    sop,
    outputCheck: {
      ran: true,
      sections_total: 3,
      required_outputs_total: 4,
      required_outputs_satisfied: 4,
      required_outputs_missing: [],
      matched_section_names: [],
    },
    taskType: "account_brief",
    callModel: () => Promise.reject(new Error("should not be called")),
  });
  assertEquals(result.correction_attempted, false);
  assertEquals(result.corrected, false);
});

Deno.test("repairs missing output when model returns full draft", async () => {
  const repaired = {
    sections: [
      ...baseDraft.sections,
      {
        id: "next_moves",
        name: "Recommended angles",
        content: "Unknown — requires validation. Open question: which loyalty cohort to target?",
      },
    ],
    markdown: baseDraft.markdown,
  };
  const result = await enforceTaskSopOnce({
    draftOutput: baseDraft,
    sop,
    outputCheck: {
      ran: true,
      sections_total: 3,
      required_outputs_total: 4,
      required_outputs_satisfied: 3,
      required_outputs_missing: ["recommended angles"],
      matched_section_names: [],
    },
    taskType: "account_brief",
    callModel: async () => JSON.stringify(repaired),
  });
  assertEquals(result.correction_attempted, true);
  assertEquals(result.corrected, true);
  assertEquals(result.missing_before, ["recommended angles"]);
  assertEquals(result.missing_after, []);
  assert(Array.isArray(result.draftOutput.sections));
  assertEquals(result.draftOutput.sections.length, 4);
});

Deno.test("preserves original draft when model returns garbage", async () => {
  const result = await enforceTaskSopOnce({
    draftOutput: baseDraft,
    sop,
    outputCheck: {
      ran: true,
      sections_total: 3,
      required_outputs_total: 4,
      required_outputs_satisfied: 3,
      required_outputs_missing: ["recommended angles"],
      matched_section_names: [],
    },
    taskType: "account_brief",
    callModel: async () => "not json at all",
  });
  assertEquals(result.correction_attempted, true);
  assertEquals(result.corrected, false);
  assertEquals(result.enforcement_error, "repair_parse_failed");
  assertEquals(result.draftOutput, baseDraft);
});

Deno.test("preserves original draft when model throws", async () => {
  const result = await enforceTaskSopOnce({
    draftOutput: baseDraft,
    sop,
    outputCheck: {
      ran: true,
      sections_total: 3,
      required_outputs_total: 4,
      required_outputs_satisfied: 3,
      required_outputs_missing: ["recommended angles"],
      matched_section_names: [],
    },
    taskType: "account_brief",
    callModel: () => Promise.reject(new Error("upstream 500")),
  });
  assertEquals(result.correction_attempted, true);
  assertEquals(result.corrected, false);
  assert(result.enforcement_error?.includes("upstream 500"));
  assertEquals(result.draftOutput, baseDraft);
});

Deno.test("rejects partial patch missing sections array", async () => {
  const result = await enforceTaskSopOnce({
    draftOutput: baseDraft,
    sop,
    outputCheck: {
      ran: true,
      sections_total: 3,
      required_outputs_total: 4,
      required_outputs_satisfied: 3,
      required_outputs_missing: ["recommended angles"],
      matched_section_names: [],
    },
    taskType: "account_brief",
    callModel: async () => JSON.stringify({ patch: "only this" }),
  });
  assertEquals(result.corrected, false);
  assertEquals(result.enforcement_error, "repair_shape_invalid");
  assertEquals(result.draftOutput, baseDraft);
});
