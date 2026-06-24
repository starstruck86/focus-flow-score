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
  /**
   * Situation-classifier pick (task 1.2). When provided and non-null,
   * the playbook is guaranteed to appear at position 0 of the returned
   * `playbooks` array — even if scope-based scoring missed it.
   */
  preferredPlaybookId?: string | null;
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

// ── Scope → spider_dimension pre-filter ──────────────────────────
// Maps situation-classifier scopes (topic keywords) to the
// spider_dimension values used in knowledge_items. When scopes match
// known dimensions, Postgres filters to those dimensions first so
// keyword scoring works over a relevant, ranked candidate set instead
// of a random 500-row slice of 33K+ KIs.

const CANDIDATE_LIMIT = 800;

const SCOPE_TO_DIMENSION: Readonly<Record<string, string>> = {
  // Competitive
  competitive: "competitive",
  adjust: "competitive",
  appsflyer: "competitive",
  kochava: "competitive",
  singular: "competitive",
  displacement: "competitive",
  mmp_switch: "competitive",
  // Deal control
  deal_control: "deal_control",
  closing: "deal_control",
  negotiation: "deal_control",
  discount: "deal_control",
  renewal: "deal_control",
  qbr: "deal_control",
  usage: "deal_control",
  consolidation: "deal_control",
  vendor: "deal_control",
  // Expansion
  expansion: "expansion_strategy",
  expansion_strategy: "expansion_strategy",
  whitespace: "expansion_strategy",
  upsell: "expansion_strategy",
  new_bu: "expansion_strategy",
  sub_entity: "expansion_strategy",
  // Discovery
  discovery: "discovery",
  // Stakeholder
  stakeholder: "stakeholder_navigation",
  stakeholder_navigation: "stakeholder_navigation",
  champion: "stakeholder_navigation",
  executive: "stakeholder_navigation",
  c_suite: "c_suite_engagement",
  // Product / Branch knowledge
  product: "product_knowledge",
  product_knowledge: "product_knowledge",
  deep_linking: "product_knowledge",
  attribution: "product_knowledge",
  web_to_app: "product_knowledge",
  mmp: "product_knowledge",
  measurement: "product_knowledge",
  branch: "product_knowledge",
  // Objection handling
  objection: "objection_handling",
  objection_handling: "objection_handling",
  build_internally: "objection_handling",
  // Messaging
  messaging: "messaging",
  // Qualification
  qualification: "qualification",
};

function mapScopesToDimensions(scopes: string[]): string[] {
  const dims = new Set<string>();
  for (const scope of scopes) {
    const key = scope.toLowerCase().replace(/[-\s]/g, "_");
    const dim = SCOPE_TO_DIMENSION[key];
    if (dim) dims.add(dim);
  }
  return Array.from(dims);
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
    // Stage A: Postgres-side pre-filter
    // Map scopes → spider_dimension values. If any match, restrict to
    // those dimensions so keyword scoring sees relevant KIs, not a
    // random slice. Always ORDER BY confidence_score DESC so the
    // highest-quality KIs enter the scoring pool first.
    const scopedDimensions = mapScopesToDimensions(opts.scopes);
    let kiQuery = supabase
      .from("knowledge_items")
      .select(
        "id, title, chapter, knowledge_type, spider_dimension, tactic_summary, why_it_matters, when_to_use, how_to_execute, framework, confidence_score, applies_to_contexts, tags, active",
      )
      .eq("user_id", userId)
      .eq("active", true)
      .order("confidence_score", { ascending: false });
    if (scopedDimensions.length > 0) {
      kiQuery = kiQuery.in("spider_dimension", scopedDimensions);
    }
    const { data: kiRows } = await kiQuery.limit(CANDIDATE_LIMIT);

    if (kiRows?.length) {
      knowledgeItems = (kiRows as any[])
        .map((r) => {
          const searchText = [
            r.title, r.chapter, r.knowledge_type, r.framework,
            r.spider_dimension,
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
          spider_dimension: row.spider_dimension,
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

  // ── Preferred-playbook pin (task 1.2) ──
  // Situation classifier upstream picks a specific playbook by ID. If
  // scope scoring already surfaced it, hoist it to rank 1; if it
  // missed, fetch the row directly and insert it at position 0. Cap
  // remains `maxPlaybooks`.
  if (opts.preferredPlaybookId) {
    try {
      const preferredId = opts.preferredPlaybookId;
      const existingIdx = playbooks.findIndex((p) => p.id === preferredId);
      if (existingIdx > 0) {
        const [hoisted] = playbooks.splice(existingIdx, 1);
        playbooks.unshift(hoisted);
        console.log(`[library-retrieval] hoisted preferred playbook id=${preferredId}`);
      } else if (existingIdx < 0) {
        const { data: pinnedRow } = await supabase
          .from("playbooks")
          .select(
            "id, title, problem_type, when_to_use, why_it_matters, tactic_steps, talk_tracks, key_questions, traps, anti_patterns, what_great_looks_like, common_mistakes, confidence_score",
          )
          .eq("id", preferredId)
          .eq("user_id", userId)
          .maybeSingle();
        if (pinnedRow) {
          const pinned: RetrievedPlaybook = {
            id: pinnedRow.id,
            title: pinnedRow.title,
            problem_type: pinnedRow.problem_type,
            when_to_use: pinnedRow.when_to_use,
            why_it_matters: pinnedRow.why_it_matters,
            tactic_steps: pinnedRow.tactic_steps,
            talk_tracks: pinnedRow.talk_tracks,
            key_questions: pinnedRow.key_questions,
            traps: pinnedRow.traps,
            anti_patterns: pinnedRow.anti_patterns,
            what_great_looks_like: pinnedRow.what_great_looks_like,
            common_mistakes: pinnedRow.common_mistakes,
            confidence_score: pinnedRow.confidence_score,
            score: Number.MAX_SAFE_INTEGER,
          };
          playbooks = [pinned, ...playbooks].slice(0, maxPlaybooks);
          console.log(`[library-retrieval] pinned preferred playbook id=${preferredId}`);
        } else {
          console.warn(`[library-retrieval] preferred playbook not found id=${preferredId}`);
        }
      }
    } catch (e) {
      console.warn("[library-retrieval] preferred playbook pin failed:", (e as Error).message);
    }
  }

  const contextString = formatLibraryContext(knowledgeItems, playbooks);

  console.log(`[library-retrieval] scopes=${opts.scopes.join(",")} → ${knowledgeItems.length} KIs, ${playbooks.length} playbooks${opts.preferredPlaybookId ? ` preferred=${opts.preferredPlaybookId}` : ""}`);

  return {
    knowledgeItems,
    playbooks,
    contextString,
    counts: { kis: knowledgeItems.length, playbooks: playbooks.length },
  };
}

// ════════════════════════════════════════════════════════════════
// Shared formatter — also used by callers that pin a playbook
// (situation classifier) and need to rebuild the contextString after
// mutating the playbooks list.
// ════════════════════════════════════════════════════════════════
export function formatLibraryContext(
  knowledgeItems: RetrievedKI[],
  playbooks: RetrievedPlaybook[],
): string {
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
    ? playbooks.map((p, idx) => {
        const isPrimary = idx === 0;
        const lines: string[] = [
          `PLAYBOOK[${p.id.slice(0, 8)}] ${p.title}` +
            (p.problem_type ? ` (${p.problem_type})` : ""),
        ];
        if (p.when_to_use) {
          lines.push(`  When to Use: ${p.when_to_use}`);
        }
        if (p.why_it_matters) {
          lines.push(`  Why It Matters: ${p.why_it_matters}`);
        }
        if (p.tactic_steps?.length) {
          const steps = isPrimary ? p.tactic_steps : p.tactic_steps.slice(0, 4);
          lines.push(`  Steps:\n${steps.map((s, i) => `    ${i + 1}. ${s}`).join("\n")}`);
        }
        if (p.key_questions?.length) {
          const qs = isPrimary ? p.key_questions : p.key_questions.slice(0, 4);
          lines.push(`  Key Questions:\n${qs.map((q) => `    • ${q}`).join("\n")}`);
        }
        if (p.talk_tracks?.length) {
          const tracks = isPrimary ? p.talk_tracks : p.talk_tracks.slice(0, 2);
          lines.push(`  Talk Tracks:\n${tracks.map((t) => `    → ${t}`).join("\n")}`);
        }
        if (p.traps?.length) {
          const traps = isPrimary ? p.traps : p.traps.slice(0, 2);
          lines.push(`  Traps to Avoid:\n${traps.map((t) => `    ⚠ ${t}`).join("\n")}`);
        }
        if (p.anti_patterns?.length) {
          const aps = isPrimary ? p.anti_patterns : p.anti_patterns.slice(0, 3);
          lines.push(`  Anti-Patterns:\n${aps.map((a) => `    ✗ ${a}`).join("\n")}`);
        }
        if (isPrimary && p.what_great_looks_like) {
          const wgll = Array.isArray(p.what_great_looks_like)
            ? p.what_great_looks_like.join("; ")
            : p.what_great_looks_like;
          if (wgll) lines.push(`  What Great Looks Like: ${wgll}`);
        }
        if (isPrimary && p.common_mistakes?.length) {
          lines.push(`  Common Mistakes:\n${p.common_mistakes.map((m) => `    • ${m}`).join("\n")}`);
        }
        return lines.join("\n");
      }).join("\n\n")
    : "";

  return [
    kiBlock ? `=== INTERNAL KNOWLEDGE ITEMS (use these — they are the company's tested intellectual property) ===\n${kiBlock}` : "",
    pbBlock ? `=== PLAYBOOK ACTIVATION — run every step and question from the PRIMARY playbook; use supporting playbooks for additional context ===\n${pbBlock}` : "",
  ].filter(Boolean).join("\n\n");
}
