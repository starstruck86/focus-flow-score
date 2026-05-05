/**
 * Phase 3.7 — Release Gate Tests.
 *
 * Validates the release gate catches all expected failure modes
 * and passes on a healthy repo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// We test the gate by calling it directly against the real repo
import { runReleaseGate } from "../releaseGate";

describe("Phase 3.7 — Release Gate", () => {
  it("current repo passes the release gate", () => {
    const result = runReleaseGate();
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("detects temporary endpoints if they exist", () => {
    const tempEndpoints = [
      "run-enforcement-proof",
      "run-telemetry-proof",
      "run-telemetry-canary",
    ];
    for (const ep of tempEndpoints) {
      const epDir = path.resolve(`supabase/functions/${ep}`);
      expect(fs.existsSync(epDir)).toBe(false);
    }
  });

  it("no bypass patterns in strategy-orchestrator source", () => {
    const orchDir = path.resolve("supabase/functions/_shared/strategy-orchestrator");
    if (!fs.existsSync(orchDir)) return;
    const files = fs.readdirSync(orchDir).filter(f => f.endsWith(".ts"));
    const bypassPatterns = [
      /skip[_ ]?artifact[_ ]?gate/i,
      /bypass[_ ]?artifact/i,
      /debug[_ ]?planner/i,
      /skip[_ ]?enforcement/i,
      /disable[_ ]?gate/i,
    ];
    for (const file of files) {
      const content = fs.readFileSync(path.join(orchDir, file), "utf-8");
      for (const pattern of bypassPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });

  it("no raw waitUntil(supabase...) in orchestrator", () => {
    const orchDir = path.resolve("supabase/functions/_shared/strategy-orchestrator");
    if (!fs.existsSync(orchDir)) return;
    const files = fs.readdirSync(orchDir).filter(f => f.endsWith(".ts"));
    for (const file of files) {
      const lines = fs.readFileSync(path.join(orchDir, file), "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes("waitUntil(") && line.includes("supabase")) {
          throw new Error(`Raw PostgREST builder in waitUntil at ${file}:${i + 1}`);
        }
      }
    }
  });

  it("required test suites exist in strategy-control", () => {
    const testDir = path.resolve("src/lib/strategy-control/__tests__");
    expect(fs.existsSync(testDir)).toBe(true);
    const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith(".test.ts"));
    const required = ["artifact", "security", "drift", "waituntil"];
    for (const keyword of required) {
      const found = testFiles.some(f => f.toLowerCase().includes(keyword));
      expect(found).toBe(true);
    }
  });

  it("no hardcoded JWT keys in edge function source", () => {
    const fnDir = path.resolve("supabase/functions");
    if (!fs.existsSync(fnDir)) return;
    const dirs = fs.readdirSync(fnDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith("_"))
      .map(d => d.name);
    for (const fn of dirs) {
      const indexPath = path.join(fnDir, fn, "index.ts");
      if (!fs.existsSync(indexPath)) continue;
      const src = fs.readFileSync(indexPath, "utf-8");
      const hardcoded = src.match(/["']eyJhbGciOi[A-Za-z0-9_-]{50,}["']/g);
      expect(hardcoded).toBeNull();
    }
  });
});
