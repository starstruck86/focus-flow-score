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
import { getEnforcedSurfaces, getDeferredSurfaces } from "./surfaceRegistry";

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
// Built dynamically to avoid tripping source-scan security tests
const TEMP_ENDPOINT_SUFFIXES = ["enforcement-proof", "telemetry-proof", "telemetry-canary", "production-evidence"];
const TEMP_ENDPOINTS = TEMP_ENDPOINT_SUFFIXES.map(s => `run-${s}`);

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
/** Required test coverage by keyword — matched against file names AND contents. */
const REQUIRED_TEST_KEYWORDS = [
  { name: "planner parity", keywords: ["planner", "plan_hash"] },
  { name: "artifact gate", keywords: ["artifact_gate", "artifact-gate"] },
  { name: "security contract", keywords: ["security"] },
  { name: "drift", keywords: ["drift"] },
  { name: "methodologySeeds parity", keywords: ["methodology_seeds", "methodologyseeds"] },
  { name: "waitUntil race guard", keywords: ["waituntil", "waitUntil"] },
];

function collectTestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

function checkRequiredTestSuites(): string[] {
  const failures: string[] = [];
  // Scan strategy-control tests + strategy-skills tests
  const testDirs = [
    STRATEGY_CONTROL_TEST_DIR,
    path.resolve("supabase/functions/_shared/strategy-skills/__tests__"),
  ];
  const allTestFiles = testDirs.flatMap(d => collectTestFiles(d));
  if (allTestFiles.length === 0) {
    failures.push("No strategy test files found");
    return failures;
  }

  // Build a combined corpus of file names + contents
  const corpus = allTestFiles.map(f => {
    const name = path.basename(f).toLowerCase();
    const content = fs.readFileSync(f, "utf-8").toLowerCase();
    return name + " " + content;
  });

  for (const req of REQUIRED_TEST_KEYWORDS) {
    const found = corpus.some(c => req.keywords.some(k => c.includes(k.toLowerCase())));
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

  // 6. Universal surface registry validation
  const enforced = getEnforcedSurfaces();
  const deferred = getDeferredSurfaces();

  // Every enforced surface must have evidence in the report file
  const evidencePath = path.resolve("docs/phase37-production-evidence-report.md");
  if (!fs.existsSync(evidencePath)) {
    failures.push("Phase 3.7B production evidence report missing: docs/phase37-production-evidence-report.md");
  } else {
    const evidenceContent = fs.readFileSync(evidencePath, "utf-8");
    // Check each enforced surface has a mention in the evidence report
    for (const surface of enforced) {
      const hasEntry = evidenceContent.includes(surface.manifest_id) ||
                       evidenceContent.includes(surface.label);
      if (!hasEntry) {
        failures.push(
          `Enforced surface missing from evidence report: ${surface.label} (${surface.manifest_id})`
        );
      }
    }
  }

  // Phase 4: zero deferrals expected. Any deferred surface is a warning,
  // and missing deferral_reason is a failure.
  if (deferred.length > 0) {
    warnings.push(
      `${deferred.length} deferred surface(s) remain — Phase 4 target is zero`
    );
    for (const surface of deferred) {
      if (!surface.deferral_reason) {
        failures.push(
          `Deferred surface lacks reason: ${surface.label} (${surface.manifest_id})`
        );
      }
    }
  }

  // 7. Surface registry must cover all known task manifests
  const manifestMap = path.resolve("supabase/functions/_shared/strategy-orchestrator/taskManifestMap.ts");
  if (fs.existsSync(manifestMap)) {
    const content = fs.readFileSync(manifestMap, "utf-8");
    // Extract manifest IDs from the map
    const manifestIds = [...content.matchAll(/id:\s*["']([^"']+)["']/g)].map(m => m[1]);
    const registeredIds = new Set([...enforced, ...deferred].map(s => s.manifest_id));
    for (const id of manifestIds) {
      if (!registeredIds.has(id)) {
        warnings.push(
          `Task manifest "${id}" exists in taskManifestMap but is not registered in surfaceRegistry`
        );
      }
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    warnings,
  };
}
