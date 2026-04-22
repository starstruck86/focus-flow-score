// ════════════════════════════════════════════════════════════════
// Library Cards retrieval
// Parallel to libraryRetrieval.ts. NOT a replacement.
// Used only by new TaskHandlers (account_brief, ninety_day_plan).
// Returns empty result on missing data; never throws on data issues.
// ════════════════════════════════════════════════════════════════

export type LibraryRole = "standard" | "tactic" | "pattern" | "exemplar";

export interface LibraryCard {
  id: string;
  source_type: "knowledge_item" | "playbook" | "transcript";
  source_ids: string[];
  library_role: LibraryRole;
  title: string;
  when_to_use: string | null;
  the_move: string;
  why_it_works: string | null;
  anti_patterns: string[] | null;
  example_snippet: string | null;
  applies_to_contexts: string[] | null;
  confidence: number | null;
  score: number;
}

export interface CardRetrievalResult {
  cards: LibraryCard[];
  contextString: string;
  counts: Record<LibraryRole, number>;
}

interface GetCardsOpts {
  maxCards?: number;
  maxTokensApprox?: number;
}

const DEFAULT_MAX_CARDS = 8;
const DEFAULT_MAX_TOKENS = 2500;

function emptyResult(): CardRetrievalResult {
  return {
    cards: [],
    contextString: "",
    counts: { standard: 0, tactic: 0, pattern: 0, exemplar: 0 },
  };
}

function scoreCard(
  card: Pick<LibraryCard, "library_role" | "title" | "when_to_use" | "the_move" | "applies_to_contexts" | "anti_patterns" | "confidence">,
  scopes: string[],
  roleWeights: Partial<Record<LibraryRole, number>>,
): number {
  if (!scopes.length) return 0;
  const haystack = [
    card.title,
    card.when_to_use ?? "",
    card.the_move ?? "",
    (card.applies_to_contexts ?? []).join(" "),
    (card.anti_patterns ?? []).join(" "),
  ].join(" \n ").toLowerCase();

  let hits = 0;
  for (const scope of scopes) {
    const needle = scope.toLowerCase().trim();
    if (!needle) continue;
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const m = haystack.match(re);
    if (m) hits += m.length * 2;
    else if (haystack.includes(needle)) hits += 1;
  }
  if (hits === 0) return 0;

  const roleWeight = roleWeights[card.library_role] ?? 0.5;
  const confidence = typeof card.confidence === "number" ? card.confidence : 0.5;
  return hits * roleWeight * confidence;
}

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function renderCard(card: LibraryCard): string {
  const idShort = card.id.slice(0, 8);
  const lines: string[] = [];
  lines.push(`CARD[${idShort}] ${card.library_role} — "${card.title}"`);
  if (card.when_to_use) lines.push(`  When: ${card.when_to_use}`);
  lines.push(`  Move: ${card.the_move}`);
  if (card.why_it_works) lines.push(`  Why: ${card.why_it_works}`);
  if (card.anti_patterns?.length) lines.push(`  Watch out: ${card.anti_patterns.slice(0, 3).join("; ")}`);
  if (card.example_snippet) lines.push(`  Example: ${card.example_snippet}`);
  return lines.join("\n");
}

export async function getCards(
  supabase: any,
  userId: string,
  scopes: string[],
  roleWeights: Partial<Record<LibraryRole, number>>,
  opts: GetCardsOpts = {},
): Promise<CardRetrievalResult> {
  if (!userId || !scopes || scopes.length === 0) return emptyResult();

  const maxCards = opts.maxCards ?? DEFAULT_MAX_CARDS;
  const maxTokens = opts.maxTokensApprox ?? DEFAULT_MAX_TOKENS;

  let rows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("library_cards")
      .select(
        "id, source_type, source_ids, library_role, title, when_to_use, the_move, why_it_works, anti_patterns, example_snippet, applies_to_contexts, confidence",
      )
      .eq("user_id", userId)
      .limit(500);
    if (error) {
      console.warn("[library-cards] fetch error:", error.message);
      return emptyResult();
    }
    rows = data ?? [];
  } catch (e) {
    console.warn("[library-cards] fetch threw:", (e as Error).message);
    return emptyResult();
  }

  if (!rows.length) return emptyResult();

  const scored: LibraryCard[] = rows
    .map((r) => {
      const score = scoreCard(r as any, scopes, roleWeights);
      return { ...r, score } as LibraryCard;
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ac = a.confidence ?? 0;
      const bc = b.confidence ?? 0;
      return bc - ac;
    })
    .slice(0, maxCards);

  // Trim to token budget
  const trimmed: LibraryCard[] = [];
  let tokens = 0;
  for (const c of scored) {
    const t = approxTokens(renderCard(c));
    if (tokens + t > maxTokens) break;
    trimmed.push(c);
    tokens += t;
  }

  const contextString = trimmed.length
    ? `=== LIBRARY CARDS (cite as CARD[id-prefix] when used) ===\n${trimmed.map(renderCard).join("\n\n")}`
    : "";

  const counts: Record<LibraryRole, number> = { standard: 0, tactic: 0, pattern: 0, exemplar: 0 };
  for (const c of trimmed) counts[c.library_role] = (counts[c.library_role] ?? 0) + 1;

  console.log(
    `[library-cards] user=${userId.slice(0, 8)} scopes=${scopes.length} → ${trimmed.length} cards, ~${tokens} tokens`,
  );

  return { cards: trimmed, contextString, counts };
}
