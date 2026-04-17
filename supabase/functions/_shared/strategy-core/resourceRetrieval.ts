// ════════════════════════════════════════════════════════════════
// Strategy Core — Resource Retrieval
//
// Surgical fix for the single biggest credibility gap in Strategy:
// the assistant was answering questions about "templates / examples /
// calculators" without ever querying the resources table.
//
// This module is intentionally small and deterministic:
//   1. Pull candidate phrases out of the user's message (quoted strings,
//      capitalized title-like spans, and known resource intent words).
//   2. Run exact + near-exact ILIKE matches against resources.title
//      (and tags + description as a soft fallback).
//   3. Layer in account/opportunity-linked resources when the chat is
//      scoped to one. (Today these joins are empty — see DATA_REALITY
//      below — but the wiring is here so the moment the user starts
//      tagging resources to accounts/opps it works.)
//   4. If the user clearly asked for a kind of artifact (template /
//      example / calculator / business case / playbook / framework /
//      checklist), do a category-style title scan as a backstop.
//   5. Return BOTH a structured payload (so callers can reason about
//      "did we find anything?") and a prompt-ready context block that
//      enforces the admit-absence contract.
//
// What this module deliberately does NOT do:
//   - It does not invent a new schema. No new tables, no new columns.
//   - It does not embed-search. Pure SQL ILIKE for predictability.
//   - It does not retrieve content bodies — only titles, descriptions
//     and a short snippet — to keep prompt budgets honest.
//
// DATA_REALITY (as of build time, verified against production):
//   - resources.title is well populated (~785 rows).
//   - resources.is_template is FALSE for every row today.
//   - resources.account_id is NULL for every row today.
//   - resources.opportunity_id is NULL for every row today.
//   - Implication: account/opp-linked retrieval will return 0 rows
//     until the user starts linking. Title matching is what carries
//     this PR. The structured "matchKind" tags on each hit make this
//     visible to the model so it can be honest about what it found.
// ════════════════════════════════════════════════════════════════

export interface RetrievedResource {
  id: string;
  title: string;
  description: string | null;
  resource_type: string;
  is_template: boolean | null;
  template_category: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  tags: string[] | null;
  /** How this resource was matched. Lets the prompt explain itself. */
  matchKind:
    | "exact_title"
    | "near_exact_title"
    | "phrase_in_title"
    | "account_linked"
    | "opportunity_linked"
    | "category_intent";
  /** Human-readable reason — surfaced in the prompt block. */
  matchReason: string;
}

export interface ResourceRetrievalResult {
  /** All hits, deduped, ranked best → worst. */
  hits: RetrievedResource[];
  /** True if the user clearly asked for a named/templated artifact. */
  userAskedForResource: boolean;
  /** Phrases we extracted from the user's message and searched for. */
  extractedPhrases: string[];
  /** Categories we inferred from the user's message ("template", "calculator", …). */
  inferredCategories: string[];
  /** Prompt-ready block. Always non-empty when userAskedForResource is true. */
  contextBlock: string;
}

interface SupabaseLike {
  from: (table: string) => any;
}

// ── Phrase extraction ─────────────────────────────────────────────

/** Words that indicate the user is asking for a stored artifact. */
const RESOURCE_INTENT_WORDS = [
  "template",
  "templates",
  "example",
  "examples",
  "calculator",
  "calculators",
  "playbook",
  "playbooks",
  "framework",
  "frameworks",
  "checklist",
  "checklists",
  "business case",
  "roi",
  "one-pager",
  "one pager",
  "deck",
  "doc",
  "document",
  "worksheet",
];

/** Stop tokens we don't want as a "name". */
const STOP_TOKENS = new Set(
  [
    "the",
    "a",
    "an",
    "of",
    "for",
    "to",
    "from",
    "in",
    "on",
    "with",
    "and",
    "or",
    "our",
    "my",
    "this",
    "that",
    "any",
    "do",
    "we",
    "have",
    "use",
    "build",
    "build",
    "let's",
    "lets",
    "please",
    "ok",
    "okay",
    "i'm",
    "im",
    "i",
  ],
);

/** True if the user message clearly references a stored artifact. */
export function userAskedForResource(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  // Real paired quote (excludes ' to avoid contraction false positives).
  if (/["“”`][^"“”`]{2,}["“”`]/.test(text)) return true;
  for (const w of RESOURCE_INTENT_WORDS) {
    if (lower.includes(w)) return true;
  }
  // "use … X" / "build off … X" patterns. We deliberately exclude
  // "like" here because it is far too broad ("the weather is like…").
  if (/\b(use|based on|based off|build off|built off|model after)\s+/i.test(text)) {
    return true;
  }
  return false;
}

/** Pull quoted strings out of the message.
 *  Note: we deliberately exclude the straight apostrophe (') from the
 *  delimiter set. Apostrophes appear in contractions ("Let's", "Kevin
 *  Dorsey's") and would otherwise pair across the sentence and produce
 *  garbage spans like "s build this off Kevin Dorsey". Real resource
 *  titles are quoted with " or “ ” or ` — never with bare apostrophes.
 */
function extractQuotedPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /["“”`]([^"“”`]{2,80})["“”`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const phrase = m[1].trim();
    if (phrase.length >= 3) out.push(phrase);
  }
  return out;
}

/**
 * Pull capitalized title-like spans (≥2 consecutive Capitalized words,
 * or a Proper Name + a noun like "ROI Calculator"). This is the path
 * that catches "Kevin Dorsey ROI calculator" without requiring quotes.
 *
 * Important: spans must START and END on a capitalized/ALL-CAPS token.
 * Internal lowercase joiners (of/the/for/and) are allowed in the middle
 * but must not appear at either end. This keeps "What's the" out.
 */
function extractCapitalizedSpans(text: string): string[] {
  const out: string[] = [];
  // A capitalized token: "Kevin", "ROI", "Dorsey" (excluding trailing 's so
  // possessives don't poison the span). We tokenize first, then walk —
  // simpler and far more reliable than a single mega-regex.
  const TOKEN_RE = /[A-Za-z][A-Za-z0-9\-]*/g;
  const JOINERS = new Set(["of", "the", "for", "and"]);

  type Tok = { raw: string; start: number; end: number };
  const tokens: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    tokens.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
  }

  const isCap = (t: string) =>
    /^[A-Z]{2,5}$/.test(t) || /^[A-Z][a-zA-Z0-9\-]+$/.test(t);
  const isJoin = (t: string) => JOINERS.has(t.toLowerCase());

  let i = 0;
  while (i < tokens.length) {
    if (!isCap(tokens[i].raw)) { i++; continue; }
    // Walk forward as long as we see CAP or (JOIN followed by CAP).
    let j = i;
    while (j + 1 < tokens.length) {
      const next = tokens[j + 1];
      if (isCap(next.raw)) { j++; continue; }
      if (isJoin(next.raw) && j + 2 < tokens.length && isCap(tokens[j + 2].raw)) {
        j += 2; continue;
      }
      break;
    }
    if (j > i) {
      const phrase = tokens.slice(i, j + 1).map((t) => t.raw).join(" ");
      // Filter pure-stopword runs and require ≥ 4 chars total.
      if (
        phrase.length >= 4 &&
        !phrase.split(/\s+/).every((w) => STOP_TOKENS.has(w.toLowerCase()))
      ) {
        out.push(phrase);
      }
    }
    i = j + 1;
  }
  return out;
}

/** Categories the user clearly asked for ("template", "calculator", …). */
export function inferResourceCategories(text: string): string[] {
  const lower = (text || "").toLowerCase();
  const found = new Set<string>();
  if (/\btemplate(s)?\b/.test(lower)) found.add("template");
  if (/\bexample(s)?\b/.test(lower)) found.add("example");
  if (/\bcalculator(s)?\b/.test(lower)) found.add("calculator");
  if (/\bbusiness case\b/.test(lower)) found.add("business case");
  if (/\bone[- ]pager\b/.test(lower)) found.add("one-pager");
  if (/\bplaybook(s)?\b/.test(lower)) found.add("playbook");
  if (/\bframework(s)?\b/.test(lower)) found.add("framework");
  if (/\bchecklist(s)?\b/.test(lower)) found.add("checklist");
  if (/\broi\b/.test(lower)) found.add("roi");
  return [...found];
}

/** Combine quoted + capitalized spans, dedupe case-insensitively. */
export function extractCandidatePhrases(text: string): string[] {
  const all = [...extractQuotedPhrases(text), ...extractCapitalizedSpans(text)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of all) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// ── ILIKE escaping ────────────────────────────────────────────────

/** Escape % and _ so user phrases don't become wildcards. */
function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ── Main retrieval ────────────────────────────────────────────────

const SAFE_FIELDS =
  "id,title,description,resource_type,is_template,template_category,account_id,opportunity_id,tags";

const HARD_LIMIT = 12;

export async function retrieveResourceContext(
  supabase: SupabaseLike,
  userId: string,
  args: {
    userMessage: string;
    accountId?: string | null;
    opportunityId?: string | null;
  },
): Promise<ResourceRetrievalResult> {
  const userMessage = (args.userMessage || "").trim();
  const phrases = extractCandidatePhrases(userMessage);
  const categories = inferResourceCategories(userMessage);
  const askedFor = userAskedForResource(userMessage) || phrases.length > 0;

  const all: RetrievedResource[] = [];
  const seen = new Set<string>();

  const push = (rows: any[] | null | undefined, kind: RetrievedResource["matchKind"], reason: (r: any) => string) => {
    if (!rows) return;
    for (const r of rows) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      all.push({
        id: r.id,
        title: r.title || "",
        description: r.description ?? null,
        resource_type: r.resource_type || "document",
        is_template: r.is_template ?? null,
        template_category: r.template_category ?? null,
        account_id: r.account_id ?? null,
        opportunity_id: r.opportunity_id ?? null,
        tags: r.tags ?? null,
        matchKind: kind,
        matchReason: reason(r),
      });
    }
  };

  // ── 1. Exact title (case-insensitive) for each phrase ─────────
  for (const phrase of phrases) {
    if (all.length >= HARD_LIMIT) break;
    try {
      const { data } = await supabase
        .from("resources")
        .select(SAFE_FIELDS)
        .eq("user_id", userId)
        .ilike("title", escapeIlike(phrase))
        .limit(3);
      push(data, "exact_title", () => `Exact title match for "${phrase}"`);
    } catch (e) {
      console.warn("[resourceRetrieval] exact title query failed:", (e as Error).message);
    }
  }

  // ── 2. Near-exact (contains the phrase) ──────────────────────
  for (const phrase of phrases) {
    if (all.length >= HARD_LIMIT) break;
    try {
      const { data } = await supabase
        .from("resources")
        .select(SAFE_FIELDS)
        .eq("user_id", userId)
        .ilike("title", `%${escapeIlike(phrase)}%`)
        .limit(4);
      push(data, "near_exact_title", () => `Title contains "${phrase}"`);
    } catch (e) {
      console.warn("[resourceRetrieval] near-exact query failed:", (e as Error).message);
    }
  }

  // ── 3. Account-linked resources ──────────────────────────────
  if (args.accountId && all.length < HARD_LIMIT) {
    try {
      const { data } = await supabase
        .from("resources")
        .select(SAFE_FIELDS)
        .eq("user_id", userId)
        .eq("account_id", args.accountId)
        .order("updated_at", { ascending: false })
        .limit(5);
      push(data, "account_linked", () => `Linked to this account`);
    } catch (e) {
      console.warn("[resourceRetrieval] account-linked query failed:", (e as Error).message);
    }
  }

  // ── 4. Opportunity-linked resources ──────────────────────────
  if (args.opportunityId && all.length < HARD_LIMIT) {
    try {
      const { data } = await supabase
        .from("resources")
        .select(SAFE_FIELDS)
        .eq("user_id", userId)
        .eq("opportunity_id", args.opportunityId)
        .order("updated_at", { ascending: false })
        .limit(5);
      push(data, "opportunity_linked", () => `Linked to this opportunity`);
    } catch (e) {
      console.warn("[resourceRetrieval] opp-linked query failed:", (e as Error).message);
    }
  }

  // ── 5. Category intent backstop (only when user clearly asked) ─
  if (askedFor && all.length < HARD_LIMIT) {
    for (const cat of categories) {
      if (all.length >= HARD_LIMIT) break;
      try {
        const { data } = await supabase
          .from("resources")
          .select(SAFE_FIELDS)
          .eq("user_id", userId)
          .ilike("title", `%${escapeIlike(cat)}%`)
          .order("updated_at", { ascending: false })
          .limit(4);
        push(data, "category_intent", () => `Title mentions "${cat}"`);
      } catch (e) {
        console.warn("[resourceRetrieval] category query failed:", (e as Error).message);
      }
    }
  }

  // ── Rank: exact > near_exact > entity_linked > category ──────
  // Inside each tier, prefer rows whose resource_type matches the
  // user's inferred category. This is the fix for "executive business
  // case template" returning transcripts ahead of the actual template.
  const rank: Record<RetrievedResource["matchKind"], number> = {
    exact_title: 0,
    near_exact_title: 1,
    account_linked: 2,
    opportunity_linked: 3,
    phrase_in_title: 4,
    category_intent: 5,
  };
  // Map inferred categories → resource_type values that should be boosted.
  const CATEGORY_TYPE_BOOST: Record<string, string[]> = {
    template: ["template"],
    calculator: ["template", "document"], // calculators are stored as templates/docs
    framework: ["framework", "template"],
    playbook: ["framework", "template", "document"],
    "business case": ["template", "document"],
    "one-pager": ["template", "document"],
    checklist: ["template", "document"],
    example: ["template", "document", "presentation"],
  };
  const boostedTypes = new Set<string>();
  for (const cat of categories) {
    for (const t of CATEGORY_TYPE_BOOST[cat] ?? []) boostedTypes.add(t);
  }
  const typeBoost = (r: RetrievedResource) =>
    boostedTypes.size > 0 && boostedTypes.has(r.resource_type) ? 0 : 1;

  all.sort((a, b) => {
    const t = rank[a.matchKind] - rank[b.matchKind];
    if (t !== 0) return t;
    return typeBoost(a) - typeBoost(b);
  });

  const hits = all.slice(0, HARD_LIMIT);

  return {
    hits,
    userAskedForResource: askedFor,
    extractedPhrases: phrases,
    inferredCategories: categories,
    contextBlock: renderResourceContextBlock({
      hits,
      userAskedForResource: askedFor,
      extractedPhrases: phrases,
      inferredCategories: categories,
    }),
  };
}

// ── Prompt block ──────────────────────────────────────────────────

/**
 * Render a self-contained block for the system prompt. The contract:
 *   - When hits exist: list them with id + title + match reason and
 *     instruct the model to cite by exact title.
 *   - When the user asked for a resource and no hits: tell the model
 *     to admit absence and offer to help build it from scratch — and
 *     forbid invented titles.
 *   - When the user did NOT ask for a resource: emit nothing.
 */
export function renderResourceContextBlock(args: {
  hits: RetrievedResource[];
  userAskedForResource: boolean;
  extractedPhrases: string[];
  inferredCategories: string[];
}): string {
  const { hits, userAskedForResource: asked, extractedPhrases, inferredCategories } = args;

  if (!asked && hits.length === 0) return "";

  const header = "=== LIBRARY RESOURCES (resources table — exact retrievals only) ===";

  if (hits.length === 0) {
    const search = [
      ...extractedPhrases.map((p) => `"${p}"`),
      ...inferredCategories.map((c) => `category:${c}`),
    ].join(", ") || "(no specific phrase extracted)";
    return [
      header,
      `No matching resource was found in the user's library.`,
      `Searched for: ${search}.`,
      ``,
      `RULES (mandatory):`,
      `- Do NOT invent a template, calculator, example, playbook, or framework that was not retrieved here.`,
      `- Tell the user explicitly: "I don't see a matching resource in your library."`,
      `- Then offer to either (a) build one from scratch with them, or (b) search a different name they have in mind.`,
      `- Do NOT pretend a resource exists. Do NOT cite a title that is not listed above.`,
    ].join("\n");
  }

  const lines: string[] = [header];
  lines.push(
    `Retrieved ${hits.length} resource${hits.length === 1 ? "" : "s"} from the user's library. ` +
      `Cite them by EXACT title in the form RESOURCE["<title>"] when you reference them. ` +
      `Do NOT invent additional titles.`,
  );
  lines.push("");

  for (const h of hits) {
    const idShort = h.id.slice(0, 8);
    const flags: string[] = [h.resource_type];
    if (h.is_template) flags.push("template");
    if (h.template_category) flags.push(`cat:${h.template_category}`);
    if (h.account_id) flags.push("account-linked");
    if (h.opportunity_id) flags.push("opp-linked");
    lines.push(`- RESOURCE[${idShort}] "${h.title}" — ${flags.join(", ")}`);
    lines.push(`    why: ${h.matchReason}`);
    if (h.description) {
      const desc = h.description.replace(/\s+/g, " ").trim().slice(0, 180);
      if (desc) lines.push(`    desc: ${desc}`);
    }
  }

  lines.push("");
  lines.push(`RULES (mandatory):`);
  lines.push(
    `- If the user named a specific resource and it is NOT in the list above, say so plainly: "I don't see that exact resource in your library."`,
  );
  lines.push(
    `- Never fabricate a template, calculator, or example that is not in this list.`,
  );
  lines.push(
    `- Prefer suggesting the closest match by EXACT title rather than describing one generically.`,
  );

  return lines.join("\n");
}
