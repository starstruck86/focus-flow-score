/**
 * Phase 3.6 — Security Contract Tests.
 *
 * Guarantees:
 * - Every edge function has auth check OR a narrow public metadata contract
 * - No Deno.serve() without auth except an explicitly verified public endpoint
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

const PUBLIC_METADATA_FUNCTIONS = new Set(["version"]);

type ReviewedLexicalCronReceiverBinding = Readonly<{
  factory: string;
  handlerPath: string;
  serverCall: "Deno.serve" | "serve";
  allowNonCronRequests: boolean;
}>;

// This is a narrow lexical drift guard over reviewed source files. It does not
// build a module graph, prove call reachability, or attest deployed code.
const REVIEWED_CRON_RECEIVER_BINDINGS = new Map<
  string,
  ReviewedLexicalCronReceiverBinding
>([
  [
    "daily-digest",
    {
      factory: "createDailyDigestHandler",
      handlerPath: "supabase/functions/daily-digest/handler.ts",
      serverCall: "Deno.serve",
      allowNonCronRequests: true,
    },
  ],
  [
    "run-strategy-task-reaper",
    {
      factory: "createStrategyTaskReaperHandler",
      handlerPath: "supabase/functions/run-strategy-task-reaper/handler.ts",
      serverCall: "Deno.serve",
      allowNonCronRequests: false,
    },
  ],
  [
    "run-strategy-task-reaper-receipt-v1",
    {
      factory: "createStrategyTaskReaperReceiptHandler",
      handlerPath:
        "supabase/functions/run-strategy-task-reaper-receipt-v1/handler.ts",
      serverCall: "Deno.serve",
      allowNonCronRequests: false,
    },
  ],
  [
    "schedule-daily-plan",
    {
      factory: "createScheduleDailyPlanHandler",
      handlerPath: "supabase/functions/schedule-daily-plan/handler.ts",
      serverCall: "serve",
      allowNonCronRequests: false,
    },
  ],
]);

function hasReviewedLexicalCronReceiverBinding(
  name: string,
  indexSource: string,
): boolean {
  const reviewed = REVIEWED_CRON_RECEIVER_BINDINGS.get(name);
  if (!reviewed) return false;

  const handlerSource = fs.readFileSync(
    path.resolve(reviewed.handlerPath),
    "utf-8",
  );
  const boundarySource = fs.readFileSync(
    path.resolve("supabase/functions/_shared/cronHeadReceiver.ts"),
    "utf-8",
  );
  const authSource = fs.readFileSync(
    path.resolve("supabase/functions/_shared/cronSecretAuth.ts"),
    "utf-8",
  );

  return indexSource.includes(`from "./handler.ts"`) &&
    indexSource.includes(`${reviewed.serverCall}(${reviewed.factory}(`) &&
    handlerSource.includes(`export function ${reviewed.factory}(`) &&
    handlerSource.includes("return createCronReceiverHandler({") &&
    handlerSource.includes(
      `allowNonCronRequests: ${reviewed.allowNonCronRequests}`,
    ) &&
    boundarySource.includes("const isCron = await hasValidCronSecret(") &&
    boundarySource.includes('if (request.method === "HEAD")') &&
    boundarySource.includes("status: isCron ? 204 : 401") &&
    boundarySource.includes("return await options.handleBusinessRequest(") &&
    authSource.includes('readEnvironment("CRON_SECRET")') &&
    authSource.includes('readEnvironment("CRON_SECRET_NEXT")') &&
    authSource.includes("return acceptsCronSecret(");
}

function hasAuthOrApprovedPublicMetadata(
  name: string,
  source: string,
): boolean {
  if (REVIEWED_CRON_RECEIVER_BINDINGS.has(name)) {
    return hasReviewedLexicalCronReceiverBinding(name, source);
  }
  return AUTH_PATTERNS.some(pattern => pattern.test(source)) ||
    PUBLIC_METADATA_FUNCTIONS.has(name);
}

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
    it("reviewed cron receivers retain their lexical shared-auth binding", () => {
      expect([...REVIEWED_CRON_RECEIVER_BINDINGS.keys()]).toEqual([
        "daily-digest",
        "run-strategy-task-reaper",
        "run-strategy-task-reaper-receipt-v1",
        "schedule-daily-plan",
      ]);
      for (const name of REVIEWED_CRON_RECEIVER_BINDINGS.keys()) {
        const source = readEdgeFunctionSource(name);
        expect(source).not.toBeNull();
        expect(hasReviewedLexicalCronReceiverBinding(name, source!)).toBe(true);
      }
    });

    it("strict receipt handling is isolated from the legacy reaper slug", () => {
      const legacyIndex = readEdgeFunctionSource("run-strategy-task-reaper")!;
      const legacyHandler = fs.readFileSync(
        path.resolve("supabase/functions/run-strategy-task-reaper/handler.ts"),
        "utf-8",
      );
      const strictIndex = readEdgeFunctionSource(
        "run-strategy-task-reaper-receipt-v1",
      )!;
      const strictHandler = fs.readFileSync(
        path.resolve(
          "supabase/functions/run-strategy-task-reaper-receipt-v1/handler.ts",
        ),
        "utf-8",
      );

      expect(legacyIndex).toContain("sweepStalePendingRuns");
      expect(legacyHandler).not.toContain("buildStrategyTaskReaperAttempt");
      expect(legacyHandler).not.toContain("x-cron-attempt-id");
      expect(strictIndex).not.toContain("sweepStalePendingRuns");
      expect(strictHandler).toContain("buildStrategyTaskReaperAttempt");
      expect(strictHandler).toContain("x-cron-attempt-id");
    });

    for (const fn of edgeFunctions) {
      it(`${fn} has auth or an approved public metadata contract`, () => {
        const source = readEdgeFunctionSource(fn);
        if (!source) return; // no index.ts, skip

        // Must have Deno.serve to be a real function
        if (!source.includes("Deno.serve")) return;

        expect(hasAuthOrApprovedPublicMetadata(fn, source)).toBe(true);
      });
    }

    it("version is a constrained public metadata endpoint", () => {
      expect([...PUBLIC_METADATA_FUNCTIONS]).toEqual(["version"]);

      const source = readEdgeFunctionSource("version");
      expect(source).toContain("Deno.serve(createVersionHandler())");

      const helper = fs.readFileSync(
        path.resolve("supabase/functions/_shared/versionResponse.ts"),
        "utf-8",
      );
      expect(helper).toContain("Deno.env.get(name)");
      expect(helper).toContain('"DENO_DEPLOYMENT_ID" | "SB_REGION"');
      expect(helper).not.toMatch(
        /createClient|\.from\(|fetch\(|SB_EXECUTION_ID|SUPABASE_SERVICE_ROLE_KEY/,
      );

      const config = fs.readFileSync(
        path.resolve("supabase/config.toml"),
        "utf-8",
      );
      expect(config).toMatch(
        /\[functions\.version\]\s+verify_jwt\s*=\s*false/,
      );
    });
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

  describe("Deno.serve Access Guard", () => {
    it("no edge function serves without auth or an approved public metadata contract", () => {
      const unguarded: string[] = [];
      for (const fn of edgeFunctions) {
        const source = readEdgeFunctionSource(fn);
        if (!source) continue;
        if (!source.includes("Deno.serve")) continue;

        if (!hasAuthOrApprovedPublicMetadata(fn, source)) unguarded.push(fn);
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
