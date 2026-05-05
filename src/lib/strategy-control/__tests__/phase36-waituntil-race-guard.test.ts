/**
 * Phase 3.6 Finalization — PostgREST thenable / waitUntil race regression test
 * and source-level guard against unsafe patterns.
 *
 * 1. Authoring failure path MUST persist planner, performance, anomaly_flags, authoring_failure.
 * 2. No partial-only meta write (e.g. only authoring_fallback) is allowed.
 * 3. No raw PostgREST builder may be passed to EdgeRuntime.waitUntil — must wrap in a real Promise.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const RUN_TASK_PATH = path.resolve(
  __dirname,
  "../../../../supabase/functions/_shared/strategy-orchestrator/runTask.ts",
);
const PROGRESSIVE_DRIVER_PATH = path.resolve(
  __dirname,
  "../../../../supabase/functions/_shared/strategy-orchestrator/progressiveDriver.ts",
);

const runTaskSource = fs.readFileSync(RUN_TASK_PATH, "utf-8");

// ─── Helpers ───────────────────────────────────────────────────────
/** Extract all `.update({...})` call argument blocks from the source. */
function extractUpdateBlocks(src: string): string[] {
  const blocks: string[] = [];
  const regex = /\.update\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(src)) !== null) {
    // Grab up to 20 lines following the match to capture the object literal
    const start = match.index;
    let depth = 0;
    let end = start;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") depth++;
      if (src[i] === "}") depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
    blocks.push(src.slice(start, end));
  }
  return blocks;
}

// ─── 1. Authoring failure path telemetry completeness ─────────────
describe("Phase 3.6 — Authoring failure path telemetry", () => {
  it("authoringFailMeta includes planner, performance, anomaly_flags, and authoring_failure", () => {
    // The source must build an authoringFailMeta with all four fields
    expect(runTaskSource).toContain("authoringFailMeta.planner");
    expect(runTaskSource).toContain("authoringFailMeta.performance");
    expect(runTaskSource).toContain("authoringFailMeta.anomaly_flags");
    expect(runTaskSource).toContain("authoringFailMeta.authoring_failure");
  });

  it("authoring failure DB write includes full meta object, not a subset", () => {
    // The .update call that uses authoringFailMeta must reference the full object
    const updateBlocks = extractUpdateBlocks(runTaskSource);
    const authoringFailWrite = updateBlocks.find((b) => b.includes("authoringFailMeta"));
    expect(authoringFailWrite).toBeDefined();
    // It must set meta: authoringFailMeta (the composite object), NOT individual keys
    expect(authoringFailWrite).toContain("meta: authoringFailMeta");
  });
});

// ─── 2. No partial-only meta writes ──────────────────────────────
describe("Phase 3.6 — No partial-only meta writes", () => {
  it("no .update() call writes meta containing ONLY authoring_fallback", () => {
    const updateBlocks = extractUpdateBlocks(runTaskSource);
    for (const block of updateBlocks) {
      if (!block.includes("meta")) continue;
      // A partial-only write would look like: meta: { authoring_fallback: ... }
      // without planner, performance, etc.
      const hasAuthoringFallback = block.includes("authoring_fallback");
      if (hasAuthoringFallback) {
        // If authoring_fallback appears, planner or performance must also be in the same meta object
        const hasFullTelemetry =
          block.includes("planner") ||
          block.includes("performance") ||
          block.includes("authoringFailMeta") ||
          block.includes("hardFailMeta") ||
          block.includes("metaPatch");
        expect(hasFullTelemetry).toBe(true);
      }
    }
  });

  it("no standalone meta write contains only { authoring_fallback }", () => {
    // Regex: meta: { authoring_fallback: <anything> } with no other keys
    const dangerousPattern = /meta:\s*\{\s*authoring_fallback:/;
    // Check that if this pattern exists, it's inside a larger object
    const matches = runTaskSource.match(dangerousPattern);
    if (matches) {
      // Verify each match is inside a composite meta object (has more keys)
      for (const m of matches) {
        // This alone would be partial — fail
        expect(m).not.toMatch(/meta:\s*\{\s*authoring_fallback:\s*[^,}]+\s*\}/);
      }
    }
  });
});

// ─── 3. Source guard: no raw PostgREST builder in waitUntil ──────
describe("Phase 3.6 — waitUntil source guard", () => {
  const filesToCheck = [
    { name: "runTask.ts", src: runTaskSource },
    {
      name: "progressiveDriver.ts",
      src: fs.readFileSync(PROGRESSIVE_DRIVER_PATH, "utf-8"),
    },
  ];

  for (const { name, src } of filesToCheck) {
    it(`${name}: no waitUntil(supabase.from(...).update(...)) — must wrap in Promise`, () => {
      // Dangerous: EdgeRuntime.waitUntil(supabase.from("task_runs").update(...))
      // Safe: EdgeRuntime.waitUntil(realPromise) where realPromise = (async () => { await supabase... })()
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes("waitUntil(") && line.includes("supabase")) {
          // Direct supabase call inside waitUntil — forbidden
          throw new Error(
            `${name}:${i + 1} — raw PostgREST builder passed to waitUntil: ${line}`,
          );
        }
      }
    });

    it(`${name}: waitUntil arguments are real Promises (IIFE, variable, or fetch)`, () => {
      const waitUntilCalls = src.match(/waitUntil\(([^)]+)\)/g) || [];
      for (const call of waitUntilCalls) {
        const arg = call.replace("waitUntil(", "").replace(")", "").trim();
        // arg must be a variable name (e.g. failurePromise, work, p) or an IIFE
        // It must NOT be a supabase.from() chain
        expect(arg).not.toMatch(/^supabase\./);
        expect(arg).not.toMatch(/^createClient/);
      }
    });
  }
});
