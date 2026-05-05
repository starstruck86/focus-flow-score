/**
 * Phase 3.5D — Security Surface Tests.
 *
 * Proves:
 * 1. run-enforcement-proof endpoint has been removed from the codebase
 * 2. No artifact gate bypass paths exist in production code
 * 3. No debug/diagnostic endpoints expose internal enforcement logic
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");

function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

describe("Phase 3.5D — Security Surface", () => {
  // ── 1. Enforcement-proof endpoint removed ──────────────────────
  it("run-enforcement-proof function directory does not exist", () => {
    const fnDir = path.join(PROJECT_ROOT, "supabase/functions/run-enforcement-proof");
    expect(fs.existsSync(fnDir)).toBe(false);
  });

  it("no non-test source file references run-enforcement-proof", () => {
    const dirs = [
      path.join(PROJECT_ROOT, "src"),
      path.join(PROJECT_ROOT, "supabase/functions"),
    ];
    const files = dirs.flatMap((d) => walkFiles(d, [".ts", ".tsx", ".js"]));
    const hits: string[] = [];
    for (const f of files) {
      // Skip test files — they may reference the name for assertion purposes
      if (f.includes("__tests__") || f.includes(".test.")) continue;
      const content = fs.readFileSync(f, "utf-8");
      if (content.includes("run-enforcement-proof")) {
        hits.push(f.replace(PROJECT_ROOT + "/", ""));
      }
    }
    expect(hits).toEqual([]);
  });

  // ── 2. No bypass patterns in production code ───────────────────
  const BYPASS_PATTERNS = [
    /skip[_\s-]?artifact[_\s-]?gate/i,
    /bypass[_\s-]?artifact/i,
    /artifact[_\s-]?gate[_\s-]?bypass/i,
    /debug[_\s-]?planner/i,
  ];

  it("no artifact gate bypass patterns in source code", () => {
    const dirs = [
      path.join(PROJECT_ROOT, "src"),
      path.join(PROJECT_ROOT, "supabase/functions"),
    ];
    const files = dirs.flatMap((d) => walkFiles(d, [".ts", ".tsx", ".js"]));
    const hits: { file: string; line: number; text: string }[] = [];
    for (const f of files) {
      // Skip test files — they may reference patterns for assertion purposes
      if (f.includes("__tests__") || f.includes(".test.")) continue;
      const lines = fs.readFileSync(f, "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const pat of BYPASS_PATTERNS) {
          if (pat.test(lines[i])) {
            hits.push({ file: f.replace(PROJECT_ROOT + "/", ""), line: i + 1, text: lines[i].trim() });
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  // ── 3. Diagnostic endpoints are auth-gated ─────────────────────
  it("strategy-stress-runner requires STRATEGY_VALIDATION_KEY", () => {
    const fn = path.join(PROJECT_ROOT, "supabase/functions/strategy-stress-runner/index.ts");
    if (!fs.existsSync(fn)) return; // acceptable if removed
    const content = fs.readFileSync(fn, "utf-8");
    expect(content).toContain("STRATEGY_VALIDATION_KEY");
    expect(content).toContain("401");
  });

  it("strategy-retrieval-probe requires auth", () => {
    const fn = path.join(PROJECT_ROOT, "supabase/functions/strategy-retrieval-probe/index.ts");
    if (!fs.existsSync(fn)) return;
    const content = fs.readFileSync(fn, "utf-8");
    expect(content).toContain("unauthorized");
    expect(content).toContain("401");
  });

  // ── 4. No anon-key-only diagnostic endpoints ──────────────────
  it("no diagnostic function accepts only anon key without validation", () => {
    const diagnosticFns = ["strategy-stress-runner", "strategy-retrieval-probe", "run-enforcement-proof"];
    for (const name of diagnosticFns) {
      const dir = path.join(PROJECT_ROOT, `supabase/functions/${name}`);
      if (!fs.existsSync(dir)) continue; // removed = safe
      const idx = path.join(dir, "index.ts");
      if (!fs.existsSync(idx)) continue;
      const content = fs.readFileSync(idx, "utf-8");
      // Must have at least one of these auth gates
      const hasGate =
        content.includes("STRATEGY_VALIDATION_KEY") ||
        content.includes("SUPABASE_SERVICE_ROLE_KEY") ||
        content.includes("401");
      expect(hasGate).toBe(true);
    }
  });
});
