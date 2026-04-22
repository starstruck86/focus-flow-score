// ════════════════════════════════════════════════════════════════
// Strategy Core — Authoritative Library Totals
//
// Returns REAL DB-backed counts for the user's library, scoped per
// user via the supplied Supabase client (RLS is the trust boundary).
//
// Rules:
//   • Uses Postgres exact COUNT only — never vector top-K.
//   • Never estimates. Never falls back to retrieval results.
//   • If a count fails, it returns null for that field so the prompt
//     layer can refuse to assert a number rather than guessing.
//
// Consumed by strategy-chat to render the "=== LIBRARY TOTALS ==="
// block injected into buildStrategyChatSystemPrompt. Combined with the
// LIBRARY COUNT DISCIPLINE rule this kills hallucinated counts like
// "you have 12 resources on X".
// ════════════════════════════════════════════════════════════════

export interface LibraryTotals {
  resources_total: number | null;
  knowledge_items_total: number | null;
  playbooks_total: number | null;
  computed_at: string;
}

async function exactCount(
  supabase: any,
  table: string,
  userId: string,
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) {
      console.warn(JSON.stringify({
        tag: "[strategy-core/libraryTotals:count_failed]",
        table,
        reason: error.message,
      }));
      return null;
    }
    return typeof count === "number" ? count : null;
  } catch (e) {
    console.warn(JSON.stringify({
      tag: "[strategy-core/libraryTotals:count_failed]",
      table,
      reason: (e as Error).message,
    }));
    return null;
  }
}

/**
 * Fetch authoritative DB counts for the user's library.
 * Uses count='exact' head queries so it scales to 1200+ resources
 * and 24k+ KIs without pulling rows.
 */
export async function getLibraryTotals(
  supabase: any,
  userId: string,
): Promise<LibraryTotals> {
  const [resources_total, knowledge_items_total, playbooks_total] =
    await Promise.all([
      exactCount(supabase, "resources", userId),
      exactCount(supabase, "knowledge_items", userId),
      exactCount(supabase, "playbooks", userId),
    ]);
  return {
    resources_total,
    knowledge_items_total,
    playbooks_total,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Render the totals as the authoritative "=== LIBRARY TOTALS ==="
 * block. Returns "" when every count failed — the prompt layer treats
 * empty as "no authoritative source available" and the model must
 * then refuse to assert counts (per LIBRARY COUNT DISCIPLINE).
 */
export function renderLibraryTotalsBlock(totals: LibraryTotals): string {
  const lines: string[] = [];
  if (typeof totals.resources_total === "number") {
    lines.push(`resources_total: ${totals.resources_total}`);
  }
  if (typeof totals.knowledge_items_total === "number") {
    lines.push(`knowledge_items_total: ${totals.knowledge_items_total}`);
  }
  if (typeof totals.playbooks_total === "number") {
    lines.push(`playbooks_total: ${totals.playbooks_total}`);
  }
  if (!lines.length) return "";
  lines.push(`computed_at: ${totals.computed_at}`);
  lines.push(
    "Source: exact Postgres COUNT over the user's library (not vector retrieval). " +
      "These are the ONLY numbers you may quote for library counts. If a number you " +
      "want to cite is not in this block, say you cannot verify it.",
  );
  return `=== LIBRARY TOTALS ===\n${lines.join("\n")}`;
}
