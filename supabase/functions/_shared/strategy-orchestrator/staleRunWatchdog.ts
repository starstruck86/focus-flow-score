const WATCHED_STAGE_TIMEOUTS_MS: Record<string, number> = {
  synthesis: 6 * 60 * 1000,
  document_authoring: 6 * 60 * 1000,
};

const DEFAULT_PENDING_TIMEOUT_MS = 7 * 60 * 1000;

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
  const error = WATCHED_STAGE_TIMEOUTS_MS[step]
    ? `stage_timeout:${step} (no progress for ${Math.round(ageMs / 1000)}s)`
    : `stage_timeout:${step} (generic pending watchdog after ${Math.round(ageMs / 1000)}s)`;

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