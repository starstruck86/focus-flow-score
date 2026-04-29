/**
 * Skill Resolver — Phase 1 (inert).
 *
 * Pure functions that resolve a skill id (e.g. "/pov") to a manifest,
 * and produce a routing decision the (future) runtime would consume.
 * No side effects, no IO, no edge imports.
 */
import type { SkillManifest, SkillDepth } from './types';
import { SKILL_REGISTRY } from './registry';

export interface SkillInvocation {
  /** Raw token, e.g. "/pov" or "pov". */
  token: string;
  /** Optional depth override from the user (e.g. "/pov deep"). */
  depthOverride?: SkillDepth;
  /** Free-form inputs the user supplied (account, persona, etc.). */
  inputs?: Record<string, unknown>;
}

export interface ResolvedSkill {
  manifest: SkillManifest;
  effectiveDepth: SkillDepth;
  inputs: Record<string, unknown>;
}

export type SkillResolution =
  | { ok: true; resolved: ResolvedSkill }
  | { ok: false; reason: 'unknown_skill' | 'invalid_token'; token: string };

const TOKEN_RE = /^[a-z][a-z0-9-]*$/;

export function normalizeToken(raw: string): string {
  return raw.trim().replace(/^\/+/, '').toLowerCase();
}

export function resolveSkill(invocation: SkillInvocation): SkillResolution {
  const token = normalizeToken(invocation.token ?? '');
  if (!token || !TOKEN_RE.test(token)) {
    return { ok: false, reason: 'invalid_token', token };
  }
  const manifest = SKILL_REGISTRY[token];
  if (!manifest) {
    return { ok: false, reason: 'unknown_skill', token };
  }
  const effectiveDepth: SkillDepth = invocation.depthOverride ?? manifest.depth;
  return {
    ok: true,
    resolved: {
      manifest,
      effectiveDepth,
      inputs: invocation.inputs ?? {},
    },
  };
}
