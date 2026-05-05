/**
 * Phase 3.7B — Universal Evidence Runner.
 *
 * Manifest-driven validation engine that checks any registered
 * Strategy surface for evidence compliance. No hardcoded task types.
 *
 * Operates on DB rows transformed by evidence adapters.
 * Pure validation — no IO, no network, no LLM.
 *
 * DOES NOT modify: scorer, artifact gate, synthesis, methodologySeeds.
 */

import type {
  StrategyExecutionEvidence,
  EvidenceValidationResult,
} from "./evidenceContract";
import { validateEvidence } from "./evidenceContract";
import {
  getAllSurfaces,
  getEnforcedSurfaces,
  getDeferredSurfaces,
  findSurface,
} from "./surfaceRegistry";
import type { RegisteredSurface } from "./evidenceContract";

// ═══════════════════════════════════════════════════════════════════
// Surface Coverage Report
// ═══════════════════════════════════════════════════════════════════

export interface SurfaceCoverageEntry {
  manifest_id: string;
  label: string;
  surface: string;
  enforced: boolean;
  deferral_reason?: string;
  has_evidence: boolean;
  evidence_count: number;
  latest_status?: string;
  validation?: EvidenceValidationResult;
}

export interface UniversalEvidenceReport {
  timestamp: string;
  total_surfaces: number;
  enforced_surfaces: number;
  deferred_surfaces: number;
  covered_surfaces: number;
  uncovered_enforced: number;
  coverage: SurfaceCoverageEntry[];
  pass: boolean;
  failures: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Evidence Runner
// ═══════════════════════════════════════════════════════════════════

/**
 * Run evidence validation across all registered surfaces.
 *
 * @param evidenceByManifest — Map of manifest_id → array of evidence rows.
 *   Each surface should have at least one recent evidence entry.
 *   The runner validates the latest entry per surface.
 */
export function runUniversalEvidenceCheck(
  evidenceByManifest: Map<string, StrategyExecutionEvidence[]>,
): UniversalEvidenceReport {
  const allSurfaces = getAllSurfaces();
  const enforcedSurfaces = getEnforcedSurfaces();
  const deferredSurfaces = getDeferredSurfaces();
  const failures: string[] = [];
  const coverage: SurfaceCoverageEntry[] = [];

  for (const surface of allSurfaces) {
    const evidence = evidenceByManifest.get(surface.manifest_id) || [];
    const hasEvidence = evidence.length > 0;
    const latest = evidence[0]; // Assumes sorted by created_at desc

    let validation: EvidenceValidationResult | undefined;
    if (latest) {
      validation = validateEvidence(latest, surface.telemetry_requirements);
    }

    coverage.push({
      manifest_id: surface.manifest_id,
      label: surface.label,
      surface: surface.surface,
      enforced: !surface.deferred,
      deferral_reason: surface.deferral_reason,
      has_evidence: hasEvidence,
      evidence_count: evidence.length,
      latest_status: latest?.final_status,
      validation,
    });

    // Only enforced surfaces contribute to pass/fail
    if (!surface.deferred) {
      if (!hasEvidence) {
        failures.push(
          `[${surface.manifest_id}] No evidence found for enforced surface: ${surface.label}`
        );
      } else if (validation && !validation.valid) {
        failures.push(
          `[${surface.manifest_id}] Evidence validation failed: ${[
            ...validation.missing_fields,
            ...validation.unmet_requirements,
          ].join(", ")}`
        );
      }
    }
  }

  const coveredSurfaces = coverage.filter(c => c.enforced && c.has_evidence).length;
  const uncoveredEnforced = enforcedSurfaces.length - coveredSurfaces;

  return {
    timestamp: new Date().toISOString(),
    total_surfaces: allSurfaces.length,
    enforced_surfaces: enforcedSurfaces.length,
    deferred_surfaces: deferredSurfaces.length,
    covered_surfaces: coveredSurfaces,
    uncovered_enforced: uncoveredEnforced,
    coverage,
    pass: failures.length === 0,
    failures,
  };
}

/**
 * Validate a single evidence entry against its registered surface.
 * Useful for point checks without running the full report.
 */
export function validateSingleEvidence(
  evidence: StrategyExecutionEvidence,
): EvidenceValidationResult {
  const surface = findSurface(evidence.manifest_id);
  if (!surface) {
    return {
      valid: false,
      surface: evidence.execution_surface,
      manifest_id: evidence.manifest_id,
      missing_fields: [],
      unmet_requirements: [`Surface not registered: ${evidence.manifest_id}`],
    };
  }
  return validateEvidence(evidence, surface.telemetry_requirements);
}
