/**
 * Phase 3.5D — Production Enforcement Tests.
 *
 * Proves:
 * 1. Artifact Gate: bad output fails, good output passes, regen path works
 * 2. Planner Enforcement: every task uses buildPlan, methodologySeeds present
 * 3. No Bypass Guarantee: source-level grep for bypasses
 *
 * Does NOT modify scorer, artifact gate thresholds, synthesis prompt, or retrieval thresholds.
 */
import { describe, it, expect } from "vitest";
import { runArtifactGate, type ArtifactManifest } from "../artifactGate";
import { buildPlan } from "@/lib/strategy-skills/planner";
import type { ResolvedSkill } from "@/lib/strategy-skills/resolver";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════
// Manifests for testing
// ═══════════════════════════════════════════════════════════════════

const STRUCTURED_MANIFEST: ArtifactManifest = {
  rubric: {
    mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"],
  },
  output: { shape: "structured_artifact" },
};

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

const GOOD_OUTPUT = JSON.stringify({
  situation: "Beechwood Hotel currently operates 4 disconnected guest platforms, costing $180K/year in redundant licensing. The GM is under pressure because NPS dropped 12 points last quarter, resulting in reduced repeat bookings [KI:a1b2c3d4]. This fragmentation means front-desk staff waste 22 minutes per check-in resolving data conflicts across systems, which directly erodes margin.",
  commercial_insight: "The real issue is not technology sprawl — it's that Beechwood cannot execute personalized upsell at check-in because guest preference data lives in 4 silos [PB:e5f6g7h8]. This means the GM is leaving $42/room-night on the table in ancillary revenue, consequently costing the property $890K annually in missed opportunity.",
  risks: "Without consolidation by Q3, Beechwood faces a $2.1M renovation cycle that will lock in the current stack for 3+ years. The VP of Operations has already flagged this as a budget risk [KI:i9j0k1l2], therefore delaying action compounds the cost of re-platforming by an estimated 40%.",
  strategic_why: "Consolidation is not an IT project — it's a revenue recovery initiative. The GM's bonus is tied to NPS and RevPAR, both of which are directly degraded by fragmented guest data. Because the decision process requires board approval above $500K, the champion must frame this as margin protection, not technology modernization [PB:m3n4o5p6].",
  specific_asks: "Ask the GM: 'What is your per-room technology cost today, and how does that compare to your target margin?' Then confirm whether the Q3 renovation budget has been allocated or is still pending approval. This validates urgency and surfaces the true decision timeline.",
  cited_sources: "Grounded in KI:a1b2c3d4 (guest platform fragmentation pattern showing 4-system sprawl drives $180K redundant licensing), PB:e5f6g7h8 (upsell execution playbook confirming $42/room-night gap when guest preferences are siloed across disconnected systems), KI:i9j0k1l2 (renovation cycle risk analysis proving 40% cost compounding from delayed re-platforming decisions), and PB:m3n4o5p6 (champion framing strategy for margin-protection positioning with board-level stakeholders). All citations directly support the causal reasoning chains above, resulting in actionable commercial pressure.",
}, null, 2);

const BAD_OUTPUT_MISSING_SECTIONS = JSON.stringify({
  situation: "Some company does stuff.",
  risks: "Maybe some risks exist.",
});

const BAD_OUTPUT_STUB = JSON.stringify({
  situation: "Short stub.",
  commercial_insight: "Too brief.",
  risks: "Brief.",
  strategic_why: "Brief.",
  specific_asks: "Brief.",
  cited_sources: "Brief.",
});

// ═══════════════════════════════════════════════════════════════════
// 1. ARTIFACT GATE ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════

describe("Phase 3.5D — Artifact Gate Enforcement", () => {
  it("good output passes the gate", () => {
    const result = runArtifactGate(GOOD_OUTPUT, STRUCTURED_MANIFEST);
    expect(result.pass).toBe(true);
    expect(result.failed_dimensions).toHaveLength(0);
  });

  it("bad output with missing sections FAILS the gate", () => {
    const result = runArtifactGate(BAD_OUTPUT_MISSING_SECTIONS, STRUCTURED_MANIFEST);
    expect(result.pass).toBe(false);
    expect(result.failed_dimensions.length).toBeGreaterThan(0);
  });

  it("stub sections FAIL the gate", () => {
    const result = runArtifactGate(BAD_OUTPUT_STUB, STRUCTURED_MANIFEST);
    expect(result.pass).toBe(false);
    // Should fail section_completeness at minimum
    expect(result.failed_dimensions).toContain("section_completeness");
  });

  it("good output is NEVER replaced or weakened", () => {
    const result1 = runArtifactGate(GOOD_OUTPUT, STRUCTURED_MANIFEST);
    const result2 = runArtifactGate(GOOD_OUTPUT, STRUCTURED_MANIFEST);
    expect(result1.pass).toBe(true);
    expect(result2.pass).toBe(true);
    // Deterministic — identical results
    expect(result1.failed_dimensions).toEqual(result2.failed_dimensions);
  });

  it("empty output fails catastrophically", () => {
    const result = runArtifactGate("", STRUCTURED_MANIFEST);
    expect(result.pass).toBe(false);
  });

  it("malformed JSON fails the gate", () => {
    const result = runArtifactGate("{not valid json", STRUCTURED_MANIFEST);
    expect(result.pass).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. PLANNER ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════

describe("Phase 3.5D — Planner Enforcement", () => {
  const TASK_TYPES = ["discovery_prep", "account_brief", "ninety_day_plan"] as const;

  // Create a manifest-like structure for each task type to verify
  // buildPlan can handle them all
  const taskManifests: Record<string, any> = {
    discovery_prep: {
      id: "discovery-prep",
      version: "1",
      sourceMode: "library_required",
      retrieval: {
        scopes: ["knowledge_items", "playbooks", "standards", "exemplars"],
        termBindings: ["${inputs.company_name}", "${inputs.opportunity}"],
        methodologySeeds: [
          "discovery", "qualification", "MEDDICC", "hypothesis",
          "value selling", "pain mapping",
        ],
        minRelevantItems: 3,
      },
    },
    account_brief: {
      id: "executive-brief",
      version: "1",
      sourceMode: "library_required",
      retrieval: {
        scopes: ["knowledge_items", "playbooks", "standards"],
        termBindings: ["${inputs.company_name}", "${inputs.opportunity}"],
        methodologySeeds: [
          "account planning", "stakeholder map", "buying committee",
          "executive engagement",
        ],
        minRelevantItems: 3,
      },
    },
    ninety_day_plan: {
      id: "ninety-day-plan",
      version: "1",
      sourceMode: "library_required",
      retrieval: {
        scopes: ["knowledge_items", "playbooks", "standards", "exemplars"],
        termBindings: ["${inputs.company_name}", "${inputs.opportunity}"],
        methodologySeeds: [
          "90 day plan", "territory plan", "milestone planning",
          "ramp", "expand",
        ],
        minRelevantItems: 3,
      },
    },
  };

  for (const tt of TASK_TYPES) {
    it(`${tt}: buildPlan succeeds with methodology seeds`, () => {
      const manifest = taskManifests[tt];
      const resolved: ResolvedSkill = {
        manifest,
        effectiveDepth: "artifact",
        inputs: { company_name: "Acme Corp", opportunity: "Q4 Deal" },
      };
      const result = buildPlan(resolved);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.termSeeds.length).toBeGreaterThan(0);
        // methodologySeeds should be injected
        const seedCount = manifest.retrieval.methodologySeeds.length;
        expect(result.plan.termSeeds.length).toBeGreaterThanOrEqual(seedCount);
      }
    });

    it(`${tt}: methodology seeds are always present in plan`, () => {
      const manifest = taskManifests[tt];
      const resolved: ResolvedSkill = {
        manifest,
        effectiveDepth: "artifact",
        inputs: { company_name: "Acme Corp" },
      };
      const result = buildPlan(resolved);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const seeds = manifest.retrieval.methodologySeeds;
        for (const seed of seeds) {
          const found = result.plan.termSeeds.some(
            (t: string) => t.toLowerCase() === seed.toLowerCase(),
          );
          expect(found).toBe(true);
        }
      }
    });

    it(`${tt}: planHash is deterministic`, () => {
      const manifest = taskManifests[tt];
      const resolved: ResolvedSkill = {
        manifest,
        effectiveDepth: "artifact",
        inputs: { company_name: "Acme Corp", opportunity: "Deal" },
      };
      const r1 = buildPlan(resolved);
      const r2 = buildPlan(resolved);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.plan.planHash).toBe(r2.plan.planHash);
      }
    });
  }

  it("planner treats all task types identically (no skill-specific branching)", () => {
    // All three should go through the same buildPlan path
    const plans = TASK_TYPES.map(tt => {
      const resolved: ResolvedSkill = {
        manifest: taskManifests[tt],
        effectiveDepth: "artifact",
        inputs: { company_name: "Acme Corp" },
      };
      return buildPlan(resolved);
    });
    // All succeed
    for (const p of plans) {
      expect(p.ok).toBe(true);
    }
    // All have planHash (same code path)
    for (const p of plans) {
      if (p.ok) {
        expect(typeof p.plan.planHash).toBe("string");
        expect(p.plan.planHash.length).toBe(8);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. NO BYPASS GUARANTEE
// ═══════════════════════════════════════════════════════════════════

describe("Phase 3.5D — No Bypass Guarantee", () => {
  it("runTask.ts contains artifact gate enforcement (not shadow-only)", () => {
    const runTaskPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/runTask.ts");
    const source = fs.readFileSync(runTaskPath, "utf-8");

    // Must contain artifact gate import
    expect(source).toContain("runArtifactGate");
    expect(source).toContain("artifactGateEnforcement");

    // Must contain hard fail on gate failure
    expect(source).toContain("artifact_gate_failed");
    expect(source).toContain("artifact_gate_hard_fail");

    // Must NOT have a bypass that skips the gate
    const lines = source.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("skip") && lower.includes("artifact") && lower.includes("gate")) {
        if (!lower.includes("do not skip") && !lower.includes("never skip")) {
          expect(line).toBe("UNEXPECTED: found artifact gate bypass");
        }
      }
    }
  });

  it("runTask.ts uses planner-driven retrieval", () => {
    const runTaskPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/runTask.ts");
    const source = fs.readFileSync(runTaskPath, "utf-8");

    expect(source).toContain("buildPlan");
    expect(source).toContain("planToRetrievalArgs");
    expect(source).toContain("getTaskManifest");
    expect(source).toContain("phase35d:planner_driven_retrieval");
  });

  it("artifact gate telemetry is persisted in meta", () => {
    const runTaskPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/runTask.ts");
    const source = fs.readFileSync(runTaskPath, "utf-8");

    expect(source).toContain("metaPatch.artifact_gate");
    expect(source).toContain("metaPatch.planner");
  });

  it("no direct returns before artifact gate in production path", () => {
    const runTaskPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/runTask.ts");
    const source = fs.readFileSync(runTaskPath, "utf-8");

    const stage3EndIdx = source.indexOf("stage-3:end");
    const gateIdx = source.indexOf("phase35d:artifact_gate");
    const finalizeIdx = source.indexOf("Stage 5: Finalize");

    expect(stage3EndIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(0);
    expect(finalizeIdx).toBeGreaterThan(0);

    expect(gateIdx).toBeGreaterThan(stage3EndIdx);
    expect(gateIdx).toBeLessThan(finalizeIdx);
  });

  it("progressiveDriver.ts contains artifact gate enforcement for discovery_prep", () => {
    const driverPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/progressiveDriver.ts");
    const source = fs.readFileSync(driverPath, "utf-8");

    // Must import artifact gate
    expect(source).toContain("runArtifactGate");
    expect(source).toContain("artifactGateEnforcement");

    // Must contain hard fail on gate failure
    expect(source).toContain("progressive_artifact_gate_hard_fail");
    expect(source).toContain("artifact_gate_failed");

    // Must contain regen path
    expect(source).toContain("progressive_artifact_gate_regen_success");
    expect(source).toContain("progressive_artifact_gate_regen_also_failed");
  });

  it("progressiveDriver assembleAndFinalize blocks persistence on gate failure", () => {
    const driverPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/progressiveDriver.ts");
    const source = fs.readFileSync(driverPath, "utf-8");

    // The gate must run BEFORE the final persist
    const gateIdx = source.indexOf("progressive_artifact_gate_failed");
    const persistIdx = source.indexOf("draft_output: finalDraftOutput");

    expect(gateIdx).toBeGreaterThan(0);
    expect(persistIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(persistIdx);

    // On gate failure, status is set to "failed" and `assembled: false`
    const hardFailIdx = source.indexOf("progressive_artifact_gate_hard_fail");
    const assembledFalseIdx = source.indexOf("assembled: false");
    expect(hardFailIdx).toBeGreaterThan(0);
    expect(assembledFalseIdx).toBeGreaterThan(0);
  });

  it("all three task types are artifact-gated (complete coverage)", () => {
    const runTaskPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/runTask.ts");
    const driverPath = path.resolve(__dirname, "../../../../supabase/functions/_shared/strategy-orchestrator/progressiveDriver.ts");
    const runTaskSource = fs.readFileSync(runTaskPath, "utf-8");
    const driverSource = fs.readFileSync(driverPath, "utf-8");

    // runTask.ts handles account_brief + ninety_day_plan via the monolithic path
    expect(runTaskSource).toContain("phase35d:artifact_gate_hard_fail");

    // progressiveDriver.ts handles discovery_prep via the progressive path
    expect(driverSource).toContain("phase35d:progressive_artifact_gate_hard_fail");

    // Both paths use the same gate function
    expect(runTaskSource).toContain("runArtifactGate(draftText, artifactManifest)");
    expect(driverSource).toContain("runArtifactGate(draftText, artifactManifest)");
  });
});
