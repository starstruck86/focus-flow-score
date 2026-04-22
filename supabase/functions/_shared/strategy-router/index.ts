// ════════════════════════════════════════════════════════════════
// Strategy Router — pure routing decision.
// No I/O. Caller writes routing_decisions via log.ts.
// ════════════════════════════════════════════════════════════════

import { extractSignals, type DeepIntentType, type RouterSignals, type SignalInput } from "./signals.ts";

export type Lane = "direct" | "assisted" | "deep_work";
export type Override = "quick" | "deep" | "auto";

export interface RoutingDecision {
  lane: Lane;
  auto_promoted: boolean;
  promotion_offered: boolean;
  downgrade_warning: boolean;
  override_used: Override;
  task_type: DeepIntentType | null;
  signals: RouterSignals;
}

export interface RouteRequestInput extends SignalInput {
  override?: Override | string | null;
}

function normalizeOverride(v: unknown): Override {
  return v === "quick" || v === "deep" || v === "auto" ? v : "auto";
}

export function routeRequest(input: RouteRequestInput): RoutingDecision {
  const signals = extractSignals(input);
  const override = normalizeOverride(input.override);

  const base = (lane: Lane, extra: Partial<RoutingDecision> = {}): RoutingDecision => ({
    lane,
    auto_promoted: false,
    promotion_offered: false,
    downgrade_warning: false,
    override_used: override,
    task_type: signals.deep_intent_type,
    signals,
    ...extra,
  });

  // 1. Hard overrides
  if (override === "quick") {
    return base("direct", {
      task_type: null,
      downgrade_warning: signals.account_attached && signals.deep_intent,
    });
  }
  if (override === "deep") {
    // Composer-level deep override only routes when deep_intent_type is known.
    // Otherwise fall through to assisted with promotion offered so the user is
    // not silently parked into a no-op deep lane.
    if (signals.deep_intent_type) {
      return base("deep_work", { auto_promoted: false, task_type: signals.deep_intent_type });
    }
    return base("assisted", { promotion_offered: true });
  }
  if (signals.explicit_task) {
    return base("deep_work", { auto_promoted: false });
  }

  // 2. Default-upward: deep intent + account/opp context
  if (signals.deep_intent && (signals.account_attached || signals.opp_attached)) {
    return base("deep_work", { auto_promoted: true });
  }

  // 3. Deep intent without account context
  if (signals.deep_intent) {
    return base("assisted", { promotion_offered: true });
  }

  // 4. Strong assisted signals
  if (
    signals.account_attached
    || signals.length_long
    || signals.strategic_keywords
    || signals.library_precheck_count >= 3
  ) {
    return base("assisted");
  }

  // 5. Pure utility
  if (signals.is_utility) return base("direct");

  // 6. Default
  return base("assisted");
}
