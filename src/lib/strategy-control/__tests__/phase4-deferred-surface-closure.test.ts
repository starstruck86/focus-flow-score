/**
 * Phase 4 — Deferred Surface Closure Tests.
 *
 * Proves:
 * 1. Zero deferred surfaces remain in registry
 * 2. All chat artifact surfaces have working adapters
 * 3. Transform surface has a working adapter
 * 4. New surfaces cannot be added without registry coverage
 * 5. Evidence runner enforces all surfaces (no free passes)
 * 6. Adapters produce valid evidence for every enforced surface type
 */

import { describe, it, expect } from "vitest";
import {
  validateEvidence,
  type StrategyExecutionEvidence,
} from "../evidenceContract";
import {
  getAllSurfaces,
  getEnforcedSurfaces,
  getDeferredSurfaces,
  findSurface,
  requireRegistration,
  STRATEGY_SURFACE_REGISTRY,
} from "../surfaceRegistry";
import {
  adaptChatArtifact,
  adaptTransformOutput,
  adaptTaskRun,
  type ChatMessageRow,
  type TransformOutputRow,
  type TaskRunRow,
} from "../evidenceAdapters";
import {
  runUniversalEvidenceCheck,
  validateSingleEvidence,
} from "../evidenceRunner";

// ═══════════════════════════════════════════════════════════════════
// Phase 4 Core Invariant: Zero Deferrals
// ═══════════════════════════════════════════════════════════════════

describe("Phase 4 — Zero Deferrals", () => {
  it("has zero deferred surfaces", () => {
    const deferred = getDeferredSurfaces();
    expect(deferred).toHaveLength(0);
  });

  it("all registered surfaces are enforced", () => {
    const all = getAllSurfaces();
    const enforced = getEnforcedSurfaces();
    expect(enforced.length).toBe(all.length);
    expect(enforced.length).toBeGreaterThanOrEqual(12);
  });

  it("every surface has telemetry_requirements defined", () => {
    for (const s of getAllSurfaces()) {
      expect(s.telemetry_requirements).toBeDefined();
      expect(typeof s.telemetry_requirements.output_present).toBe("boolean");
      expect(typeof s.telemetry_requirements.performance).toBe("boolean");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Chat Artifact Adapter Coverage
// ═══════════════════════════════════════════════════════════════════

const CHAT_MANIFEST_IDS = [
  "conversation-pov",
  "commercial-insight",
  "account-research",
  "discovery-questions",
  "meddicc-review",
  "demo-strategy",
  "follow-up-email",
  "objection-strategy",
];

function makeChatRow(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: "msg-001",
    thread_id: "thread-001",
    created_at: new Date().toISOString(),
    latency_ms: 8500,
    provider_used: "openai",
    model_used: "gpt-4o",
    content_json: {
      text: "Here is your conversation POV...",
      routing_decision: {
        ki_hits: 12,
        content_chars: 4200,
        source_mode: "library_first",
      },
      gate_check: { passed: true },
    },
    ...overrides,
  };
}

describe("Phase 4 — Chat Artifact Adapters", () => {
  for (const manifestId of CHAT_MANIFEST_IDS) {
    it(`adaptChatArtifact produces valid evidence for ${manifestId}`, () => {
      const row = makeChatRow();
      const evidence = adaptChatArtifact(row, manifestId);

      expect(evidence.execution_surface).toBe("chat_artifact");
      expect(evidence.manifest_id).toBe(manifestId);
      expect(evidence.output_present).toBe(true);
      expect(evidence.final_status).toBe("completed");

      // Validate against registered requirements
      const surface = findSurface(manifestId);
      expect(surface).toBeDefined();
      const result = validateEvidence(evidence, surface!.telemetry_requirements);
      expect(result.valid).toBe(true);
      expect(result.missing_fields).toHaveLength(0);
      expect(result.unmet_requirements).toHaveLength(0);
    });
  }

  it("extracts retrieval from routing_decision", () => {
    const row = makeChatRow();
    const evidence = adaptChatArtifact(row, "conversation-pov");
    expect(evidence.retrieval).not.toBeNull();
    expect(evidence.retrieval!.ki_count).toBe(12);
    expect(evidence.retrieval!.content_chars).toBe(4200);
  });

  it("extracts retrieval from retrieval_meta fallback", () => {
    const row = makeChatRow({
      content_json: {
        text: "output",
        retrieval_meta: { ki_count: 5, playbook_count: 2, content_chars: 1000 },
      },
    });
    const evidence = adaptChatArtifact(row, "conversation-pov");
    expect(evidence.retrieval).not.toBeNull();
    expect(evidence.retrieval!.ki_count).toBe(5);
    expect(evidence.retrieval!.playbook_count).toBe(2);
  });

  it("extracts performance from latency_ms", () => {
    const row = makeChatRow({ latency_ms: 12000 });
    const evidence = adaptChatArtifact(row, "conversation-pov");
    expect(evidence.performance).not.toBeNull();
    expect(evidence.performance!.total_latency_ms).toBe(12000);
  });

  it("flags weak_retrieval anomaly when ki_count is 0", () => {
    const row = makeChatRow({
      content_json: {
        text: "output",
        routing_decision: { ki_hits: 0, content_chars: 0 },
        gate_check: {},
      },
    });
    const evidence = adaptChatArtifact(row, "conversation-pov");
    expect(evidence.anomaly_flags).not.toBeNull();
    expect(evidence.anomaly_flags!.weak_retrieval).toBe(true);
  });

  it("output_present is false when content_json has no text", () => {
    const row = makeChatRow({ content_json: {} });
    const evidence = adaptChatArtifact(row, "conversation-pov");
    expect(evidence.output_present).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Transform Output Adapter Coverage
// ═══════════════════════════════════════════════════════════════════

function makeTransformRow(overrides: Partial<TransformOutputRow> = {}): TransformOutputRow {
  return {
    id: "output-001",
    thread_id: "thread-001",
    output_type: "brief",
    created_at: new Date().toISOString(),
    latency_ms: 2500,
    content_json: { sections: ["intro", "body"] },
    rendered_text: "# Account Brief\n\nContent here...",
    ...overrides,
  };
}

describe("Phase 4 — Transform Output Adapter", () => {
  it("adaptTransformOutput produces valid evidence for docx-render", () => {
    const row = makeTransformRow();
    const evidence = adaptTransformOutput(row, "docx-render");

    expect(evidence.execution_surface).toBe("transform");
    expect(evidence.manifest_id).toBe("docx-render");
    expect(evidence.output_present).toBe(true);
    expect(evidence.final_status).toBe("completed");

    const surface = findSurface("docx-render");
    expect(surface).toBeDefined();
    const result = validateEvidence(evidence, surface!.telemetry_requirements);
    expect(result.valid).toBe(true);
  });

  it("extracts performance from latency_ms", () => {
    const row = makeTransformRow({ latency_ms: 3000 });
    const evidence = adaptTransformOutput(row, "docx-render");
    expect(evidence.performance!.total_latency_ms).toBe(3000);
  });

  it("marks failed when no output exists", () => {
    const row = makeTransformRow({ rendered_text: null, content_json: {} });
    const evidence = adaptTransformOutput(row, "docx-render");
    expect(evidence.output_present).toBe(false);
    expect(evidence.final_status).toBe("failed");
  });

  it("planner/retrieval/artifact_gate are null for transforms", () => {
    const evidence = adaptTransformOutput(makeTransformRow(), "docx-render");
    expect(evidence.planner).toBeNull();
    expect(evidence.retrieval).toBeNull();
    expect(evidence.artifact_gate).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Registry Completeness — No Surface Can Bypass
// ═══════════════════════════════════════════════════════════════════

describe("Phase 4 — Registry Enforcement", () => {
  it("requireRegistration throws for unregistered surface", () => {
    expect(() => requireRegistration("fake-surface-xyz")).toThrow(
      /not registered/
    );
  });

  it("all skill manifests have registered surfaces", () => {
    const manifestFiles = [
      "conversation-pov",
      "commercial-insight",
      "account-research",
      "discovery-questions",
      "meddicc-review",
      "demo-strategy",
      "follow-up-email",
      "objection-strategy",
      "executive-brief",
      "ninety-day-plan",
      "discovery-prep",
    ];
    for (const id of manifestFiles) {
      expect(findSurface(id)).toBeDefined();
    }
  });

  it("docx-render transform is registered", () => {
    expect(findSurface("docx-render")).toBeDefined();
    expect(findSurface("docx-render")!.surface).toBe("transform");
  });

  it("every registered surface has a unique manifest_id", () => {
    const ids = STRATEGY_SURFACE_REGISTRY.map(s => s.manifest_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Evidence Runner — Full Coverage Required
// ═══════════════════════════════════════════════════════════════════

describe("Phase 4 — Evidence Runner Enforces All Surfaces", () => {
  it("fails when any enforced surface lacks evidence", () => {
    // Provide evidence only for task surfaces, not chat or transform
    const partial = new Map<string, StrategyExecutionEvidence[]>();
    partial.set("executive-brief", [
      adaptTaskRun({
        id: "run-1", task_type: "account_brief", status: "failed",
        draft_output: null, created_at: new Date().toISOString(),
        meta: { planner: { plan_hash: "h", term_seeds_count: 3, methodology_seeds_injected: true, scopes: ["a"] },
          artifact_gate: { pass: false, failed_dimensions: ["x"], regen_attempts: 0, regen_success: false, total_gate_latency_ms: 100 },
          performance: { total_latency_ms: 5000 },
          anomaly_flags: { artifact_failure: true } },
      }),
    ]);

    const report = runUniversalEvidenceCheck(partial);
    expect(report.pass).toBe(false);
    // Should have failures for every surface without evidence
    expect(report.failures.length).toBeGreaterThanOrEqual(11);
  });

  it("passes when all enforced surfaces have valid evidence", () => {
    const all = new Map<string, StrategyExecutionEvidence[]>();

    // Task surfaces
    for (const taskType of ["account_brief", "ninety_day_plan", "discovery_prep"]) {
      const manifestId = taskType === "account_brief" ? "executive-brief"
        : taskType === "ninety_day_plan" ? "ninety-day-plan" : "discovery-prep";
      all.set(manifestId, [
        adaptTaskRun({
          id: `run-${taskType}`, task_type: taskType, status: "failed",
          draft_output: null, created_at: new Date().toISOString(),
          meta: {
            planner: { plan_hash: "h", term_seeds_count: 3, methodology_seeds_injected: true, scopes: ["a"] },
            artifact_gate: { pass: false, failed_dimensions: ["x"], regen_attempts: 0, regen_success: false, total_gate_latency_ms: 100 },
            performance: { total_latency_ms: 5000 },
            anomaly_flags: { artifact_failure: true },
          },
        }),
      ]);
    }

    // Chat artifact surfaces
    for (const mid of CHAT_MANIFEST_IDS) {
      all.set(mid, [adaptChatArtifact(makeChatRow(), mid)]);
    }

    // Transform surface
    all.set("docx-render", [adaptTransformOutput(makeTransformRow(), "docx-render")]);

    const report = runUniversalEvidenceCheck(all);
    expect(report.pass).toBe(true);
    expect(report.failures).toHaveLength(0);
    expect(report.covered_surfaces).toBe(report.enforced_surfaces);
    expect(report.deferred_surfaces).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Adapter Universality — validateSingleEvidence
// ═══════════════════════════════════════════════════════════════════

describe("Phase 4 — validateSingleEvidence for all surface types", () => {
  it("validates task evidence", () => {
    const evidence = adaptTaskRun({
      id: "r1", task_type: "account_brief", status: "failed",
      draft_output: null, created_at: new Date().toISOString(),
      meta: {
        planner: { plan_hash: "h", term_seeds_count: 1, methodology_seeds_injected: false, scopes: ["x"] },
        artifact_gate: { pass: false, failed_dimensions: [], regen_attempts: 0, regen_success: false, total_gate_latency_ms: 50 },
        performance: { total_latency_ms: 3000 },
        anomaly_flags: {},
        library_counts: { kis: 10, playbooks: 2, content_chars: 5000 },
      },
    });
    const result = validateSingleEvidence(evidence);
    expect(result.valid).toBe(true);
  });

  it("validates chat artifact evidence", () => {
    const evidence = adaptChatArtifact(makeChatRow(), "conversation-pov");
    const result = validateSingleEvidence(evidence);
    expect(result.valid).toBe(true);
  });

  it("validates transform evidence", () => {
    const evidence = adaptTransformOutput(makeTransformRow(), "docx-render");
    const result = validateSingleEvidence(evidence);
    expect(result.valid).toBe(true);
  });

  it("rejects unregistered manifest_id", () => {
    const evidence = adaptTransformOutput(makeTransformRow(), "unknown-surface");
    const result = validateSingleEvidence(evidence);
    expect(result.valid).toBe(false);
    expect(result.unmet_requirements.some(r => r.includes("not registered"))).toBe(true);
  });
});
