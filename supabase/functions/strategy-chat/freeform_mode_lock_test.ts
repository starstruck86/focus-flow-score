import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildResolvedTurnContract } from "../_shared/strategy-core/semanticPrompt.ts";

const freeform = buildResolvedTurnContract({
  intent: { intent: "freeform" },
  behaviorIntent: {
    intent: "research_analysis",
    suppressed: [],
    matched_signal: "test",
    confidence: "low",
  },
  outputModeDecision: {
    mode: "adaptive",
    reason: "test",
    workspace_default_mode: "adaptive",
    explicit_format_override: null,
    conversation_trigger_matched: null,
  },
  libraryMode: "general",
});

Deno.test("semantic FREEFORM: never authorizes a clarification-only stop", () => {
  assert(!/one-line answer/i.test(freeform));
  assert(!/give that and stop/i.test(freeform));
  assertStringIncludes(freeform, "Do not default to");
  assertStringIncludes(freeform, "clarification-only reply");
});

Deno.test("semantic FREEFORM: value and assumption precede refinement", () => {
  assertStringIncludes(freeform, "Choose the most reasonable interpretation");
  assertStringIncludes(freeform, "state one material assumption briefly");
  assertStringIncludes(freeform, "deliver value");
  assertStringIncludes(freeform, "one optional refinement question");
});

Deno.test("semantic asset discipline: missing facts become end questions, not placeholders", () => {
  assertStringIncludes(freeform, "ZERO-PLACEHOLDER RULE");
  assertStringIncludes(freeform, "Deliver the strongest useful result first");
  assertStringIncludes(freeform, "follow-up questions at the end");
  assert(!/say in ONE short line exactly what's missing/i.test(freeform));
});
