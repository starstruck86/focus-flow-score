// ════════════════════════════════════════════════════════════════
// Library Retrieval — Stage 0
//
// Pulls relevant Knowledge Items + Playbooks from the user's library
// based on task scopes. Output feeds BOTH synthesis and review so the
// internal foundation shapes the document, not just polish on top.
// ════════════════════════════════════════════════════════════════

import type {
  LibraryRetrievalResult,
  RetrievedKI,
  RetrievedPlaybook,
  TaskInputs,
} from "./types.ts";

interface RetrieveOpts {
  scopes: string[];
  maxKIs?: number;
  maxPlaybooks?: number;
}

/** Score a row by counting scope keyword hits across searchable fields. */
function scoreRow(searchText: string, scopes: string[]): number {
  const t = searchText.toLowerCase();
  let s = 0;
  for (const scope of scopes) {
    const needle = scope.toLowerCase();
    // Whole-word-ish hit gets more weight than substring
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const hits = (t.match(re) || []).length;
    s += hits * 2;
    if (!hits && t.includes(needle)) s += 1;
  }
  return s;
}

export async function retrieveLibraryContext(
  supabase: any,
  userId: string,
  inputs: TaskInputs,
  opts: RetrieveOpts,
): Promise<LibraryRetrievalResult> {
  const maxKIs = opts.maxKIs ?? 12;
  const maxPlaybooks = opts.maxPlaybooks ?? 6;

  // ── Knowledge Items ──
  let knowledgeItems: RetrievedKI[] = [];
  try {
    const { data: kiRows } = await supabase
      .from("knowledge_items")
      .select(
        "id, title, chapter, knowledge_type, tactic_summary, why_it_matters, when_to_use, how_to_execute, framework, confidence_score, applies_to_contexts, tags, active",
      )
      .eq("user_id", userId)
      .eq("active", true)
      .limit(500);

    if (kiRows?.length) {
      knowledgeItems = (kiRows as any[])
        .map((r) => {
          const searchText = [
            r.title, r.chapter, r.knowledge_type, r.framework,
            r.tactic_summary, r.why_it_matters, r.when_to_use,
            (r.applies_to_contexts || []).join(" "),
            (r.tags || []).join(" "),
          ].filter(Boolean).join(" \n ");
          const score = scoreRow(searchText, opts.scopes);
          return { row: r, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (b.row.confidence_score ?? 0) - (a.row.confidence_score ?? 0))
        .slice(0, maxKIs)
        .map(({ row, score }) => ({
          id: row.id,
          title: row.title,
          chapter: row.chapter,
          knowledge_type: row.knowledge_type,
          tactic_summary: row.tactic_summary,
          why_it_matters: row.why_it_matters,
          when_to_use: row.when_to_use,
          how_to_execute: row.how_to_execute,
          framework: row.framework,
          confidence_score: row.confidence_score,
          score,
        }));
    }
  } catch (e) {
    console.warn("[library-retrieval] KI fetch failed:", (e as Error).message);
  }

  // ── Playbooks ──
  let playbooks: RetrievedPlaybook[] = [];
  try {
    const { data: pbRows } = await supabase
      .from("playbooks")
      .select(
        "id, title, problem_type, when_to_use, why_it_matters, tactic_steps, talk_tracks, key_questions, traps, anti_patterns, what_great_looks_like, common_mistakes, confidence_score",
      )
      .eq("user_id", userId)
      .order("confidence_score", { ascending: false })
      .limit(60);

    if (pbRows?.length) {
      playbooks = (pbRows as any[])
        .map((r) => {
          const searchText = [
            r.title, r.problem_type, r.when_to_use, r.why_it_matters,
            (r.tactic_steps || []).join(" "),
            (r.key_questions || []).join(" "),
          ].filter(Boolean).join(" \n ");
          const score = scoreRow(searchText, opts.scopes);
          return { row: r, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (b.row.confidence_score ?? 0) - (a.row.confidence_score ?? 0))
        .slice(0, maxPlaybooks)
        .map(({ row, score }) => ({
          id: row.id,
          title: row.title,
          problem_type: row.problem_type,
          when_to_use: row.when_to_use,
          why_it_matters: row.why_it_matters,
          tactic_steps: row.tactic_steps,
          talk_tracks: row.talk_tracks,
          key_questions: row.key_questions,
          traps: row.traps,
          anti_patterns: row.anti_patterns,
          what_great_looks_like: row.what_great_looks_like,
          common_mistakes: row.common_mistakes,
          confidence_score: row.confidence_score,
          score,
        }));
    }
  } catch (e) {
    console.warn("[library-retrieval] Playbook fetch failed:", (e as Error).message);
  }

  // ── Compact context string for prompt injection ──
  const kiBlock = knowledgeItems.length
    ? knowledgeItems.map((k) =>
        `KI[${k.id.slice(0, 8)}] ${k.title}` +
        (k.chapter ? ` — ${k.chapter}` : "") +
        (k.tactic_summary ? `\n  Tactic: ${k.tactic_summary}` : "") +
        (k.when_to_use ? `\n  When: ${k.when_to_use}` : "") +
        (k.how_to_execute ? `\n  How: ${k.how_to_execute}` : "")
      ).join("\n\n")
    : "";

  const pbBlock = playbooks.length
    ? playbooks.map((p) =>
        `PLAYBOOK[${p.id.slice(0, 8)}] ${p.title}` +
        (p.problem_type ? ` (${p.problem_type})` : "") +
        (p.when_to_use ? `\n  When to Use: ${p.when_to_use}` : "") +
        (p.tactic_steps?.length ? `\n  Steps: ${p.tactic_steps.slice(0, 4).join("; ")}` : "") +
        (p.key_questions?.length ? `\n  Key Questions: ${p.key_questions.slice(0, 4).join(" | ")}` : "") +
        (p.anti_patterns?.length ? `\n  Anti-Patterns: ${p.anti_patterns.slice(0, 3).join("; ")}` : "")
      ).join("\n\n")
    : "";

  const contextString = [
    kiBlock ? `=== INTERNAL KNOWLEDGE ITEMS (use these — they are the company's tested intellectual property) ===\n${kiBlock}` : "",
    pbBlock ? `=== INTERNAL PLAYBOOKS (use these to ground tactics, questions, and warnings) ===\n${pbBlock}` : "",
  ].filter(Boolean).join("\n\n");

  console.log(`[library-retrieval] scopes=${opts.scopes.join(",")} → ${knowledgeItems.length} KIs, ${playbooks.length} playbooks`);

  return {
    knowledgeItems,
    playbooks,
    contextString,
    counts: { kis: knowledgeItems.length, playbooks: playbooks.length },
  };
}
