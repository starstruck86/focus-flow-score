// ════════════════════════════════════════════════════════════════
// Strategy Core — Working Thesis Memory
//
// Persists a single, structured "working thesis state" per account so
// Strategy chat stops having same-day amnesia. The state lives in the
// existing `account_strategy_memory` table as one row per
// (user_id, account_id) with memory_type='working_thesis'. The full
// state is JSON-serialized into the existing `content` text column —
// NO schema change required.
//
// Tiny by design. Three functions only:
//   • loadWorkingThesisState   — rehydrate
//   • saveWorkingThesisState   — upsert (one row per account)
//   • mergeWorkingThesisState  — pure, deterministic state evolution
//
// Behavior contract for callers:
//   • Seller-provided evidence overrides model pattern-matching.
//   • If the seller invalidates a prior thesis, mark it dead (do not
//     silently replace).
//   • Killed hypotheses stay dead unless explicitly revived.
// ════════════════════════════════════════════════════════════════

export type ThesisConfidence = "VALID" | "INFER" | "HYPO" | "UNKN";

export interface KilledHypothesis {
  hypothesis: string;
  killed_by: string;
  killed_at: string;
}

export interface WorkingThesisState {
  account_id: string;
  thread_id?: string | null;
  current_thesis: string;
  current_leakage: string;
  confidence: ThesisConfidence;
  supporting_evidence: string[];
  killed_hypotheses: KilledHypothesis[];
  open_questions: string[];
  last_updated_at: string;
}

const MEMORY_TYPE = "working_thesis";

// ──────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────
export function emptyWorkingThesisState(
  accountId: string,
  threadId?: string | null,
): WorkingThesisState {
  return {
    account_id: accountId,
    thread_id: threadId ?? null,
    current_thesis: "",
    current_leakage: "",
    confidence: "UNKN",
    supporting_evidence: [],
    killed_hypotheses: [],
    open_questions: [],
    last_updated_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────
// Load
// ──────────────────────────────────────────────────────────────────
export async function loadWorkingThesisState(
  supabase: any,
  args: { userId: string; accountId: string },
): Promise<WorkingThesisState | null> {
  if (!args.accountId || !args.userId) return null;
  const { data, error } = await supabase
    .from("account_strategy_memory")
    .select("id, content, updated_at")
    .eq("user_id", args.userId)
    .eq("account_id", args.accountId)
    .eq("memory_type", MEMORY_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.content) return null;
  try {
    const parsed = JSON.parse(data.content) as WorkingThesisState;
    if (!parsed || typeof parsed !== "object" || !parsed.account_id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// Save (upsert one row per account)
// ──────────────────────────────────────────────────────────────────
export async function saveWorkingThesisState(
  supabase: any,
  args: { userId: string; state: WorkingThesisState },
): Promise<void> {
  const { userId, state } = args;
  if (!state?.account_id || !userId) return;
  const stamped: WorkingThesisState = {
    ...state,
    last_updated_at: new Date().toISOString(),
  };
  const content = JSON.stringify(stamped);

  // Find existing row to keep one-per-account.
  const { data: existing } = await supabase
    .from("account_strategy_memory")
    .select("id")
    .eq("user_id", userId)
    .eq("account_id", state.account_id)
    .eq("memory_type", MEMORY_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("account_strategy_memory")
      .update({
        content,
        source_thread_id: state.thread_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("account_strategy_memory").insert({
      user_id: userId,
      account_id: state.account_id,
      memory_type: MEMORY_TYPE,
      content,
      source_thread_id: state.thread_id ?? null,
    });
  }
}

// ──────────────────────────────────────────────────────────────────
// Merge — pure, deterministic. Used by tests AND by chat post-stream.
//
// Rules:
//   • Patch.current_thesis: if non-empty AND different from prior, the
//     prior thesis becomes a killed hypothesis (kill_reason required).
//   • Patch.killed_hypotheses: appended; dedup by hypothesis text.
//   • supporting_evidence + open_questions: appended; dedup; trimmed.
//   • Killed hypotheses cannot be revived implicitly — caller must drop
//     them from killed_hypotheses AND set them as current_thesis.
//   • last_updated_at always refreshed.
// ──────────────────────────────────────────────────────────────────
export interface ThesisStatePatch {
  current_thesis?: string;
  current_leakage?: string;
  confidence?: ThesisConfidence;
  /** Evidence to add. Each entry is a short factual statement. */
  add_evidence?: string[];
  /** Hypotheses to mark dead. killed_by = the seller statement / event that killed it. */
  kill_hypotheses?: Array<{ hypothesis: string; killed_by: string }>;
  /** Open questions to add. */
  add_open_questions?: string[];
  /** Open questions to remove (e.g., answered). */
  resolve_open_questions?: string[];
  /**
   * Reason the prior current_thesis is being replaced. Required when
   * current_thesis changes from a non-empty value — otherwise the old
   * thesis vanishes silently, which is exactly the bug we're fixing.
   */
  thesis_change_reason?: string;
  thread_id?: string | null;
}

function dedupTrim(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function mergeWorkingThesisState(
  prior: WorkingThesisState,
  patch: ThesisStatePatch,
): WorkingThesisState {
  const next: WorkingThesisState = {
    ...prior,
    killed_hypotheses: [...prior.killed_hypotheses],
    supporting_evidence: [...prior.supporting_evidence],
    open_questions: [...prior.open_questions],
  };

  // Thesis change → silently kill the prior thesis as a hypothesis.
  if (
    typeof patch.current_thesis === "string" &&
    patch.current_thesis.trim() &&
    patch.current_thesis.trim() !== prior.current_thesis.trim()
  ) {
    if (prior.current_thesis.trim()) {
      next.killed_hypotheses.push({
        hypothesis: prior.current_thesis.trim(),
        killed_by: (patch.thesis_change_reason ?? "superseded by new evidence")
          .trim(),
        killed_at: new Date().toISOString(),
      });
    }
    next.current_thesis = patch.current_thesis.trim();
  }

  if (typeof patch.current_leakage === "string") {
    next.current_leakage = patch.current_leakage.trim();
  }
  if (patch.confidence) next.confidence = patch.confidence;

  if (patch.kill_hypotheses?.length) {
    for (const k of patch.kill_hypotheses) {
      const h = (k.hypothesis ?? "").trim();
      if (!h) continue;
      // Dedup by hypothesis text (case-insensitive).
      if (
        next.killed_hypotheses.some(
          (x) => x.hypothesis.toLowerCase() === h.toLowerCase(),
        )
      ) continue;
      next.killed_hypotheses.push({
        hypothesis: h,
        killed_by: (k.killed_by ?? "seller correction").trim(),
        killed_at: new Date().toISOString(),
      });
    }
  }

  if (patch.add_evidence?.length) {
    next.supporting_evidence = dedupTrim([
      ...next.supporting_evidence,
      ...patch.add_evidence,
    ]);
  }

  if (patch.add_open_questions?.length) {
    next.open_questions = dedupTrim([
      ...next.open_questions,
      ...patch.add_open_questions,
    ]);
  }
  if (patch.resolve_open_questions?.length) {
    const resolved = new Set(
      patch.resolve_open_questions.map((q) => q.trim().toLowerCase()),
    );
    next.open_questions = next.open_questions.filter(
      (q) => !resolved.has(q.toLowerCase()),
    );
  }

  if (patch.thread_id !== undefined) next.thread_id = patch.thread_id;
  next.last_updated_at = new Date().toISOString();
  return next;
}

// ──────────────────────────────────────────────────────────────────
// Prompt rendering — the block that gets injected into the system
// prompt under "=== CURRENT WORKING THESIS STATE ===".
// ──────────────────────────────────────────────────────────────────
export function renderWorkingThesisStateBlock(
  state: WorkingThesisState | null,
): string {
  if (!state) return "";
  const hasAny =
    state.current_thesis ||
    state.current_leakage ||
    state.killed_hypotheses.length ||
    state.open_questions.length ||
    state.supporting_evidence.length;
  if (!hasAny) return "";

  const lines: string[] = [];
  lines.push("=== CURRENT WORKING THESIS STATE ===");
  lines.push(
    "This is the running thesis you and the seller built across prior conversations on this account. Treat it as the live operating model. Do NOT silently restart. Do NOT re-litigate killed hypotheses unless the seller introduces NEW evidence that revives them.",
  );
  if (state.current_thesis) {
    lines.push(
      `CURRENT THESIS (${state.confidence}): ${state.current_thesis}`,
    );
  }
  if (state.current_leakage) {
    lines.push(`CURRENT LEAKAGE: ${state.current_leakage}`);
  }
  if (state.supporting_evidence.length) {
    lines.push("SUPPORTING EVIDENCE (validated):");
    for (const e of state.supporting_evidence) lines.push(`  - ${e}`);
  }
  if (state.killed_hypotheses.length) {
    lines.push(
      "DEAD HYPOTHESES (do not revive without new evidence — name them as dead if relevant):",
    );
    for (const k of state.killed_hypotheses) {
      lines.push(`  - "${k.hypothesis}" — killed by: ${k.killed_by}`);
    }
  }
  if (state.open_questions.length) {
    lines.push("OPEN QUESTIONS (still unresolved):");
    for (const q of state.open_questions) lines.push(`  - ${q}`);
  }
  lines.push(
    "BEHAVIOR: When the seller adds new evidence, explicitly state whether it CONFIRMS, WEAKENS, or KILLS the current thesis — then give the updated thesis. Do not act like this is a fresh conversation.",
  );
  return lines.join("\n");
}
