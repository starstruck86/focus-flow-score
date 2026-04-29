/**
 * Authority resolver (Phase 3, pure).
 *
 * When a `skill` envelope is present, the skill becomes the AUTHORITY:
 *   • behaviorIntent: from manifest, NEVER inferred from message text.
 *   • workspace: from manifest.
 *   • sourceMode: from manifest.
 *   • output shape: from manifest.
 *   • rubric: from manifest.
 *
 * User text becomes inputs to the skill; it MUST NOT silently override
 * the manifest. Conflicting client-side `behaviorIntent` / `workspace`
 * fields in the envelope are clamped (downgrade-only) and reported in
 * the trace as `overrides_clamped`.
 */
import { SKILL_REGISTRY } from "./manifests.ts";
import type {
  SkillBehaviorIntent,
  SkillDepth,
  SkillManifest,
  SkillWorkspace,
} from "./types.ts";

export interface SkillEnvelope {
  /** Skill id, e.g. "conversation-pov". */
  id: string;
  /** Optional depth override; clamped to manifest if invalid. */
  depth?: SkillDepth;
  /** Free-form inputs. Strings only; everything else is dropped. */
  inputs?: Record<string, unknown>;
  /** Optional client-side claim; ignored if it conflicts with manifest. */
  behaviorIntent?: SkillBehaviorIntent;
  /** Optional client-side claim; ignored if it conflicts with manifest. */
  workspace?: SkillWorkspace;
  /** Optional run id for trace correlation. */
  runId?: string;
}

export type AuthorityResult =
  | {
    ok: true;
    manifest: SkillManifest;
    effectiveDepth: SkillDepth;
    inputs: Record<string, unknown>;
    overridesClamped: ReadonlyArray<string>;
    runId?: string;
  }
  | { ok: false; reason: "unknown_skill" | "invalid_envelope"; token?: string };

const VALID_DEPTHS: ReadonlySet<SkillDepth> = new Set(
  ["quick", "standard", "deep", "artifact"],
);

function sanitizeInputs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > 64) continue;
    if (typeof v === "string" && v.length <= 2000) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    // arrays / objects / nulls dropped — skill inputs are flat strings
  }
  return out;
}

/**
 * Resolve a skill envelope into the authoritative manifest and clamp
 * any client-side overrides. NEVER throws; returns a refusal instead.
 */
export function resolveAuthority(envelope: unknown): AuthorityResult {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, reason: "invalid_envelope" };
  }
  const env = envelope as Partial<SkillEnvelope>;
  const id = typeof env.id === "string" ? env.id.trim().replace(/^\/+/, "").toLowerCase() : "";
  if (!id) return { ok: false, reason: "invalid_envelope" };

  const manifest = SKILL_REGISTRY[id];
  if (!manifest) return { ok: false, reason: "unknown_skill", token: id };

  const overrides: string[] = [];

  // Clamp depth: only honor when it's a legal value; otherwise fall back.
  let effectiveDepth: SkillDepth = manifest.depth;
  if (env.depth !== undefined) {
    if (typeof env.depth === "string" && VALID_DEPTHS.has(env.depth)) {
      effectiveDepth = env.depth;
    } else {
      overrides.push("depth");
    }
  }

  if (env.behaviorIntent !== undefined && env.behaviorIntent !== manifest.behaviorIntent) {
    overrides.push("behaviorIntent");
  }
  if (env.workspace !== undefined && env.workspace !== manifest.workspace) {
    overrides.push("workspace");
  }

  return {
    ok: true,
    manifest,
    effectiveDepth,
    inputs: sanitizeInputs(env.inputs),
    overridesClamped: Object.freeze(overrides),
    runId: typeof env.runId === "string" ? env.runId : undefined,
  };
}
