// ════════════════════════════════════════════════════════════════
// Strategy Router — best-effort logging helper.
// Failures are swallowed; routing must never block on telemetry.
// ════════════════════════════════════════════════════════════════

import type { RoutingDecision } from "./index.ts";

export interface RoutingLogPayload {
  user_id: string;
  thread_id: string | null;
  decision: RoutingDecision;
}

export async function logRoutingDecision(
  supabase: any,
  payload: RoutingLogPayload,
): Promise<void> {
  try {
    const { error } = await supabase.from("routing_decisions").insert({
      user_id: payload.user_id,
      thread_id: payload.thread_id,
      lane: payload.decision.lane,
      signals: payload.decision.signals,
      override_used: payload.decision.override_used,
      auto_promoted: payload.decision.auto_promoted,
      downgrade_warning: payload.decision.downgrade_warning,
    });
    if (error) {
      console.warn(JSON.stringify({
        tag: "[strategy-router:log_failed]",
        reason: error.message,
        thread_id: payload.thread_id,
      }));
      return;
    }
    // Explicit success-side confirmation. Lets validation distinguish
    // "no traffic yet" from "write path broken" without needing to query
    // the DB. Insert is intentionally minimal so log volume stays sane.
    console.log(JSON.stringify({
      tag: "[strategy-router:logged]",
      thread_id: payload.thread_id,
      lane: payload.decision.lane,
      auto_promoted: payload.decision.auto_promoted,
    }));
  } catch (e) {
    console.warn(JSON.stringify({
      tag: "[strategy-router:log_failed]",
      reason: (e as Error).message,
      thread_id: payload.thread_id,
    }));
  }
}
