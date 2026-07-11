import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { classifyBehaviorIntent } from "./behaviorIntent.ts";

Deno.test("behavior intent carries exact counted scripts, messages, and paths", () => {
  const cases = [
    ["give me 4 scripts", "artifact_creation"],
    ["4 messages", "artifact_creation"],
    ["4 paths", "idea_generation"],
  ] as const;
  for (const [text, expectedIntent] of cases) {
    const result = classifyBehaviorIntent(text, { hasAccountContext: true });
    assertEquals(result.requested_count, 4, text);
    assertEquals(result.intent, expectedIntent, text);
    assertEquals(result.confidence, "high", text);
  }
});

Deno.test("behavior intent does not promote factual counts into output requests", () => {
  for (
    const text of [
      "We sent 4 messages yesterday—what should I do next?",
      "The buyer reviewed 4 scripts",
      "I have 4 options already; choose one",
      "Give me 4 days to review",
      "I need 4 business days",
    ]
  ) {
    assertEquals(
      classifyBehaviorIntent(text, { hasAccountContext: true })
        .requested_count,
      undefined,
      text,
    );
  }
});

Deno.test("behavior intent preserves an exact count before a recommendation continuation", () => {
  const result = classifyBehaviorIntent(
    "Give me 4 paths and recommend one",
    { hasAccountContext: true },
  );
  assertEquals(result.requested_count, 4);
  assertEquals(result.requested_output_noun, "paths");
  assertEquals(result.intent, "idea_generation");
});
