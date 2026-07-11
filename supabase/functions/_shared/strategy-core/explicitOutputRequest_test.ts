import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  detectExplicitOutputCount,
  detectExplicitOutputRequest,
} from "./explicitOutputRequest.ts";

Deno.test("explicit output request accepts exact counted alternatives and artifacts", () => {
  const cases: Array<[string, number, "alternatives" | "artifact"]> = [
    ["give me 4 scripts", 4, "artifact"],
    ["4 messages", 4, "artifact"],
    ["4 paths", 4, "alternatives"],
    ["Please write 4 scripts", 4, "artifact"],
    ["Could you draft four messages", 4, "artifact"],
    [
      "For this call, give me exactly 4 distinct conversation paths",
      4,
      "alternatives",
    ],
    ["Create three talk-tracks", 3, "artifact"],
    ["Give me 4 paths and recommend one", 4, "alternatives"],
    ["Give me 4 unconventional plays", 4, "alternatives"],
  ];
  for (const [text, count, category] of cases) {
    const parsed = detectExplicitOutputRequest(text);
    assertEquals(parsed?.count, count, text);
    assertEquals(parsed?.category, category, text);
    assertEquals(detectExplicitOutputCount(text), count, text);
  }
});

Deno.test("explicit output request rejects factual mentions, ranges, and malformed counts", () => {
  for (
    const text of [
      "We sent 4 messages yesterday—what should I do next?",
      "The buyer reviewed 4 scripts",
      "I have 4 options already; choose one",
      "compare these 4 paths",
      "give me 4 script",
      "at least 4 paths",
      "up to 4 messages",
      "give me 0 paths",
      "give me 21 paths",
      "give me thirteen paths",
      "Give me 4 days to review",
      "I need 4 business days",
      "Give me 4 hours before I answer",
    ]
  ) {
    assertEquals(detectExplicitOutputRequest(text), null, text);
  }
});
