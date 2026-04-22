/**
 * resourceStateResolver.ts — SINGLE SOURCE OF TRUTH for resource lifecycle state.
 *
 * Every dashboard (Control Plane, Resource Readiness, Knowledge Ops) MUST
 * derive its per-resource state from `resolveResourceState()`.
 *
 * Design rules:
 *  1. KI-based truth ALWAYS wins. If `ki.total > 0`, the resource is past
 *     "no_content" / "ready_for_extraction" regardless of legacy flags.
 *  2. `content_length` is the authoritative content metric. Never compare
 *     it to a 300-char prefix length — that produces false `empty_content`.
 *  3. The resolver is pure, deterministic, and free of side effects.
 */

export type ResourceState =
  | 'no_content'
  | 'ready_for_extraction'
  | 'extracted'        // KIs exist but none active
  | 'needs_activation' // alias for `extracted` — kept for clarity at call sites
  | 'needs_context'    // active KIs but none have applies_to_contexts
  | 'ready'            // operationalized
  | 'blocked';

export interface ResolverResource {
  /** Authoritative full-content length from the DB. NEVER pass a prefix length here. */
  content_length?: number | null;
  manual_content_present?: boolean | null;
  /** Optional explicit blocker signal (e.g. auth-gated, manual_input_required). */
  hard_blocked?: boolean | null;
}

export interface ResolverKi {
  total: number;
  active: number;
  activeWithContexts: number;
}

const MIN_CONTENT_LENGTH = 500;

/**
 * Canonical state resolver. KI-based truth wins; content_length is only
 * consulted when no KIs exist.
 */
export function resolveResourceState(
  resource: ResolverResource,
  ki: ResolverKi,
): ResourceState {
  if (resource.hard_blocked === true) return 'blocked';

  // KI truth wins — never claim "no_content" if KIs already exist.
  if (ki.total > 0) {
    if (ki.active === 0) return 'extracted';
    if (ki.activeWithContexts === 0) return 'needs_context';
    return 'ready';
  }

  const hasContent =
    (resource.content_length ?? 0) >= MIN_CONTENT_LENGTH ||
    resource.manual_content_present === true;

  if (!hasContent) return 'no_content';
  return 'ready_for_extraction';
}

/**
 * Invariant guard: detect impossible state combinations.
 * Returns a list of human-readable violations for telemetry / console.warn.
 */
export function auditResourceInvariants(
  resource: ResolverResource & { id?: string },
  ki: ResolverKi,
  blocked_reason: string | null | undefined,
): string[] {
  const violations: string[] = [];
  if (ki.total > 0 && blocked_reason === 'empty_content') {
    violations.push(
      `INVALID STATE: resource ${resource.id ?? '<unknown>'} has ${ki.total} KIs but blocked_reason='empty_content'`,
    );
  }
  if (ki.total > 0 && blocked_reason === 'no_extraction') {
    violations.push(
      `INVALID STATE: resource ${resource.id ?? '<unknown>'} has ${ki.total} KIs but blocked_reason='no_extraction'`,
    );
  }
  return violations;
}
