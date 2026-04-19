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
    | "picked"
    | "exact_title"
    | "near_exact_title"
    | "phrase_in_title"
    | "prior_use"
    | "account_linked"
    | "opportunity_linked"
    | "description_match"
    | "content_match"
    | "category_intent";
  /** Short snippet of the matched body, when matchKind is description/content. */
  matchSnippet?: string;
  /** Human-readable reason — surfaced in the prompt block. */
  matchReason: string;
  /**
   * Larger body excerpt (~2.5KB). Populated ONLY for picked resources so the
   * model can adapt actual structure/claims instead of inventing a generic
   * scaffold. Never populated for incidental hits — keeps prompt budgets honest.
   */
  bodyExcerpt?: string;
  /**
   * Heuristic shape of the picked resource's body. Drives whether the
   * model mirrors a real structure ("structured") or extracts reusable
   * patterns from prose ("unstructured"). Undefined for non-picked hits
   * or when no body is available.
   */
  sourceShape?: "structured" | "unstructured" | "empty";
  /** Short evidence string for sourceShape — surfaced in the prompt. */
  sourceShapeReason?: string;
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

/** True when the user is asking about prior usage on this account/thread. */
export function userAskedForPriorUse(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  // Phrases that imply continuity / "what we used before".
  return (
    /\b(last time|previously|before|earlier|prior|the one we used|same (resource|template|playbook|calculator|deck|doc)|that (template|deck|doc|playbook|calculator) we)\b/.test(
      lower,
    )
  );
}

export async function retrieveResourceContext(
  supabase: SupabaseLike,
  userId: string,
  args: {
    userMessage: string;
    accountId?: string | null;
    opportunityId?: string | null;
    /** Current thread id — used to scope/exclude when pulling prior-use rows. */
    threadId?: string | null;
    /**
     * Sidecar: resource IDs the user explicitly picked (e.g. via /library)
     * this turn. These are resolved by ID FIRST and inserted at the top of
     * the hit list so grounding never depends on title-string coincidence.
     */
    pickedResourceIds?: string[];
  },
): Promise<ResourceRetrievalResult> {
  const userMessage = (args.userMessage || "").trim();
  const phrases = extractCandidatePhrases(userMessage);
  const categories = inferResourceCategories(userMessage);
  const askedForPrior = userAskedForPriorUse(userMessage);
  const pickedIds = Array.isArray(args.pickedResourceIds)
    ? args.pickedResourceIds.filter((s) => typeof s === "string" && s.length > 0)
    : [];
  // A picked resource always counts as "asked for one" — the user's
  // explicit selection is the strongest possible signal of intent.
  const askedFor = userAskedForResource(userMessage) || phrases.length > 0 || askedForPrior || pickedIds.length > 0;

  const all: RetrievedResource[] = [];
  const seen = new Set<string>();

  const push = (
    rows: any[] | null | undefined,
    kind: RetrievedResource["matchKind"],
    reason: (r: any) => string,
    snippetFor?: (r: any) => string | undefined,
  ) => {
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
        matchSnippet: snippetFor ? snippetFor(r) : undefined,
        bodyExcerpt: typeof r._bodyExcerpt === "string" ? r._bodyExcerpt : undefined,
        sourceShape: r._sourceShape,
        sourceShapeReason: r._sourceShapeReason,
      });
    }
  };

  /** Build a ±80-char snippet around the first hit of `needle` in `hay`. */
  const snippetAround = (hay: string | null | undefined, needle: string): string | undefined => {
    if (!hay || !needle) return undefined;
    const idx = hay.toLowerCase().indexOf(needle.toLowerCase());
    if (idx < 0) return undefined;
    const start = Math.max(0, idx - 80);
    const end = Math.min(hay.length, idx + needle.length + 80);
    const slice = hay.slice(start, end).replace(/\s+/g, " ").trim();
    return (start > 0 ? "…" : "") + slice + (end < hay.length ? "…" : "");
  };

  // ── 0. Picked resources (sidecar IDs from /library) ───────────
  // Resolved by ID first so grounding never depends on title coincidence.
  // Scoped to the requesting user so a hostile client can't pull rows
  // belonging to another seller.
  //
  // We also pull a ~2.5KB body excerpt for picked resources so the model
  // can adapt actual structure/claims from the source — not just cite the
  // title. This is the difference between "grounded by identity" and
  // "grounded by content depth".
  if (pickedIds.length > 0) {
    try {
      const { data } = await supabase
        .from("resources")
        .select(SAFE_FIELDS + ",content")
        .eq("user_id", userId)
        .in("id", pickedIds.slice(0, HARD_LIMIT))
        .limit(HARD_LIMIT);
      // Build a body excerpt + source-shape per row before pushing — the
      // push() helper picks them up via the _bodyExcerpt / _sourceShape
      // sidecar fields.
      const enriched = (data || []).map((r: any) => {
        const raw = typeof r.content === "string" ? r.content : "";
        // Collapse whitespace, cap at ~2500 chars. Keep enough surface for
        // the model to mirror section logic and reuse real claims.
        const trimmed = raw.replace(/\s+/g, " ").trim();
        const _bodyExcerpt = trimmed
          ? trimmed.slice(0, 2500) + (trimmed.length > 2500 ? "…" : "")
          : undefined;
        // Detect on the FULL raw body (not the trimmed excerpt) so we don't
        // misread a transcript as "structured" just because the first 2.5KB
        // happens to contain a heading.
        const shape = detectSourceShape(raw, {
          resource_type: r.resource_type,
          is_template: r.is_template,
        });
        // Strip the heavy content blob before handing back to push().
        const { content: _drop, ...rest } = r;
        return {
          ...rest,
          _bodyExcerpt,
          _sourceShape: shape.shape,
          _sourceShapeReason: shape.reason,
        };
      });
      push(enriched, "picked", () => `User picked from /library this turn`);
    } catch (e) {
      console.warn("[resourceRetrieval] picked-id resolve failed:", (e as Error).message);
    }
  }

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

  // ── 2b. Body match: description + content ────────────────────
  // This is the path that catches "the Kevin Dorsey thing about ROI"
  // when no title contains those words but the body does. We search
  // description first (cheap, signal-dense) and fall back to content
  // (the full transcript/doc body, ~23KB avg in production).
  //
  // Important: we limit each phrase tightly (3 hits) and only fetch
  // a description preview — never the full content blob — to keep
  // prompt budgets honest. The matchSnippet is built post-fetch
  // from a separate small content slice via the
  // get_resource_content_prefixes RPC if needed; for now we surface
  // the description as the snippet when it contains the phrase, else
  // a generic "matched in body" reason.
  for (const phrase of phrases) {
    if (all.length >= HARD_LIMIT) break;
    const escaped = `%${escapeIlike(phrase)}%`;
    try {
      const { data } = await supabase
        .from("resources")
        .select(SAFE_FIELDS + ",content")
        .eq("user_id", userId)
        .or(`description.ilike.${escaped},content.ilike.${escaped}`)
        .limit(4);
      // Strip content blob from rows before pushing (don't store 20KB on each hit).
      const lean = (data || []).map((r: any) => {
        const inDesc = (r.description || "").toLowerCase().includes(phrase.toLowerCase());
        const snip = inDesc
          ? snippetAround(r.description, phrase)
          : snippetAround(r.content, phrase);
        return { ...r, _snip: snip, _inDesc: inDesc };
      });
      push(
        lean,
        // Tag as description_match when phrase is in description (stronger
        // signal — descriptions are curated), else content_match.
        // We can't split a single push() across kinds, so split the array.
        "description_match" as any,
        (_r: any) => `Phrase "${phrase}" appears in resource body`,
        (r: any) => r._snip,
      );
    } catch (e) {
      console.warn("[resourceRetrieval] body search failed:", (e as Error).message);
    }
  }

  // Re-tag: rows where the phrase was only in content get content_match.
  for (const h of all) {
    if (h.matchKind !== "description_match") continue;
    // We didn't carry _inDesc onto the cleaned hit; re-derive cheaply
    // from the snippet+description. If snippet appears in description,
    // keep description_match; otherwise downgrade to content_match.
    const desc = (h.description || "").toLowerCase();
    const snip = (h.matchSnippet || "").toLowerCase().replace(/^…|…$/g, "").trim();
    if (snip && !desc.includes(snip.slice(0, Math.min(40, snip.length)))) {
      h.matchKind = "content_match";
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

  // ── 4b. Prior-use resources for this account (cross-thread memory) ─
  // This is the read side of strategy_thread_resources. When the user
  // asks "what did we use last time on this account?" — or any time we
  // have an account context and prior writes exist — pull the resources
  // we previously cited on threads scoped to this account.
  if (args.accountId && all.length < HARD_LIMIT) {
    try {
      // Step 1: find prior-use resource_ids for any thread linked to
      // this account (excluding the current thread).
      const { data: priorRows } = await supabase
        .from("strategy_thread_resources")
        .select("resource_id, created_at, thread_id, strategy_threads!inner(linked_account_id)")
        .eq("user_id", userId)
        .eq("source_type", "cited")
        .eq("strategy_threads.linked_account_id", args.accountId)
        .order("created_at", { ascending: false })
        .limit(20);
      const priorIds: string[] = [];
      const seenIds = new Set<string>();
      for (const r of (priorRows || []) as any[]) {
        if (!r?.resource_id) continue;
        if (args.threadId && r.thread_id === args.threadId) continue;
        if (seenIds.has(r.resource_id)) continue;
        seenIds.add(r.resource_id);
        priorIds.push(r.resource_id);
        if (priorIds.length >= 5) break;
      }
      if (priorIds.length > 0) {
        const { data } = await supabase
          .from("resources")
          .select(SAFE_FIELDS)
          .eq("user_id", userId)
          .in("id", priorIds);
        push(data, "prior_use", () => `Used previously on this account`);
      }
    } catch (e) {
      console.warn("[resourceRetrieval] prior-use query failed:", (e as Error).message);
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

  // ── Rank: exact > near_exact > prior_use > entity_linked > category ──
  // Inside each tier, prefer rows whose resource_type matches the
  // user's inferred category. This is the fix for "executive business
  // case template" returning transcripts ahead of the actual template.
  const rank: Record<RetrievedResource["matchKind"], number> = {
    // picked beats everything — the user's explicit selection is the
    // strongest possible grounding signal and must never be reordered
    // behind a fuzzy title match.
    picked: -1,
    exact_title: 0,
    near_exact_title: 1,
    prior_use: 2,
    account_linked: 3,
    opportunity_linked: 4,
    phrase_in_title: 5,
    description_match: 6,
    content_match: 7,
    category_intent: 8,
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

  const pickedHits = hits.filter((h) => h.matchKind === "picked");
  const otherHits = hits.filter((h) => h.matchKind !== "picked");
  const hasPicked = pickedHits.length > 0;

  /** Render a single hit row. `withBody` controls whether to dump the
   *  ~2.5KB excerpt (only for picked resources — keeps prompt budgets
   *  honest for incidental hits). */
  const renderHit = (h: RetrievedResource, withBody: boolean) => {
    const idShort = h.id.slice(0, 8);
    const flags: string[] = [h.resource_type];
    if (h.is_template) flags.push("template");
    if (h.template_category) flags.push(`cat:${h.template_category}`);
    if (h.account_id) flags.push("account-linked");
    if (h.opportunity_id) flags.push("opp-linked");
    if (h.matchKind === "content_match") flags.push("body-match");
    if (h.matchKind === "description_match") flags.push("desc-match");
    if (h.matchKind === "picked") flags.push("USER-PICKED");
    lines.push(`- RESOURCE[${idShort}] "${h.title}" — ${flags.join(", ")}`);
    lines.push(`    why: ${h.matchReason}`);
    if (h.matchSnippet) {
      lines.push(`    snippet: ${h.matchSnippet}`);
    }
    if (h.description && !h.matchSnippet) {
      const desc = h.description.replace(/\s+/g, " ").trim().slice(0, 180);
      if (desc) lines.push(`    desc: ${desc}`);
    }
    if (withBody && h.bodyExcerpt) {
      // Render the body excerpt as a fenced block so the model treats it
      // as source material to mirror, not as a description to summarize.
      lines.push(`    --- BODY EXCERPT (verbatim from this resource) ---`);
      lines.push(h.bodyExcerpt);
      lines.push(`    --- END BODY EXCERPT ---`);
    } else if (withBody && !h.bodyExcerpt) {
      lines.push(
        `    NOTE: This picked resource has no stored body content. ` +
          `You CANNOT mirror its structure or claims — say so plainly to the user.`,
      );
    }
  };

  if (hasPicked) {
    lines.push(`### PRIMARY PICKED RESOURCE${pickedHits.length === 1 ? "" : "S"} (treat as the primary source)`);
    for (const h of pickedHits) renderHit(h, true);
    lines.push("");
  }

  if (otherHits.length > 0) {
    if (hasPicked) lines.push(`### Other retrieved (secondary — for context only, do NOT pivot to these)`);
    for (const h of otherHits) renderHit(h, false);
    lines.push("");
  }

  if (hasPicked) {
    const pickedTitles = pickedHits.map((h) => `"${h.title}"`).join(", ");
    lines.push(
      `PRIORITY: One or more resources are flagged USER-PICKED above — the user explicitly selected them this turn. Your answer MUST be grounded in those resources. Cite them by exact title. Do not pivot to a different resource unless the user's question is unrelated.`,
    );
    lines.push(
      `CLOSED RESOURCE SET: The user picked ${pickedTitles} this turn. You may ONLY name resources that appear in the PICKED or RETRIEVED list above. Do NOT infer adjacent versions, quarters (Q1/Q2/Q3/Q4), editions, years, or similarly named assets. Do NOT rename the picked asset. Do NOT invent sibling playbooks or "related" documents. If unsure, cite ONLY the exact picked title verbatim.`,
    );
    if (pickedHits.length === 1) {
      const t = pickedHits[0].title;
      lines.push(
        `INTERPRETATION: If the user says "this", "adapt this", "use this", or similar without naming another resource, "this" refers to "${t}". Default to phrasing like: Using "${t}"… / Based on "${t}"…`,
      );
    }
    // ── NEW: grounding-depth rules ──
    lines.push(
      `GROUNDING DEPTH (mandatory when adapting a picked resource):`,
    );
    lines.push(
      `  1. Read the BODY EXCERPT above first. Extract its actual section structure (headings, ordering) and mirror it in your answer when relevant — do NOT impose a generic business-case scaffold.`,
    );
    lines.push(
      `  2. Reuse the resource's language patterns, framings, and phrasings where they fit the user's deal. The user picked this asset because they want THIS voice and THIS structure adapted.`,
    );
    lines.push(
      `  3. You may ONLY restate concrete claims (metrics, dates, customer names, ROI numbers, percentages, quotes) that are actually present in the BODY EXCERPT. Do NOT invent metrics. Do NOT invent dates. Do NOT invent outcomes.`,
    );
    lines.push(
      `  4. If the BODY EXCERPT lacks a section the user implicitly needs (e.g. they ask to "adapt this for my deal" and the source has no implementation timeline), say so plainly — e.g. "The source doesn't include X — want me to draft that fresh?" — instead of filling with generic boilerplate.`,
    );
    lines.push(
      `  5. If the BODY EXCERPT is missing or empty, say so plainly: "I can see this resource exists but its body isn't loaded — I can only adapt at the structural level." Do NOT invent its contents.`,
    );
    lines.push(
      `  6. Adapt to the current deal AFTER mirroring the source — swap names, numbers, and context the user has provided in this thread, but only where you have real values. Mark unknowns as [TBD: <what's needed>] rather than fabricating.`,
    );
  }
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
  lines.push(
    `- For hits flagged "body-match" or "desc-match": the title may not contain the user's words. State this honestly, e.g. "the closest thing in your library is RESOURCE[\"…\"] — the topic appears in the body, not the title."`,
  );

  return lines.join("\n");
}

// ── Cross-thread resource memory: WRITE side ──────────────────────

/**
 * Persist that a set of resources was actually cited by the assistant
 * on this thread. This is what makes the `prior_use` retrieval branch
 * non-empty on the next turn — and what makes "use the same resource
 * we used last time on this account" possible at all.
 *
 * Inputs are the verified resource ids from the citation auditor —
 * NOT the model's raw output. We never write a fabricated citation.
 *
 * Idempotency: callers may invoke this multiple times per turn; the
 * function dedupes by (thread_id, resource_id) before insert and
 * silently no-ops on conflict. We deliberately do NOT add a unique
 * constraint here — the row is cheap and chronological history is
 * sometimes useful for ranking. The dedupe is per-call.
 */
export async function recordResourceUsage(
  supabase: SupabaseLike,
  args: {
    userId: string;
    threadId: string;
    resourceIds: string[];
    sourceType?: "cited" | "uploaded" | "linked";
  },
): Promise<{ inserted: number }> {
  const { userId, threadId, resourceIds, sourceType = "cited" } = args;
  if (!userId || !threadId || !Array.isArray(resourceIds) || resourceIds.length === 0) {
    return { inserted: 0 };
  }
  // Dedupe within the call.
  const unique = Array.from(new Set(resourceIds.filter((id) => typeof id === "string" && id.length > 0)));
  if (unique.length === 0) return { inserted: 0 };

  // Skip ids we already wrote for this thread (prevents per-turn churn).
  let alreadyWritten = new Set<string>();
  try {
    const { data } = await supabase
      .from("strategy_thread_resources")
      .select("resource_id")
      .eq("user_id", userId)
      .eq("thread_id", threadId)
      .in("resource_id", unique);
    if (Array.isArray(data)) {
      alreadyWritten = new Set(data.map((r: any) => r.resource_id).filter(Boolean));
    }
  } catch (e) {
    console.warn("[recordResourceUsage] dedupe-read failed:", (e as Error).message);
  }

  const toInsert = unique
    .filter((id) => !alreadyWritten.has(id))
    .map((resource_id) => ({
      user_id: userId,
      thread_id: threadId,
      resource_id,
      source_type: sourceType,
      is_pinned: false,
    }));

  if (toInsert.length === 0) return { inserted: 0 };

  try {
    const { error } = await supabase.from("strategy_thread_resources").insert(toInsert);
    if (error) {
      console.warn("[recordResourceUsage] insert failed:", (error as any)?.message ?? error);
      return { inserted: 0 };
    }
    return { inserted: toInsert.length };
  } catch (e) {
    console.warn("[recordResourceUsage] insert threw:", (e as Error).message);
    return { inserted: 0 };
  }
}
