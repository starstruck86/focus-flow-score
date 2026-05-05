/**
 * Phase 3.6 — Security Contract Tests.
 *
 * Guarantees:
 * - Every edge function has auth check OR validation key
 * - No Deno.serve() without auth
 * - No bypass patterns in production code
 * - No anon-only diagnostic endpoints
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getEdgeFunctionDirs(): string[] {
  const base = path.resolve("supabase/functions");
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("_"))
    .map(d => d.name);
}

function readEdgeFunctionSource(name: string): string | null {
  const indexPath = path.resolve(`supabase/functions/${name}/index.ts`);
  if (!fs.existsSync(indexPath)) return null;
  return fs.readFileSync(indexPath, "utf-8");
}

// Patterns that indicate auth is present
const AUTH_PATTERNS = [
  /supabase\.auth\.getUser/,
  /auth\.getUser/,
  /STRATEGY_VALIDATION_KEY/,
  /x-batch-key/,
  /authorization/i,
  /Unauthorized/,
  /401/,
];

// Patterns that indicate a bypass
const BYPASS_PATTERNS = [
  /skip[_ ]?artifact[_ ]?gate/i,
  /bypass[_ ]?artifact/i,
  /debug[_ ]?planner/i,
  /skip[_ ]?enforcement/i,
  /disable[_ ]?gate/i,
];

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("Phase 3.6 — Security Contract", () => {
  const edgeFunctions = getEdgeFunctionDirs();

  it("at least 10 edge functions exist", () => {
    expect(edgeFunctions.length).toBeGreaterThanOrEqual(10);
  });

  describe("Auth Enforcement", () => {
    for (const fn of edgeFunctions) {
      it(`${fn} has auth check or validation key`, () => {
        const source = readEdgeFunctionSource(fn);
        if (!source) return; // no index.ts, skip

        // Must have Deno.serve to be a real function
        if (!source.includes("Deno.serve")) return;

        const hasAuth = AUTH_PATTERNS.some(p => p.test(source));
        expect(hasAuth).toBe(true);
      });
    }
  });

  describe("No Bypass Patterns in Production", () => {
    it("no bypass patterns in edge function source", () => {
      for (const fn of edgeFunctions) {
        const source = readEdgeFunctionSource(fn);
        if (!source) continue;
        for (const pattern of BYPASS_PATTERNS) {
          const match = source.match(pattern);
          expect(match).toBeNull();
        }
      }
    });

    it("no bypass patterns in strategy-orchestrator", () => {
      const orchestratorDir = path.resolve("supabase/functions/_shared/strategy-orchestrator");
      if (!fs.existsSync(orchestratorDir)) return;
      const files = fs.readdirSync(orchestratorDir).filter(f => f.endsWith(".ts"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(orchestratorDir, file), "utf-8");
        for (const pattern of BYPASS_PATTERNS) {
          const match = content.match(pattern);
          expect(match).toBeNull();
        }
      }
    });
  });

  describe("No Diagnostic Leaks", () => {
    it("run-enforcement-proof does not exist", () => {
      const proofDir = path.resolve("supabase/functions/run-enforcement-proof");
      expect(fs.existsSync(proofDir)).toBe(false);
    });

    it("run-telemetry-proof does not exist", () => {
      const dir = path.resolve("supabase/functions/run-telemetry-proof");
      expect(fs.existsSync(dir)).toBe(false);
    });

    it("run-telemetry-canary does not exist", () => {
      const dir = path.resolve("supabase/functions/run-telemetry-canary");
      expect(fs.existsSync(dir)).toBe(false);
    });

    it("no anon-key-only diagnostic endpoints", () => {
      // Diagnostic endpoints must require more than just anon key
      const diagnosticPatterns = [
        /diagnostic/i,
        /debug[_-]?endpoint/i,
        /internal[_-]?probe/i,
      ];
      for (const fn of edgeFunctions) {
        const source = readEdgeFunctionSource(fn);
        if (!source) continue;
        
        const isDiagnostic = diagnosticPatterns.some(p => p.test(fn));
        if (isDiagnostic) {
          // Must have strong auth beyond anon key
          const hasStrongAuth = /STRATEGY_VALIDATION_KEY|x-batch-key|getUser/.test(source);
          expect(hasStrongAuth).toBe(true);
        }
      }
    });
  });

  describe("Deno.serve Without Auth Guard", () => {
    it("no edge function serves without any auth mechanism", () => {
      const unguarded: string[] = [];
      for (const fn of edgeFunctions) {
        const source = readEdgeFunctionSource(fn);
        if (!source) continue;
        if (!source.includes("Deno.serve")) continue;

        const hasAuth = AUTH_PATTERNS.some(p => p.test(source));
        if (!hasAuth) unguarded.push(fn);
      }
      expect(unguarded).toEqual([]);
    });
  });

  describe("No Inline Hardcoded Keys", () => {
    it("no hardcoded JWT keys in edge functions", () => {
      for (const fn of edgeFunctions) {
        const source = readEdgeFunctionSource(fn);
        if (!source) continue;
        const hardcoded = source.match(/["']eyJhbGciOi[A-Za-z0-9_-]{50,}["']/g);
        expect(hardcoded).toBeNull();
      }
    });

    it("no raw service-role key exposure in edge functions", () => {
      for (const fn of edgeFunctions) {
        const source = readEdgeFunctionSource(fn);
        if (!source) continue;
        // Should use Deno.env.get, not inline the key
        expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']/);
      }
    });
  });

  describe("No Temporary Auth Patterns", () => {
    it("no TODO/FIXME auth bypasses", () => {
      for (const fn of edgeFunctions) {
        const source = readEdgeFunctionSource(fn);
        if (!source) continue;
        expect(source).not.toMatch(/TODO.*auth/i);
        expect(source).not.toMatch(/FIXME.*auth/i);
        expect(source).not.toMatch(/temporary.*auth/i);
      }
    });
  });
});
