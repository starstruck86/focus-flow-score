// ════════════════════════════════════════════════════════════════
// Regression test: FREEFORM mode-lock must not instruct the model to
// produce clarification-only / one-line "what's missing" responses.
//
// Root cause being guarded: the FREEFORM mode-lock block is BINDING
// and appears before the Strategy Decision Layer. Any "one-line stop"
// or "say what's missing" carve-out in this block overrides the
// Decision Layer and causes clarification-first replies in workspaces
// like Brainstorm.
// ════════════════════════════════════════════════════════════════

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// Extract the FREEFORM case block from buildModeLockBlock(...)
function extractFreeformBlock(src: string): string {
  const start = src.indexOf("MODE LOCK: FREEFORM");
  assert(start > -1, "FREEFORM mode lock block not found in index.ts");
  // Grab a generous window — the block ends at the next `case` / `}` boundary.
  const window = src.slice(start, start + 3000);
  const end = window.search(/\n\s*}\s*\n/);
  return end > -1 ? window.slice(0, end) : window;
}

const freeformBlock = extractFreeformBlock(SOURCE);

Deno.test("FREEFORM mode lock: does not instruct 'one-line answer ... and stop'", () => {
  assert(
    !/one-line answer/i.test(freeformBlock),
    "FREEFORM block still references a 'one-line answer' carve-out",
  );
  assert(
    !/give that and stop/i.test(freeformBlock),
    "FREEFORM block still tells the model to give a one-line answer and stop",
  );
  assert(
    !/SMALLEST useful output/.test(freeformBlock),
    "FREEFORM block still instructs the SMALLEST useful output (collapses Brainstorm)",
  );
});

Deno.test("FREEFORM mode lock: contains binding ambiguity-handling rule", () => {
  assert(
    /AMBIGUITY HANDLING\s*[—-]\s*BINDING/i.test(freeformBlock),
    "FREEFORM block missing binding AMBIGUITY HANDLING section",
  );
  assert(
    /assume the most reasonable interpretation/i.test(freeformBlock),
    "FREEFORM block must instruct model to assume reasonable interpretation",
  );
  assert(
    /ONLY after delivering value/i.test(freeformBlock),
    "FREEFORM block must require value-first before clarifying questions",
  );
});

Deno.test("FREEFORM mode lock: forbids clarification-only as primary response", () => {
  assert(
    /FORBIDDEN: clarification-only responses/i.test(freeformBlock),
    "FREEFORM block must explicitly forbid clarification-only primary responses",
  );
});

// ── ZERO-PLACEHOLDER rule must no longer teach 'say what's missing in ONE short line' ──
Deno.test("ZERO-PLACEHOLDER rule: removes the 'one short line of what's missing' carve-out", () => {
  const zpStart = SOURCE.indexOf("ZERO-PLACEHOLDER RULE");
  assert(zpStart > -1, "ZERO-PLACEHOLDER rule not found");
  const zpBlock = SOURCE.slice(zpStart, zpStart + 2000);
  assert(
    !/say in ONE short line exactly what's missing/i.test(zpBlock),
    "ZERO-PLACEHOLDER rule still authorizes clarification-only one-line replies",
  );
  assert(
    /convert the missing facts into 1[–-]3 follow-up questions at the END/i.test(zpBlock),
    "ZERO-PLACEHOLDER rule should require missing facts become end-of-response follow-ups",
  );
});
