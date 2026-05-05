/**
 * Phase 3.7B — Universal Strategy Execution Evidence Contract.
 *
 * Every Strategy execution surface — task pipeline, progressive task,
 * chat artifact, transform, or future — emits this same evidence
 * contract. NO hardcoded task types. Manifest-driven and
 * execution-surface-agnostic.
 *
 * DOES NOT modify: scorer, artifact gate, synthesis, methodologySeeds.
 */

// ═══════════════════════════════════════════════════════════════════
// Execution Surface — the shape of the system that produced output
// ═══════════════════════════════════════════════════════════════════

export type ExecutionSurface =
  | "task"               // Standard task pipeline (account_brief, ninety_day_plan, etc.)
  | "progressive_task"   // Progressive/batched task (discovery_prep progressive mode)
  | "chat_artifact"      // Strategy chat generating an artifact
  | "transform"          // Output transform/formatting path
  | "future";            // Placeholder for surfaces not yet implemented

// ═══════════════════════════════════════════════════════════════════
// Telemetry Blocks — each is optional depending on surface capability
// ═══════════════════════════════════════════════════════════════════

export interface EvidencePlannerTelemetry {
  plan_hash: string;
  term_seeds_count: number;
  methodology_seeds_injected: boolean;
  scopes: string[];
}

export interface EvidenceRetrievalTelemetry {
  ki_count: number;
  playbook_count: number;
  content_chars: number;
  source_mode: string;
}

export interface EvidenceArtifactGateTelemetry {
  pass: boolean;
  failed_dimensions: string[];
  regen_attempts: number;
  regen_success: boolean;
  total_gate_latency_ms: number;
}

export interface EvidencePerformanceTelemetry {
  total_latency_ms: number;
  generation_latency_ms?: number;
  gate_latency_ms?: number;
  regen_latency_ms?: number;
}

export interface EvidenceAnomalyFlags {
  regen_triggered?: boolean;
  artifact_failure?: boolean;
  weak_retrieval?: boolean;
  latency_violation?: boolean;
  db_retry_needed?: boolean;
  [key: string]: boolean | undefined;
}

// ═══════════════════════════════════════════════════════════════════
// Telemetry Requirements — per-surface declaration of what MUST exist
// ═══════════════════════════════════════════════════════════════════

export interface TelemetryRequirements {
  planner: boolean;
  retrieval: boolean;
  artifact_gate: boolean;
  performance: boolean;
  anomaly_flags: boolean;
  output_present: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Core Evidence Contract — emitted by every Strategy surface
// ═══════════════════════════════════════════════════════════════════

export interface StrategyExecutionEvidence {
  // ── Identity ───────────────────────────────────────────────────
  execution_surface: ExecutionSurface;
  manifest_id: string;           // SkillManifest.id or skill identifier
  run_id?: string;               // task_runs.id
  thread_id?: string;            // strategy_threads.id
  message_id?: string;           // strategy_messages.id

  // ── Output ─────────────────────────────────────────────────────
  output_shape: "structured_artifact" | "prose" | "list" | "chat_message" | "none";
  output_present: boolean;
  final_status: "completed" | "failed" | "partial" | "pending";

  // ── Telemetry blocks (null = not applicable for this surface) ──
  planner: EvidencePlannerTelemetry | null;
  retrieval: EvidenceRetrievalTelemetry | null;
  artifact_gate: EvidenceArtifactGateTelemetry | null;
  performance: EvidencePerformanceTelemetry | null;
  anomaly_flags: EvidenceAnomalyFlags | null;
  failure_patterns: Record<string, number> | null;

  // ── Metadata ───────────────────────────────────────────────────
  created_at: string;
  captured_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Surface Registration — manifest-driven, auto-inherited
// ═══════════════════════════════════════════════════════════════════

export interface RegisteredSurface {
  surface: ExecutionSurface;
  manifest_id: string;
  label: string;
  telemetry_requirements: TelemetryRequirements;
  /** If true, release gate skips this surface with a documented reason. */
  deferred: boolean;
  deferral_reason?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Evidence Validation — deterministic, pure
// ═══════════════════════════════════════════════════════════════════

export interface EvidenceValidationResult {
  valid: boolean;
  surface: string;
  manifest_id: string;
  missing_fields: string[];
  unmet_requirements: string[];
}

/**
 * Validate evidence against a registered surface's telemetry requirements.
 * Pure function — no IO, no side effects.
 */
export function validateEvidence(
  evidence: StrategyExecutionEvidence,
  requirements: TelemetryRequirements,
): EvidenceValidationResult {
  const missing: string[] = [];
  const unmet: string[] = [];

  if (requirements.planner && !evidence.planner) {
    unmet.push("planner telemetry required but absent");
  }
  if (requirements.retrieval && !evidence.retrieval) {
    unmet.push("retrieval telemetry required but absent");
  }
  if (requirements.artifact_gate && !evidence.artifact_gate) {
    unmet.push("artifact_gate telemetry required but absent");
  }
  if (requirements.performance && !evidence.performance) {
    unmet.push("performance telemetry required but absent");
  }
  if (requirements.anomaly_flags && !evidence.anomaly_flags) {
    unmet.push("anomaly_flags required but absent");
  }
  if (requirements.output_present && !evidence.output_present) {
    // Only an unmet requirement for completed runs
    if (evidence.final_status === "completed") {
      unmet.push("output required for completed run but absent");
    }
  }

  // Structural validation of present blocks
  if (evidence.planner) {
    if (!evidence.planner.plan_hash) missing.push("planner.plan_hash");
    if (!Array.isArray(evidence.planner.scopes)) missing.push("planner.scopes");
  }
  if (evidence.artifact_gate) {
    if (evidence.artifact_gate.pass === undefined) missing.push("artifact_gate.pass");
    if (!Array.isArray(evidence.artifact_gate.failed_dimensions)) missing.push("artifact_gate.failed_dimensions");
  }
  if (evidence.performance) {
    if (evidence.performance.total_latency_ms === undefined) missing.push("performance.total_latency_ms");
  }

  return {
    valid: missing.length === 0 && unmet.length === 0,
    surface: evidence.execution_surface,
    manifest_id: evidence.manifest_id,
    missing_fields: missing,
    unmet_requirements: unmet,
  };
}
