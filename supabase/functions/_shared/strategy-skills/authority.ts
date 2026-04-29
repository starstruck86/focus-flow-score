/**
 * Authority resolver (Phase 3 + 3A hardening, pure).
 *
 * When a `skill` envelope is present, the skill becomes the AUTHORITY:
 *   • behaviorIntent: from manifest, NEVER inferred from message text.
 *   • workspace: from manifest.
 *   • sourceMode: from manifest. **Server-only.** Client cannot supply
 *     `sourceMode` — see `sanitizeClientEnvelope` (forbidden key).
 *   • output shape: from manifest.
 *   • rubric: from manifest.
 *
 * User text becomes inputs to the skill; it MUST NOT silently override
 * the manifest. Conflicting client-side `behaviorIntent` / `workspace`
 * fields in the envelope are clamped (downgrade-only) and reported in
 * the trace as `overrides_clamped`.
 *
 * 3A additions:
 *   • Strict envelope sanitizer drops unknown / forbidden keys (e.g.
 *     any client-supplied `sourceMode`) and surfaces them in the trace.
 *   • `expectedVersion` mismatch → refusal (no silent drift).
 *   • `chainDepth` is parsed and clamped (runtime enforces the cap).
 */
import { SKILL_REGISTRY } from "./manifests.ts";
import { sanitizeClientEnvelope } from "./hardening.ts";
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
  /** Optional pinned manifest version — refuse if it doesn't match. */
  expectedVersion?: string;
  /** Optional chain depth (runtime caps to MAX_CHAIN_DEPTH). */
  chainDepth?: number;
}

export type AuthorityResult =
  | {
    ok: true;
    manifest: SkillManifest;
    effectiveDepth: SkillDepth;
    inputs: Record<string, unknown>;
    overridesClamped: ReadonlyArray<string>;
    droppedClientKeys: ReadonlyArray<string>;
    forbiddenAttempted: boolean;
    chainDepth: number;
    runId?: string;
  }
  | {
    ok: false;
    reason:
      | "unknown_skill"
      | "invalid_envelope"
      | "version_mismatch";
    token?: string;
    expected?: string;
    actual?: string;
  };

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
  // Step 1: sanitize the raw envelope. Drops `sourceMode` and any other
  // forbidden / unknown key, returning what was rejected for the trace.
  const { sanitized, droppedKeys, forbiddenAttempted } =
    sanitizeClientEnvelope(envelope);
  if (Object.keys(sanitized).length === 0) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const env = sanitized as Partial<SkillEnvelope>;
  const id = typeof env.id === "string"
    ? env.id.trim().replace(/^\/+/, "").toLowerCase()
    : "";
  if (!id) return { ok: false, reason: "invalid_envelope" };

  const manifest = SKILL_REGISTRY[id];
  if (!manifest) return { ok: false, reason: "unknown_skill", token: id };

  if (typeof env.expectedVersion === "string" &&
      env.expectedVersion !== manifest.version) {
    return {
      ok: false,
      reason: "version_mismatch",
      token: id,
      expected: env.expectedVersion,
      actual: manifest.version,
    };
  }

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

  if (env.behaviorIntent !== undefined &&
      env.behaviorIntent !== manifest.behaviorIntent) {
    overrides.push("behaviorIntent");
  }
  if (env.workspace !== undefined && env.workspace !== manifest.workspace) {
    overrides.push("workspace");
  }

  // chainDepth is parsed here; the runtime applies the hard cap so
  // refusals carry full context (manifest + plan stub).
  const chainDepth = typeof env.chainDepth === "number" &&
      Number.isFinite(env.chainDepth)
    ? Math.max(0, Math.floor(env.chainDepth))
    : 0;

  return {
    ok: true,
    manifest,
    effectiveDepth,
    inputs: sanitizeInputs(env.inputs),
    overridesClamped: Object.freeze(overrides),
    droppedClientKeys: droppedKeys,
    forbiddenAttempted,
    chainDepth,
    runId: typeof env.runId === "string" ? env.runId : undefined,
  };
}
