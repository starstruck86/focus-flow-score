/**
 * Phase 4 — Strategy Surface Registry.
 *
 * Manifest-driven registry of all Strategy execution surfaces.
 * Every surface declares its telemetry requirements. New manifests
 * inherit the standard automatically — no hardcoded task-type checks.
 *
 * Phase 4: All previously deferred surfaces are now enforced.
 *
 * DOES NOT modify: scorer, artifact gate, synthesis, methodologySeeds.
 */

import type {
  RegisteredSurface,
  TelemetryRequirements,
} from "./evidenceContract";

// ═══════════════════════════════════════════════════════════════════
// Standard telemetry profiles — reusable requirement sets
// ═══════════════════════════════════════════════════════════════════

/** Full telemetry required — task pipeline standard. */
const FULL_TASK_TELEMETRY: TelemetryRequirements = {
  planner: true,
  retrieval: true,
  artifact_gate: true,
  performance: true,
  anomaly_flags: true,
  output_present: true,
};

/**
 * Chat artifact — retrieval + performance + anomaly_flags + output.
 * Planner is not applicable (chat uses routing_decision, not planner).
 * Artifact gate is not applicable (chat uses inline citation audit).
 */
const CHAT_ARTIFACT_TELEMETRY: TelemetryRequirements = {
  planner: false,
  retrieval: true,
  artifact_gate: false,
  performance: true,
  anomaly_flags: true,
  output_present: true,
};

/**
 * Transform/formatting — performance + output.
 * No planner, retrieval, or gate (transforms re-render existing artifacts).
 */
const TRANSFORM_TELEMETRY: TelemetryRequirements = {
  planner: false,
  retrieval: false,
  artifact_gate: false,
  performance: true,
  anomaly_flags: false,
  output_present: true,
};

// ═══════════════════════════════════════════════════════════════════
// Surface Registry — the canonical list of all Strategy surfaces
// ═══════════════════════════════════════════════════════════════════

/**
 * All registered Strategy execution surfaces.
 *
 * To add a new surface:
 * 1. Add an entry here with manifest_id matching the SkillManifest.id
 * 2. Set telemetry_requirements to the appropriate profile
 * 3. If not yet instrumented, set deferred=true with reason
 * 4. The release gate and evidence runner inherit it automatically
 */
export const STRATEGY_SURFACE_REGISTRY: ReadonlyArray<RegisteredSurface> = [
  // ── Task Pipeline Surfaces ─────────────────────────────────────
  {
    surface: "task",
    manifest_id: "executive-brief",
    label: "Account Brief",
    telemetry_requirements: FULL_TASK_TELEMETRY,
    deferred: false,
  },
  {
    surface: "task",
    manifest_id: "ninety-day-plan",
    label: "90-Day Plan",
    telemetry_requirements: FULL_TASK_TELEMETRY,
    deferred: false,
  },

  // ── Progressive Task Surfaces ──────────────────────────────────
  {
    surface: "progressive_task",
    manifest_id: "discovery-prep",
    label: "Discovery Prep (Progressive)",
    telemetry_requirements: FULL_TASK_TELEMETRY,
    deferred: false,
  },

  // ── Chat Artifact Surfaces (Phase 4: enforced) ────────────────
  {
    surface: "chat_artifact",
    manifest_id: "conversation-pov",
    label: "Conversation POV",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },
  {
    surface: "chat_artifact",
    manifest_id: "commercial-insight",
    label: "Commercial Insight",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },
  {
    surface: "chat_artifact",
    manifest_id: "account-research",
    label: "Account Research",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },
  {
    surface: "chat_artifact",
    manifest_id: "discovery-questions",
    label: "Discovery Questions",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },
  {
    surface: "chat_artifact",
    manifest_id: "meddicc-review",
    label: "MEDDICC Review",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },
  {
    surface: "chat_artifact",
    manifest_id: "demo-strategy",
    label: "Demo Strategy",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },
  {
    surface: "chat_artifact",
    manifest_id: "follow-up-email",
    label: "Follow-Up Email",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },
  {
    surface: "chat_artifact",
    manifest_id: "objection-strategy",
    label: "Objection Strategy",
    telemetry_requirements: CHAT_ARTIFACT_TELEMETRY,
    deferred: false,
  },

  // ── Transform Surfaces (Phase 4: enforced) ─────────────────────
  {
    surface: "transform",
    manifest_id: "docx-render",
    label: "DOCX Document Rendering",
    telemetry_requirements: TRANSFORM_TELEMETRY,
    deferred: false,
  },
];

// ═══════════════════════════════════════════════════════════════════
// Registry Accessors — no hardcoded type checks
// ═══════════════════════════════════════════════════════════════════

/** Get all registered surfaces (enforced + deferred). */
export function getAllSurfaces(): ReadonlyArray<RegisteredSurface> {
  return STRATEGY_SURFACE_REGISTRY;
}

/** Get only surfaces that are actively enforced (not deferred). */
export function getEnforcedSurfaces(): ReadonlyArray<RegisteredSurface> {
  return STRATEGY_SURFACE_REGISTRY.filter(s => !s.deferred);
}

/** Get deferred surfaces with their reasons. */
export function getDeferredSurfaces(): ReadonlyArray<RegisteredSurface> {
  return STRATEGY_SURFACE_REGISTRY.filter(s => s.deferred);
}

/** Lookup a surface by manifest_id. Returns undefined if not registered. */
export function findSurface(manifestId: string): RegisteredSurface | undefined {
  return STRATEGY_SURFACE_REGISTRY.find(s => s.manifest_id === manifestId);
}

/** Check if a manifest_id is registered. */
export function isRegistered(manifestId: string): boolean {
  return STRATEGY_SURFACE_REGISTRY.some(s => s.manifest_id === manifestId);
}

/**
 * Validate that a manifest_id has a registered surface.
 * Throws if not registered — prevents silent bypasses.
 */
export function requireRegistration(manifestId: string): RegisteredSurface {
  const surface = findSurface(manifestId);
  if (!surface) {
    throw new Error(
      `Strategy surface not registered: ${manifestId}. ` +
      `All Strategy execution surfaces MUST be registered in surfaceRegistry.ts. ` +
      `Add an entry with telemetry requirements to enforce evidence standards.`
    );
  }
  return surface;
}

// ═══════════════════════════════════════════════════════════════════
// Manifest-to-Surface Mapping — for task pipeline adapter
// ═══════════════════════════════════════════════════════════════════

/**
 * Maps a task_type string to its manifest_id for registry lookup.
 * This is the ONLY place where task_type strings are mapped — all
 * downstream logic uses manifest_id from the registry.
 */
const TASK_TYPE_TO_MANIFEST: Record<string, string> = {
  account_brief: "executive-brief",
  ninety_day_plan: "ninety-day-plan",
  discovery_prep: "discovery-prep",
};

export function taskTypeToManifestId(taskType: string): string {
  const manifestId = TASK_TYPE_TO_MANIFEST[taskType];
  if (!manifestId) {
    throw new Error(
      `Unknown task_type: ${taskType}. ` +
      `Add a mapping in TASK_TYPE_TO_MANIFEST and register the surface.`
    );
  }
  return manifestId;
}
