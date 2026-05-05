/**
 * Phase 4 — Evidence Adapters.
 *
 * Transform existing telemetry shapes (task_runs.meta, chat messages,
 * strategy_outputs, transform results) into the universal
 * StrategyExecutionEvidence contract.
 *
 * Each adapter is surface-specific but the output is universal.
 * No hardcoded task types — adapters use manifest_id from the registry.
 *
 * DOES NOT modify: scorer, artifact gate, synthesis, methodologySeeds.
 */

import type { StrategyExecutionEvidence } from "./evidenceContract";
import { taskTypeToManifestId } from "./surfaceRegistry";

// ═══════════════════════════════════════════════════════════════════
// Task Pipeline Adapter — converts task_runs rows to evidence
// ═══════════════════════════════════════════════════════════════════

export interface TaskRunRow {
  id: string;
  task_type: string;
  status: string;
  draft_output: unknown | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  thread_id?: string | null;
  error?: string | null;
}

/**
 * Convert a task_runs DB row into StrategyExecutionEvidence.
 * Works for both "task" and "progressive_task" surfaces.
 */
export function adaptTaskRun(row: TaskRunRow): StrategyExecutionEvidence {
  const meta = row.meta || {};
  const manifestId = taskTypeToManifestId(row.task_type);

  // Determine execution surface from task behavior
  // Progressive tasks write meta.progressive; standard tasks don't
  const isProgressive = !!(meta as any)?.progressive;

  const planner = meta.planner as StrategyExecutionEvidence["planner"] | undefined;
  const artifactGate = meta.artifact_gate as StrategyExecutionEvidence["artifact_gate"] | undefined;
  const performance = meta.performance as StrategyExecutionEvidence["performance"] | undefined;
  const anomalyFlags = meta.anomaly_flags as StrategyExecutionEvidence["anomaly_flags"] | undefined;
  const failurePatterns = meta.failure_patterns as Record<string, number> | undefined;

  return {
    execution_surface: isProgressive ? "progressive_task" : "task",
    manifest_id: manifestId,
    run_id: row.id,
    thread_id: row.thread_id ?? undefined,

    output_shape: row.draft_output ? "structured_artifact" : "none",
    output_present: !!row.draft_output,
    final_status: mapStatus(row.status),

    planner: planner ?? null,
    retrieval: extractRetrievalTelemetry(meta),
    artifact_gate: artifactGate ?? null,
    performance: performance ?? null,
    anomaly_flags: anomalyFlags ?? null,
    failure_patterns: failurePatterns ?? null,

    created_at: row.created_at,
    captured_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Chat Artifact Adapter — converts strategy_messages to evidence
// ═══════════════════════════════════════════════════════════════════

export interface ChatMessageRow {
  id: string;
  thread_id: string;
  content_json: Record<string, unknown> | null;
  message_type?: string | null;
  manifest_id?: string | null;
  created_at: string;
  latency_ms?: number | null;
  provider_used?: string | null;
  model_used?: string | null;
}

/**
 * Convert a strategy_messages row (with artifact content) to evidence.
 * Chat messages already persist routing_decision, retrieval_meta,
 * gate_check, calibration, and latency_ms in content_json.
 */
export function adaptChatArtifact(
  row: ChatMessageRow,
  manifestId: string,
): StrategyExecutionEvidence {
  const contentJson = row.content_json || {};
  const routingDecision = contentJson.routing_decision as Record<string, unknown> | undefined;
  const retrievalMeta = contentJson.retrieval_meta as Record<string, unknown> | undefined;
  const gateCheck = contentJson.gate_check as Record<string, unknown> | undefined;

  // Extract retrieval telemetry from routing_decision or retrieval_meta
  let retrieval: StrategyExecutionEvidence["retrieval"] = null;
  if (routingDecision) {
    retrieval = {
      ki_count: (routingDecision.ki_hits as number) ?? 0,
      playbook_count: 0,
      content_chars: (routingDecision.content_chars as number) ?? 0,
      source_mode: (routingDecision.source_mode as string) ?? "library_first",
    };
  } else if (retrievalMeta) {
    retrieval = {
      ki_count: (retrievalMeta.ki_count as number) ?? (retrievalMeta.ki_hits as number) ?? 0,
      playbook_count: (retrievalMeta.playbook_count as number) ?? 0,
      content_chars: (retrievalMeta.content_chars as number) ?? 0,
      source_mode: (retrievalMeta.source_mode as string) ?? "library_first",
    };
  }

  // Extract performance from latency_ms
  const performance: StrategyExecutionEvidence["performance"] = row.latency_ms
    ? { total_latency_ms: row.latency_ms }
    : null;

  // Extract anomaly flags from gate_check or routing_decision
  let anomalyFlags: StrategyExecutionEvidence["anomaly_flags"] = null;
  if (gateCheck || routingDecision) {
    anomalyFlags = {
      weak_retrieval: retrieval ? retrieval.ki_count === 0 : undefined,
      latency_violation: row.latency_ms ? row.latency_ms > 30000 : undefined,
    };
  }

  return {
    execution_surface: "chat_artifact",
    manifest_id: manifestId,
    message_id: row.id,
    thread_id: row.thread_id,

    output_shape: "chat_message",
    output_present: !!(contentJson.text || contentJson.content),
    final_status: "completed",

    planner: null, // Chat uses routing_decision, not a planner block
    retrieval,
    artifact_gate: null, // Chat uses inline citation audit, not artifact gate
    performance,
    anomaly_flags: anomalyFlags,
    failure_patterns: null,

    created_at: row.created_at,
    captured_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Transform Output Adapter — converts strategy_outputs to evidence
// ═══════════════════════════════════════════════════════════════════

export interface TransformOutputRow {
  id: string;
  thread_id: string | null;
  output_type: string;
  content_json: Record<string, unknown> | null;
  rendered_text: string | null;
  manifest_id?: string | null;
  created_at: string;
  latency_ms?: number | null;
  provider_used?: string | null;
  model_used?: string | null;
}

/**
 * Convert a strategy_outputs or DOCX render result into evidence.
 * Transform outputs re-render existing artifacts — they carry
 * performance telemetry but no planner/retrieval/gate.
 */
export function adaptTransformOutput(
  row: TransformOutputRow,
  manifestId: string,
): StrategyExecutionEvidence {
  const contentJson = row.content_json || {};
  const hasOutput = !!(row.rendered_text || Object.keys(contentJson).length > 0);

  return {
    execution_surface: "transform",
    manifest_id: manifestId,
    run_id: row.id,
    thread_id: row.thread_id ?? undefined,

    output_shape: row.rendered_text ? "prose" : "structured_artifact",
    output_present: hasOutput,
    final_status: hasOutput ? "completed" : "failed",

    planner: null,        // Transforms re-render, no planning
    retrieval: null,      // No retrieval on transforms
    artifact_gate: null,  // No quality gate on re-renders
    performance: row.latency_ms
      ? { total_latency_ms: row.latency_ms }
      : null,
    anomaly_flags: null,
    failure_patterns: null,

    created_at: row.created_at,
    captured_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function mapStatus(dbStatus: string): StrategyExecutionEvidence["final_status"] {
  switch (dbStatus) {
    case "completed": return "completed";
    case "failed": return "failed";
    case "pending":
    case "running": return "pending";
    default: return "partial";
  }
}

function extractRetrievalTelemetry(
  meta: Record<string, unknown>,
): StrategyExecutionEvidence["retrieval"] {
  // The planner block sometimes carries retrieval counts
  const libraryCounts = meta.library_counts as Record<string, number> | undefined;

  if (libraryCounts) {
    return {
      ki_count: libraryCounts.kis ?? 0,
      playbook_count: libraryCounts.playbooks ?? 0,
      content_chars: libraryCounts.content_chars ?? 0,
      source_mode: (meta.source_mode as string) ?? "library_required",
    };
  }

  // Progressive tasks store counts in meta.progressive
  const progressive = meta.progressive as Record<string, unknown> | undefined;
  const progCounts = progressive?.library_counts ?? progressive?.libraryCounts;
  if (progCounts) {
    const lc = progCounts as Record<string, number>;
    return {
      ki_count: lc.kis ?? 0,
      playbook_count: lc.playbooks ?? 0,
      content_chars: lc.content_chars ?? 0,
      source_mode: "library_required",
    };
  }

  return null;
}
