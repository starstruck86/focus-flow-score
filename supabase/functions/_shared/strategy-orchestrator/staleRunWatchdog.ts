// ════════════════════════════════════════════════════════════════
// Stale-run watchdog — TIME-GATED, not poll-gated.
//
// Two entry points:
//   1. failStalePendingRun(row)    — single-row check on status poll
//   2. sweepStalePendingRuns(...)  — bulk sweep, called by:
//        a. start of every `generate` (so even with no client polling,
//           the next generate fails old stranded rows)
//        b. cron-triggered run-strategy-task-reaper edge function
//           (true time-gating, no client involvement)
//
// Stages reaped: synthesis, document_authoring, plus a generic catch-all
// for any other progress_step that exceeds DEFAULT_PENDING_TIMEOUT_MS.
// ════════════════════════════════════════════════════════════════

const WATCHED_STAGE_TIMEOUTS_MS: Record<string, number> = {
  synthesis: 6 * 60 * 1000,
  document_authoring: 6 * 60 * 1000,
};

const DEFAULT_PENDING_TIMEOUT_MS = 7 * 60 * 1000;
// Safety ceiling: anything pending longer than this is reaped no matter what.
const HARD_PENDING_CEILING_MS = 10 * 60 * 1000;

function buildErrorMessage(step: string, ageMs: number): string {
  return WATCHED_STAGE_TIMEOUTS_MS[step]
    ? `stage_timeout:${step} (no progress for ${Math.round(ageMs / 1000)}s)`
    : `stage_timeout:${step || "unknown"} (generic pending watchdog after ${Math.round(ageMs / 1000)}s)`;
}

export async function failStalePendingRun(args: {
  supabase: any;
  row: any;
  runId: string;
  userId: string;
}) {
  const { supabase, row, runId, userId } = args;
  if (!row || row.status !== "pending") return row;

  const step = typeof row.progress_step === "string" && row.progress_step.length > 0
    ? row.progress_step
    : "unknown";
  const lastUpdate = new Date(row.updated_at).getTime();
  const ageMs = Date.now() - lastUpdate;
  const timeoutMs = WATCHED_STAGE_TIMEOUTS_MS[step] ?? DEFAULT_PENDING_TIMEOUT_MS;

  if (!Number.isFinite(lastUpdate) || ageMs <= timeoutMs) return row;

  const nowIso = new Date().toISOString();
  const error = buildErrorMessage(step, ageMs);

  await supabase
    .from("task_runs")
    .update({
      status: "failed",
      progress_step: "failed",
      error,
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", runId)
    .eq("user_id", userId);

  return {
    ...row,
    status: "failed",
    progress_step: "failed",
    error,
    completed_at: nowIso,
    updated_at: nowIso,
  };
}

/**
 * Bulk sweep — fails ALL stranded pending rows older than their stage budget.
 * Scope: when userId is provided, restricted to that user (called from
 * `generate`); when omitted, sweeps every user (called from cron reaper
 * with the service role).
 *
 * Returns the count of reaped rows for telemetry.
 */
export async function sweepStalePendingRuns(args: {
  supabase: any;
  userId?: string;
}): Promise<{ reaped: number; ids: string[] }> {
  const { supabase, userId } = args;
  // Cheap pre-filter: pull pending rows older than the smallest watched
  // window. Then evaluate per-row against the precise stage timeout.
  const cutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  let query = supabase
    .from("task_runs")
    .select("id, user_id, status, progress_step, updated_at")
    .eq("status", "pending")
    .lt("updated_at", cutoffIso)
    .limit(200);
  if (userId) query = query.eq("user_id", userId);

  const { data: rows, error } = await query;
  if (error || !Array.isArray(rows) || rows.length === 0) {
    return { reaped: 0, ids: [] };
  }

  const reapedIds: string[] = [];
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    const step = typeof row.progress_step === "string" && row.progress_step.length > 0
      ? row.progress_step
      : "unknown";
    const lastUpdate = new Date(row.updated_at).getTime();
    const ageMs = Date.now() - lastUpdate;
    const timeoutMs = WATCHED_STAGE_TIMEOUTS_MS[step] ?? DEFAULT_PENDING_TIMEOUT_MS;
    const exceeded = Number.isFinite(lastUpdate) &&
      (ageMs > timeoutMs || ageMs > HARD_PENDING_CEILING_MS);
    if (!exceeded) continue;

    const errorMsg = buildErrorMessage(step, ageMs);
    const { error: updateErr } = await supabase
      .from("task_runs")
      .update({
        status: "failed",
        progress_step: "failed",
        error: errorMsg,
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("status", "pending"); // double-check race-safety
    if (!updateErr) {
      reapedIds.push(row.id);
      console.log(JSON.stringify({
        tag: "[stale-watchdog:reaped]",
        run_id: row.id,
        user_id: row.user_id,
        step,
        age_s: Math.round(ageMs / 1000),
        scope: userId ? "user" : "global",
      }));
    }
  }

  return { reaped: reapedIds.length, ids: reapedIds };
}