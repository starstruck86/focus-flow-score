/**
 * Phase 3.7 — Release Gate.
 *
 * Deterministic, pure checks that validate repo readiness for release.
 * NO async, NO network, NO LLM, NO heuristics.
 *
 * DOES NOT modify: scorer, artifact gate, synthesis, methodologySeeds.
 */

import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ReleaseGateResult {
  pass: boolean;
  failures: string[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Check helpers
// ═══════════════════════════════════════════════════════════════════

const EDGE_FN_DIR = path.resolve("supabase/functions");
const STRATEGY_CONTROL_TEST_DIR = path.resolve("src/lib/strategy-control/__tests__");
const ORCHESTRATOR_DIR = path.resolve("supabase/functions/_shared/strategy-orchestrator");

function getEdgeFunctionDirs(): string[] {
  if (!fs.existsSync(EDGE_FN_DIR)) return [];
  return fs.readdirSync(EDGE_FN_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("_"))
    .map(d => d.name);
}

// ── Bypass patterns ──────────────────────────────────────────
const BYPASS_PATTERNS = [
  /skip[_ ]?artifact[_ ]?gate/i,
  /bypass[_ ]?artifact/i,
  /debug[_ ]?planner/i,
  /skip[_ ]?enforcement/i,
  /disable[_ ]?gate/i,
];

function checkNoBypassPatterns(): string[] {
  const failures: string[] = [];
  const dirs = [EDGE_FN_DIR, ORCHESTRATOR_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = walkTs(dir);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      for (const pattern of BYPASS_PATTERNS) {
        if (pattern.test(content)) {
          failures.push(`Bypass pattern found in ${path.relative(".", file)}: ${pattern.source}`);
        }
      }
    }
  }
  return failures;
}

// ── Temp endpoints ───────────────────────────────────────────
const TEMP_ENDPOINTS = [
  "run-enforcement-proof",
  "run-telemetry-proof",
  "run-telemetry-canary",
];

function checkNoTempEndpoints(): string[] {
  const failures: string[] = [];
  for (const ep of TEMP_ENDPOINTS) {
    const epDir = path.join(EDGE_FN_DIR, ep);
    if (fs.existsSync(epDir)) {
      failures.push(`Temporary endpoint still exists: ${ep}`);
    }
  }
  return failures;
}

// ── Raw PostgREST waitUntil ──────────────────────────────────
function checkNoRawWaitUntil(): string[] {
  const failures: string[] = [];
  if (!fs.existsSync(ORCHESTRATOR_DIR)) return failures;
  const files = walkTs(ORCHESTRATOR_DIR);
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes("waitUntil(") && line.includes("supabase")) {
        failures.push(`Raw PostgREST builder in waitUntil at ${path.relative(".", file)}:${i + 1}`);
      }
    }
  }
  return failures;
}

// ── Required test suites ─────────────────────────────────────
const REQUIRED_TEST_PATTERNS = [
  { name: "planner parity", pattern: /planner/i },
  { name: "artifact gate", pattern: /artifact[_-]?gate/i },
  { name: "security contract", pattern: /security/i },
  { name: "drift", pattern: /drift/i },
  { name: "methodologySeeds parity", pattern: /methodology/i },
  { name: "waitUntil race guard", pattern: /waituntil/i },
];

function checkRequiredTestSuites(): string[] {
  const failures: string[] = [];
  if (!fs.existsSync(STRATEGY_CONTROL_TEST_DIR)) {
    failures.push("Strategy control test directory missing");
    return failures;
  }
  const testFiles = fs.readdirSync(STRATEGY_CONTROL_TEST_DIR).filter(f => f.endsWith(".test.ts"));
  for (const req of REQUIRED_TEST_PATTERNS) {
    const found = testFiles.some(f => req.pattern.test(f));
    if (!found) {
      failures.push(`Required test suite missing: ${req.name}`);
    }
  }
  return failures;
}

// ── Walk helper ──────────────────────────────────────────────
function walkTs(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith("_test.ts")) {
      results.push(full);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// Main gate
// ═══════════════════════════════════════════════════════════════════

export function runReleaseGate(): ReleaseGateResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  // 1. No bypass patterns
  failures.push(...checkNoBypassPatterns());

  // 2. No temporary endpoints
  failures.push(...checkNoTempEndpoints());

  // 3. No raw PostgREST in waitUntil
  failures.push(...checkNoRawWaitUntil());

  // 4. Required test suites exist
  failures.push(...checkRequiredTestSuites());

  // 5. No inline hardcoded service role keys in edge functions
  const edgeFns = getEdgeFunctionDirs();
  for (const fn of edgeFns) {
    const indexPath = path.join(EDGE_FN_DIR, fn, "index.ts");
    if (!fs.existsSync(indexPath)) continue;
    const src = fs.readFileSync(indexPath, "utf-8");
    // Check for hardcoded JWT-like strings (eyJ...) that aren't the known anon key pattern
    const hardcodedKeys = src.match(/["']eyJhbGciOi[A-Za-z0-9_-]{50,}["']/g);
    if (hardcodedKeys) {
      failures.push(`Hardcoded key in ${fn}/index.ts`);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    warnings,
  };
}
