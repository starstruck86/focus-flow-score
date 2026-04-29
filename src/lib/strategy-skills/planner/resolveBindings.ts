/**
 * ${inputs.*} resolver — Phase 2 (inert, pure).
 *
 * Layered scope: inputs → thread → account → prior. One-segment depth.
 * Stop-list strips low-signal terms. Empty/whitespace dropped.
 */
import type { PlannerContext } from './contextTypes';

const BINDING_RE = /^\$\{(inputs|thread|account|prior)\.([a-zA-Z_][a-zA-Z0-9_]*)\}$/;
const SHORT_RE = /^\$\{inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\}$/;

const STOP_LIST: ReadonlySet<string> = new Set([
  'call', 'meeting', 'deal', 'customer', 'prospect', 'account', 'thing', 'stuff',
]);

const ALLOWED_NAMESPACES = ['inputs', 'thread', 'account', 'prior'] as const;
type Namespace = (typeof ALLOWED_NAMESPACES)[number];

function readScope(ns: Namespace, key: string, ctx: PlannerContext, inputs: Record<string, unknown>): unknown {
  switch (ns) {
    case 'inputs': return inputs[key];
    case 'thread': return ctx.thread ? (ctx.thread as Record<string, unknown>)[key] : undefined;
    case 'account': return ctx.account ? (ctx.account as Record<string, unknown>)[key] : undefined;
    case 'prior': return ctx.prior?.lastResolved?.inputs?.[key];
  }
}

function toTerm(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (STOP_LIST.has(s.toLowerCase())) return null;
  return s;
}

export interface ResolveResult {
  termSeeds: string[];
  unresolvedBindings: string[];
}

/**
 * Resolve a manifest's termBindings to concrete term seeds.
 * - `${inputs.x}` falls back through inputs → thread → account → prior.
 * - `${thread.x}` / `${account.x}` / `${prior.x}` read only that scope.
 * - Unresolved or stop-listed seeds are recorded in unresolvedBindings.
 */
export function resolveBindings(
  bindings: ReadonlyArray<string>,
  inputs: Record<string, unknown>,
  ctx: PlannerContext,
): ResolveResult {
  const termSeeds: string[] = [];
  const unresolvedBindings: string[] = [];
  const seen = new Set<string>();

  for (const raw of bindings) {
    if (typeof raw !== 'string') continue;
    const short = raw.match(SHORT_RE);
    const full = raw.match(BINDING_RE);

    let resolved: string | null = null;
    if (short) {
      const key = short[1];
      // Fallback chain for `${inputs.*}`.
      for (const ns of ALLOWED_NAMESPACES) {
        const v = readScope(ns, key, ctx, inputs);
        const t = toTerm(v);
        if (t) { resolved = t; break; }
      }
    } else if (full) {
      const ns = full[1] as Namespace;
      const key = full[2];
      resolved = toTerm(readScope(ns, key, ctx, inputs));
    } else {
      // Malformed binding — drop and record.
      unresolvedBindings.push(raw);
      continue;
    }

    if (resolved) {
      const k = resolved.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        termSeeds.push(resolved);
      }
    } else {
      unresolvedBindings.push(raw);
    }
  }

  return { termSeeds, unresolvedBindings };
}

export const __test__ = { STOP_LIST, BINDING_RE, SHORT_RE };
