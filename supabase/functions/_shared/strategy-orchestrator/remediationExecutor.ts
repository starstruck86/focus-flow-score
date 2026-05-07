/**
 * Phase 4F — Server-Side Targeted Remediation Executor
 *
 * Runs AFTER the standard regen attempt fails. Feature-flagged via
 * STRATEGY_TARGETED_REMEDIATION env var (default: off).
 *
 * Phase 4F guardrails:
 *  - MAX_REMEDIATION_ATTEMPTS = 1 (no retries)
 *  - MAX_REMEDIATION_COST_USD = 0.05
 *  - REMEDIATION_ALLOWED_TASKS = ['account_brief'] only
 *  - Hard-disable for: discovery_prep, 3+ failed dims, provider_timeout, >10m latency
 *  - Only normalize_only enabled in rollout (zero-cost, no LLM)
 *
 * Rules:
 *  - Gate ALWAYS re-runs after remediation
 *  - Does NOT weaken gates or bypass artifact gate
 *  - Does NOT change behavior when flag is off
 */

import { normalizeParagraphs } from "./normalizeParagraphs.ts";
import {
  runArtifactGate,
  type ArtifactGateResult,
  type ArtifactManifest,
} from "./artifactGateEnforcement.ts";
import { callOpenAI, safeParseJSON } from "./providers.ts";
import type { TelemetryCollector } from "./telemetryWriter.ts";

// ── Types ──────────────────────────────────────────────────────────

export type RemediationType =
  | "normalize_only"
  | "section_reauthor"
  | "evidence_rewrite"
  | "provider_retry"
  | "skip_too_many_dimensions";

export interface RemediationTelemetry {
  remediation_attempted: boolean;
  remediation_type: RemediationType | null;
  remediation_success: boolean;
  remediation_latency_ms: number;
  remediation_cost_estimate_usd: number;
  avoided_full_regen_estimate_usd: number;
  sections_targeted: string[];
  fallback_to_hard_fail: boolean;
  skip_reason: string | null;
  before_failed_dimensions: string[];
  after_failed_dimensions: string[];
  before_sections_failed: string[];
  after_sections_failed: string[];
  error?: string;
}

export interface RemediationResult {
  success: boolean;
  draftOutput: any;
  gateResult: ArtifactGateResult;
  telemetry: RemediationTelemetry;
}

// ── Phase 4F: Rollout guardrails ──────────────────────────────────

const MAX_REMEDIATION_ATTEMPTS = 1;
const MAX_REMEDIATION_COST_USD = 0.05;
const REMEDIATION_ALLOWED_TASKS: readonly string[] = ["account_brief"];

/** Phase 4F rollout: only normalize_only is enabled (zero-cost, no LLM). */
const ROLLOUT_ALLOWED_TYPES: readonly RemediationType[] = ["normalize_only"];

// ── Feature flag ───────────────────────────────────────────────────

export function isRemediationEnabled(): boolean {
  try {
    return (Deno.env.get("STRATEGY_TARGETED_REMEDIATION") ?? "false")
      .toLowerCase() === "true";
  } catch {
    return false;
  }
}

// ── Cost estimates ─────────────────────────────────────────────────

const AVG_FULL_REGEN_COST = 0.16;
const REMEDIATION_COSTS: Record<RemediationType, number> = {
  normalize_only: 0.0,
  section_reauthor: 0.02,
  evidence_rewrite: 0.015,
  provider_retry: 0.10,
  skip_too_many_dimensions: 0.0,
};

// ── Guardrail check ───────────────────────────────────────────────

export interface GuardrailCheckResult {
  allowed: boolean;
  skip_reason: string | null;
}

export function checkGuardrails(
  taskType: string,
  failedDimensions: string[],
  remediationType: RemediationType,
  pipelineLatencyMs?: number,
): GuardrailCheckResult {
  // 1. Task type not in allowed list
  if (!REMEDIATION_ALLOWED_TASKS.includes(taskType)) {
    return { allowed: false, skip_reason: `task_type_not_allowed:${taskType}` };
  }

  // 2. discovery_prep always hard-disabled
  if (taskType === "discovery_prep") {
    return { allowed: false, skip_reason: "discovery_prep_hard_disabled" };
  }

  // 3. 3+ failed dimensions
  if (failedDimensions.length >= 3) {
    return { allowed: false, skip_reason: "too_many_dimensions" };
  }

  // 4. Provider timeout among failures
  // (we detect this via the remediation type classification)
  if (remediationType === "provider_retry") {
    return { allowed: false, skip_reason: "provider_timeout_hard_disabled" };
  }

  // 5. Pipeline already exceeded 10m
  if (pipelineLatencyMs != null && pipelineLatencyMs > 600_000) {
    return { allowed: false, skip_reason: "pipeline_latency_exceeds_10m" };
  }

  // 6. Cost cap
  const estCost = REMEDIATION_COSTS[remediationType] ?? 0;
  if (estCost > MAX_REMEDIATION_COST_USD) {
    return { allowed: false, skip_reason: `cost_exceeds_cap:${estCost}>${MAX_REMEDIATION_COST_USD}` };
  }

  // 7. Phase 4F rollout: only normalize_only allowed
  if (!ROLLOUT_ALLOWED_TYPES.includes(remediationType)) {
    return { allowed: false, skip_reason: `remediation_type_not_in_rollout:${remediationType}` };
  }

  return { allowed: true, skip_reason: null };
}

// ── Classify failure → remediation type ────────────────────────────

export function classifyRemediation(
  failedDimensions: string[],
): RemediationType {
  if (failedDimensions.length >= 3) return "skip_too_many_dimensions";

  if (failedDimensions.length === 1) {
    const dim = failedDimensions[0];
    if (dim === "readability") return "normalize_only";
    if (dim === "template_fidelity" || dim === "section_completeness") return "section_reauthor";
    if (dim === "evidence_discipline") return "evidence_rewrite";
  }

  if (failedDimensions.length === 2) {
    const hasReadability = failedDimensions.includes("readability");
    const hasFidelity = failedDimensions.includes("template_fidelity");
    const hasCompleteness = failedDimensions.includes("section_completeness");
    const hasEvidence = failedDimensions.includes("evidence_discipline");

    if (hasReadability && (hasFidelity || hasCompleteness)) return "section_reauthor";
    if (hasReadability && hasEvidence) return "evidence_rewrite";
    if (hasFidelity || hasCompleteness) return "section_reauthor";
    if (hasEvidence) return "evidence_rewrite";
  }

  return "skip_too_many_dimensions";
}

// ── Remediation executors ──────────────────────────────────────────

function executeNormalizeOnly(
  draftOutput: any,
): { draftOutput: any; draftText: string } {
  const rawText = typeof draftOutput === "string"
    ? draftOutput
    : JSON.stringify(draftOutput);

  const { text: normalizedText } = normalizeParagraphs(rawText);

  let newDraft = draftOutput;
  try {
    const parsed = JSON.parse(normalizedText);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.sections)) {
      newDraft = parsed;
    }
  } catch { /* keep original if not JSON */ }

  return { draftOutput: newDraft, draftText: normalizedText };
}

async function executeSectionReauthor(
  draftOutput: any,
  gateResult: ArtifactGateResult,
  manifest: ArtifactManifest,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ draftOutput: any; draftText: string }> {
  const failedSections = gateResult.sections_failed ?? [];
  if (failedSections.length === 0) {
    throw new Error("section_reauthor: no specific sections identified to fix");
  }

  const sectionList = failedSections.join(", ");
  const diagnosticDetails = (gateResult.diagnostics ?? [])
    .filter(d => failedSections.some(s =>
      d.requirement.toLowerCase().includes(s.toLowerCase()) ||
      s.toLowerCase().includes(d.requirement.toLowerCase())
    ))
    .map(d => `- [${d.dimension}] "${d.requirement}": ${d.reason}`)
    .join("\n");

  const reauthorPrompt = [
    { role: "system", content: `${systemPrompt}\n\nIMPORTANT: You are performing a TARGETED REPAIR. Only rewrite the following sections that failed quality gates: ${sectionList}\n\nDiagnostics:\n${diagnosticDetails}\n\nReturn the COMPLETE document JSON with all sections. Keep passing sections UNCHANGED. Only fix the failing sections listed above.` },
    { role: "user", content: userPrompt },
  ];

  const result = await callOpenAI(reauthorPrompt, {
    model: "gpt-5-mini",
    maxTokens: 12000,
  });

  const parsed = safeParseJSON<any>(result);
  if (!parsed || !Array.isArray(parsed?.sections)) {
    throw new Error("section_reauthor: model returned invalid JSON");
  }

  const mergedSections = [...(draftOutput.sections || [])];
  for (const newSection of parsed.sections) {
    const sectionId = newSection.id || newSection.name || newSection.heading || "";
    const normId = sectionId.toLowerCase().replace(/[^a-z0-9]/g, "");

    const isTargeted = failedSections.some(f =>
      f.toLowerCase().replace(/[^a-z0-9]/g, "") === normId ||
      normId.includes(f.toLowerCase().replace(/[^a-z0-9]/g, ""))
    );

    if (isTargeted) {
      const existingIdx = mergedSections.findIndex((s: any) => {
        const existId = (s.id || s.name || s.heading || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return existId === normId;
      });
      if (existingIdx >= 0) {
        mergedSections[existingIdx] = newSection;
      } else {
        mergedSections.push(newSection);
      }
    }
  }

  const newDraft = { ...draftOutput, sections: mergedSections };
  const { text: normalizedText } = normalizeParagraphs(JSON.stringify(newDraft));

  return { draftOutput: newDraft, draftText: normalizedText };
}

async function executeEvidenceRewrite(
  draftOutput: any,
  gateResult: ArtifactGateResult,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ draftOutput: any; draftText: string }> {
  const evidenceDiags = (gateResult.diagnostics ?? [])
    .filter(d => d.dimension === "evidence_discipline")
    .map(d => `- ${d.requirement}: ${d.reason}`)
    .join("\n");

  const rewritePrompt = [
    { role: "system", content: `${systemPrompt}\n\nIMPORTANT: You are performing a TARGETED EVIDENCE REPAIR. The document structure and sections are correct, but the following evidence/citation issues were found:\n${evidenceDiags}\n\nFix ONLY the citation and causal reasoning issues. Every citation [KI:...], [PB:...], [SRC:...] must have causal reasoning within ±2 sentences (because, therefore, resulting in, etc.). Do NOT change section structure. Return the COMPLETE document JSON.` },
    { role: "user", content: userPrompt },
  ];

  const result = await callOpenAI(rewritePrompt, {
    model: "gpt-5-mini",
    maxTokens: 12000,
  });

  const parsed = safeParseJSON<any>(result);
  if (!parsed || !Array.isArray(parsed?.sections)) {
    throw new Error("evidence_rewrite: model returned invalid JSON");
  }

  const { text: normalizedText } = normalizeParagraphs(JSON.stringify(parsed));

  return { draftOutput: parsed, draftText: normalizedText };
}

// ── Main entry point ───────────────────────────────────────────────

export interface RemediationContext {
  runId: string;
  taskType: string;
  draftOutput: any;
  gateResult: ArtifactGateResult;
  manifest: ArtifactManifest;
  systemPrompt: string;
  userPrompt: string;
  telemetryCollector: TelemetryCollector;
  supabase: any;
  /** Pipeline start timestamp for latency guardrail */
  pipelineStartMs?: number;
}

/**
 * Attempt targeted remediation on a failed artifact gate result.
 *
 * Returns null if remediation is disabled or not applicable.
 * Returns RemediationResult with success=true if gate passes after remediation.
 * Returns RemediationResult with success=false if remediation fails.
 */
export async function attemptRemediation(
  ctx: RemediationContext,
): Promise<RemediationResult | null> {
  if (!isRemediationEnabled()) return null;

  const startMs = Date.now();
  const { runId, taskType, draftOutput, gateResult, manifest, systemPrompt, userPrompt, telemetryCollector, pipelineStartMs } = ctx;

  const beforeFailedDimensions = [...gateResult.failed_dimensions];
  const beforeSectionsFailed = [...(gateResult.sections_failed ?? [])];

  const remediationType = classifyRemediation(gateResult.failed_dimensions);

  // ── Phase 4F: Guardrail check ─────────────────────────────────
  const pipelineElapsed = pipelineStartMs ? Date.now() - pipelineStartMs : undefined;
  const guardrail = checkGuardrails(taskType, gateResult.failed_dimensions, remediationType, pipelineElapsed);

  if (!guardrail.allowed) {
    const skipTelemetry: RemediationTelemetry = {
      remediation_attempted: false,
      remediation_type: remediationType,
      remediation_success: false,
      remediation_latency_ms: 0,
      remediation_cost_estimate_usd: 0,
      avoided_full_regen_estimate_usd: 0,
      sections_targeted: [],
      fallback_to_hard_fail: true,
      skip_reason: guardrail.skip_reason,
      before_failed_dimensions: beforeFailedDimensions,
      after_failed_dimensions: beforeFailedDimensions,
      before_sections_failed: beforeSectionsFailed,
      after_sections_failed: beforeSectionsFailed,
    };

    // Write skip telemetry row
    telemetryCollector.record("remediation", {
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
      success: false,
      metadata: {
        remediation_type: remediationType,
        skipped: true,
        skip_reason: guardrail.skip_reason,
        before_failed_dimensions: beforeFailedDimensions,
      },
    });

    console.log(JSON.stringify({
      tag: "[phase4f:remediation_guardrail_skip]",
      run_id: runId,
      task_type: taskType,
      skip_reason: guardrail.skip_reason,
      remediation_type: remediationType,
      failed_dimensions: beforeFailedDimensions,
    }));

    return {
      success: false,
      draftOutput,
      gateResult,
      telemetry: skipTelemetry,
    };
  }

  // 3+ dimensions (also caught by guardrails above, but kept for defense)
  if (remediationType === "skip_too_many_dimensions") {
    console.log(JSON.stringify({
      tag: "[phase4f:remediation_skipped]",
      run_id: runId,
      reason: "too_many_dimensions",
      failed_dimensions: gateResult.failed_dimensions,
    }));
    return null;
  }

  console.log(JSON.stringify({
    tag: "[phase4f:remediation_start]",
    run_id: runId,
    type: remediationType,
    task_type: taskType,
    failed_dimensions: gateResult.failed_dimensions,
    sections_targeted: gateResult.sections_failed ?? [],
  }));

  const remTelemetry: RemediationTelemetry = {
    remediation_attempted: true,
    remediation_type: remediationType,
    remediation_success: false,
    remediation_latency_ms: 0,
    remediation_cost_estimate_usd: REMEDIATION_COSTS[remediationType],
    avoided_full_regen_estimate_usd: 0,
    sections_targeted: gateResult.sections_failed ?? [],
    fallback_to_hard_fail: false,
    skip_reason: null,
    before_failed_dimensions: beforeFailedDimensions,
    after_failed_dimensions: [],
    before_sections_failed: beforeSectionsFailed,
    after_sections_failed: [],
  };

  try {
    let repaired: { draftOutput: any; draftText: string };

    switch (remediationType) {
      case "normalize_only":
        repaired = executeNormalizeOnly(draftOutput);
        break;
      case "section_reauthor":
        repaired = await executeSectionReauthor(
          draftOutput, gateResult, manifest, systemPrompt, userPrompt,
        );
        break;
      case "evidence_rewrite":
        repaired = await executeEvidenceRewrite(
          draftOutput, gateResult, systemPrompt, userPrompt,
        );
        break;
      default:
        return null;
    }

    // RE-RUN FULL ARTIFACT GATE — always
    const postGateResult = runArtifactGate(repaired.draftText, manifest);

    remTelemetry.remediation_latency_ms = Date.now() - startMs;
    remTelemetry.after_failed_dimensions = postGateResult.failed_dimensions;
    remTelemetry.after_sections_failed = postGateResult.sections_failed ?? [];

    if (postGateResult.pass) {
      remTelemetry.remediation_success = true;
      remTelemetry.avoided_full_regen_estimate_usd =
        Math.max(0, AVG_FULL_REGEN_COST - REMEDIATION_COSTS[remediationType]);

      telemetryCollector.record("remediation", {
        started_at: new Date(startMs).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: remTelemetry.remediation_latency_ms,
        success: true,
        metadata: {
          remediation_type: remediationType,
          sections_targeted: remTelemetry.sections_targeted,
          cost_estimate_usd: remTelemetry.remediation_cost_estimate_usd,
          avoided_full_regen_usd: remTelemetry.avoided_full_regen_estimate_usd,
          before_failed_dimensions: beforeFailedDimensions,
          after_failed_dimensions: postGateResult.failed_dimensions,
          before_sections_failed: beforeSectionsFailed,
          after_sections_failed: postGateResult.sections_failed ?? [],
          skipped: false,
          skip_reason: null,
        },
      });

      console.log(JSON.stringify({
        tag: "[phase4f:remediation_success]",
        run_id: runId,
        type: remediationType,
        latency_ms: remTelemetry.remediation_latency_ms,
        cost_estimate: remTelemetry.remediation_cost_estimate_usd,
        avoided_regen: remTelemetry.avoided_full_regen_estimate_usd,
        before_dims: beforeFailedDimensions,
        after_dims: postGateResult.failed_dimensions,
      }));

      return {
        success: true,
        draftOutput: repaired.draftOutput,
        gateResult: postGateResult,
        telemetry: remTelemetry,
      };
    }

    // Remediation ran but gate still failed → fall back to hard fail
    remTelemetry.fallback_to_hard_fail = true;
    remTelemetry.error = `Gate still failed after remediation: ${postGateResult.failed_dimensions.join(", ")}`;

    telemetryCollector.record("remediation", {
      started_at: new Date(startMs).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: remTelemetry.remediation_latency_ms,
      success: false,
      error: remTelemetry.error,
      metadata: {
        remediation_type: remediationType,
        sections_targeted: remTelemetry.sections_targeted,
        before_failed_dimensions: beforeFailedDimensions,
        after_failed_dimensions: postGateResult.failed_dimensions,
        skipped: false,
        skip_reason: null,
      },
    });

    console.warn(JSON.stringify({
      tag: "[phase4f:remediation_gate_still_failed]",
      run_id: runId,
      type: remediationType,
      before_dims: beforeFailedDimensions,
      post_gate_failed: postGateResult.failed_dimensions,
    }));

    return {
      success: false,
      draftOutput: draftOutput,
      gateResult: postGateResult,
      telemetry: remTelemetry,
    };

  } catch (e: any) {
    remTelemetry.remediation_latency_ms = Date.now() - startMs;
    remTelemetry.fallback_to_hard_fail = true;
    remTelemetry.error = String(e?.message || e).slice(0, 500);
    remTelemetry.after_failed_dimensions = beforeFailedDimensions;
    remTelemetry.after_sections_failed = beforeSectionsFailed;

    telemetryCollector.record("remediation", {
      started_at: new Date(startMs).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: remTelemetry.remediation_latency_ms,
      success: false,
      error: remTelemetry.error,
      metadata: {
        remediation_type: remediationType,
        skipped: false,
        skip_reason: null,
        before_failed_dimensions: beforeFailedDimensions,
        after_failed_dimensions: beforeFailedDimensions,
      },
    });

    console.error(JSON.stringify({
      tag: "[phase4f:remediation_error]",
      run_id: runId,
      type: remediationType,
      error: remTelemetry.error,
    }));

    return {
      success: false,
      draftOutput: draftOutput,
      gateResult: gateResult,
      telemetry: remTelemetry,
    };
  }
}
