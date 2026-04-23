// ════════════════════════════════════════════════════════════════
// idempotency — pre-insert convergence for near-simultaneous
// identical Strategy task generates.
//
// Why: the partial unique index `task_runs_one_active_per_thread_task`
// only protects collisions where `thread_id IS NOT NULL`. Canary /
// programmatic callers that omit thread_id used to produce duplicate
// rows on near-simultaneous identical requests.
//
// This helper performs a SHORT-WINDOW lookup (default 30s) of any
// recent active row for the same (user_id, task_type, fingerprint).
// If one exists, the caller returns it instead of inserting a second.
//
// Fingerprint = thread_id when present (continues prior behavior),
// otherwise a stable hash of the normalized inputs (company_name +
// account_id + opportunity_id) which is what Discovery Prep's canary
// harness varies by.
// ════════════════════════════════════════════════════════════════

const DEFAULT_DEDUPE_WINDOW_MS = 30_000;

function normalize(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/** Stable, short fingerprint string for dedupe lookups. */
export function buildIdempotencyKey(inputs: any): string {
  const company = normalize(inputs?.company_name);
  const account = normalize(inputs?.account_id);
  const opp = normalize(inputs?.opportunity_id);
  return `${company}|${account}|${opp}`;
}

/**
 * Look up a recent active task_run for the same caller intent.
 * Returns the existing row if found; otherwise null.
 *
 * Note: this is a best-effort short-window dedupe. It does NOT replace
 * the partial unique index; it merely extends convergence to callers
 * that don't supply a thread_id.
 */
export async function findRecentActiveRun(args: {
  supabase: any;
  userId: string;
  taskType: string;
  inputs: any;
  windowMs?: number;
}): Promise<{ id: string; status: string } | null> {
  const { supabase, userId, taskType, inputs } = args;
  const windowMs = args.windowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const sinceIso = new Date(Date.now() - windowMs).toISOString();
  const threadId = inputs?.thread_id || null;

  // Path A — thread-scoped (most precise; matches existing partial index).
  if (threadId) {
    const { data, error } = await supabase
      .from("task_runs")
      .select("id, status, created_at")
      .eq("user_id", userId)
      .eq("task_type", taskType)
      .eq("thread_id", threadId)
      .in("status", ["pending", "running"])
      .gt("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return { id: data.id, status: data.status };
    return null;
  }

  // Path B — fingerprint-scoped (covers callers without thread_id).
  // We over-pull a small window of the user's recent runs of the same
  // task_type, then match in code on the fingerprint to avoid relying
  // on a JSON-ops index.
  const { data: rows, error } = await supabase
    .from("task_runs")
    .select("id, status, inputs, created_at")
    .eq("user_id", userId)
    .eq("task_type", taskType)
    .in("status", ["pending", "running"])
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !Array.isArray(rows)) return null;

  const wantedKey = buildIdempotencyKey(inputs);
  for (const r of rows) {
    if (buildIdempotencyKey((r as any).inputs) === wantedKey) {
      return { id: (r as any).id, status: (r as any).status };
    }
  }
  return null;
}
