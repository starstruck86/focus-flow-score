// ════════════════════════════════════════════════════════════════
// Situation Classifier (task 1.1)
//
// One LLM call that triages the rep's question and picks a specific
// playbook by ID from the user's actual playbook list (embedded in
// the prompt). The result feeds libraryRetrieval as situation-scoped
// keywords instead of the legacy keyword-soup from deriveLibraryScopes.
//
// Non-blocking by contract: any failure (LLM error, bad JSON, fetch
// failure, hallucinated playbook id) returns the safe "general"
// fallback so the caller transparently degrades to the legacy path.
// ════════════════════════════════════════════════════════════════

export type SituationConfidence = "high" | "medium" | "low";

export interface SituationRetrievalPlan {
  competitive: {
    include: boolean;
    /** Canonical named competitors only; normalization caps this at three. */
    competitorNames: string[];
    /** Narrow catalog categories (for example, MMP or build-vs-buy); max two. */
    categoryHints: string[];
  };
  vertical: { include: boolean };
  webResearch: { include: boolean };
}

export interface SituationResult {
  situation: string;
  playbookId: string | null;
  playbookTitle: string | null;
  confidence: SituationConfidence;
  rationale: string;
  derivedScopes: string[];
  retrieval: SituationRetrievalPlan;
}

export interface ClassifySituationArgs {
  supabase: any;
  userId: string;
  userContent: string;
  /** Pre-formatted account context block (e.g. assembled.contextBlock). */
  accountContext?: string;
  /** Override model for tests. */
  model?: string;
  /**
   * Strategy chat needs classification even when the user has no playbooks so
   * its separately gated intelligence plan can run. Other callers retain the
   * legacy no-playbook fast path unless they opt in explicitly.
   */
  allowNoPlaybookClassification?: boolean;
}

interface PlaybookRow {
  id: string;
  title: string;
  problem_type: string | null;
  when_to_use: string | null;
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const PLAYBOOK_LIMIT = 50;
const MIN_CONTENT_LEN = 10;
const MAX_OUTPUT_TOKENS = 400;
const CLASSIFIER_TIMEOUT_MS = 12_000;

/**
 * Classification-only pre-gate for contextless chat turns. This deliberately
 * recognizes intent shapes rather than a closed competitor allowlist. A match
 * never authorizes a database query; only the normalized retrieval plan can.
 */
export function isIntelligenceClassificationCandidate(text: string): boolean {
  const value = text || "";
  const intelligenceLayer =
    /\b(competitor|competitive|compete|vs\.?|versus|against|incumbent|battlecard|beat|replace|alternative(?:s)?\s+to|rip[-\s]+and[-\s]+replace|displace(?:ment)?|build[-\s]?vs[-\s]?buy|industry|vertical|market|landscape|adjust|apps[\s-]?flyer|kochava|singular)\b/i
      .test(value);
  if (intelligenceLayer) return true;

  return requiresCurrentExternalFacts(value);
}

/**
 * Deterministic half of automatic web authorization. This deliberately does
 * not include generic competitive/industry intent: the classifier must opt in
 * AND the user's own words must ask for a volatile external fact. Explicit
 * Deep Research is authorized separately by its workspace contract.
 */
export function requiresCurrentExternalFacts(text: string): boolean {
  const value = text || "";
  const explicitVerification =
    /\b(search|look[ -]?up|research|verify|check|fact[ -]?check|web|online)\b/i
      .test(value);
  const freshness =
    /\b(current|currently|latest|recent|recently|today|right now|as of|this (?:week|month|quarter|year)|newly|just announced)\b/i
      .test(value);
  const volatileExternalFact =
    /\b(news|announcement|earnings|filing|funding|fundraise|acquisition|acquired|merger|m&a|layoffs?|hiring|leadership|executive|ceo|cfo|cro|cmo|pricing|price change|product launch|product release|platform policy|app store policy|regulation|regulatory|law|legislation|market (?:share|size|data|growth|conditions)|stock price)\b/i
      .test(value);
  const currentLeaderLookup =
    /\b(?:who (?:is|are)|name|identify)\b[\s\S]{0,80}\b(?:ceo|cfo|cro|cmo|chief executive|chief financial|chief revenue|chief marketing)\b/i
      .test(value);

  return currentLeaderLookup ||
    (volatileExternalFact && (explicitVerification || freshness));
}

const EMPTY_RETRIEVAL_PLAN: SituationRetrievalPlan = {
  competitive: { include: false, competitorNames: [], categoryHints: [] },
  vertical: { include: false },
  webResearch: { include: false },
};

const GENERAL_FALLBACK: SituationResult = {
  situation: "general",
  playbookId: null,
  playbookTitle: null,
  confidence: "low",
  rationale: "",
  derivedScopes: [],
  retrieval: EMPTY_RETRIEVAL_PLAN,
};

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function buildPlaybookMenu(rows: PlaybookRow[]): string {
  if (!rows.length) return "(no user playbooks are available)";
  return rows
    .map((p, i) => {
      const lines = [
        `${i + 1}. id: ${p.id}`,
        `   title: ${p.title}`,
        p.problem_type ? `   problem_type: ${p.problem_type}` : null,
        p.when_to_use
          ? `   when_to_use: ${truncate(p.when_to_use, 320)}`
          : null,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

function buildPrompt(
  userContent: string,
  accountContext: string,
  rows: PlaybookRow[],
): { system: string; user: string } {
  const system = [
    "You are a sales-situation triage classifier.",
    "Given a sales rep's question (and optional account context), pick the single best matching playbook from the AVAILABLE PLAYBOOKS menu — or null if none clearly applies.",
    "",
    "Return ONLY valid JSON. No markdown, no preamble, no code fences.",
    "",
    "JSON shape (every field required):",
    "{",
    '  "situation": string,            // short kebab-case label e.g. "adjust-displacement", "champion-quiet", "qbr-usage-down", "build-internally", "discount-demand", "vendor-consolidation", "expansion-discovery", "renewal-risk", "general"',
    '  "playbookId": string | null,    // EXACT uuid from AVAILABLE PLAYBOOKS, or null',
    '  "playbookTitle": string | null, // matching title from the menu, or null',
    '  "confidence": "high" | "medium" | "low",',
    '  "rationale": string,            // 1 sentence why',
    '  "derivedScopes": string[],      // 2–4 topic keywords for retrieval (e.g. ["competitive","adjust","displacement"])',
    '  "retrieval": {',
    '    "competitive": { "include": boolean, "competitorNames": string[], "categoryHints": string[] },',
    '    "vertical": { "include": boolean },',
    '    "webResearch": { "include": boolean }',
    "  }",
    "}",
    "",
    "Rules:",
    "- playbookId MUST be one of the listed UUIDs verbatim, or null. Never invent an ID.",
    '- Prefer null + situation="general" over a weak match. confidence="low" REQUIRES playbookId=null.',
    "- derivedScopes are concept/tactic/problem-type terms, not the rep's literal words. No stopwords, no account names.",
    "- competitive.include is true ONLY for a named competitor, competitive/displacement evaluation, build-vs-buy, vendor consolidation, or when competitor-specific positioning would materially change the answer.",
    "- vertical.include is true ONLY when ACCOUNT CONTEXT identifies a linked account and the ask needs industry/vertical POV, account research, discovery strategy, market framing, or vertical-specific messaging. It is false without a linked account, and for generic rewrites, small copy assets, and unrelated tactical asks.",
    "- webResearch.include is true ONLY when correctness materially depends on current external facts likely to have changed since internal evidence was created: recent company news, filings/earnings, leadership, funding/M&A, product/pricing/platform-policy changes, regulation, or current market data. It may also be true for an explicit request to verify or look up one of those current facts.",
    "- webResearch.include is false for general strategic reasoning, brainstorming, evergreen explanation, drafting/rewriting, internal deal or account current-state questions, questions answerable from supplied context, a named competitor/industry alone, hypotheticals, and vague asks such as 'what's new?'. Uncertainty means false.",
    "- competitorNames may use names in the rep question or ACCOUNT CONTEXT. Never invent a competitor and never return the account name. Max 3.",
    "- categoryHints are narrow catalog categories such as MMP or build-vs-buy. Max 2.",
    '- confidence="low" MUST set every retrieval include flag to false. webResearch.include additionally requires confidence="high".',
    "- With no available playbooks, playbookId/playbookTitle MUST be null, but still classify the situation and return a retrieval plan.",
    "",
    "AVAILABLE PLAYBOOKS:",
    buildPlaybookMenu(rows),
  ].join("\n");

  const userParts: string[] = [`REP QUESTION:\n${userContent.trim()}`];
  const ctx = (accountContext || "").trim();
  if (ctx) userParts.push(`ACCOUNT CONTEXT:\n${truncate(ctx, 2000)}`);
  return { system, user: userParts.join("\n\n") };
}

function extractJson(text: string): unknown {
  if (!text) return null;
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const open = candidate.indexOf("{");
    const close = candidate.lastIndexOf("}");
    if (open >= 0 && close > open) {
      try {
        return JSON.parse(candidate.slice(open, close + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeBoundedStrings(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const printable = item
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (printable.length < 2 || printable.length > 80) continue;

    const key = printable.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(printable);
    if (normalized.length === maxItems) break;
  }
  return normalized;
}

function normalizeRetrievalPlan(
  raw: unknown,
  confidence: SituationConfidence,
): SituationRetrievalPlan {
  // The classifier plan is authorization to read additional tables. Anything
  // ambiguous must therefore fail closed, and low confidence may never opt in.
  if (
    confidence === "low" ||
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return {
      competitive: { include: false, competitorNames: [], categoryHints: [] },
      vertical: { include: false },
      webResearch: { include: false },
    };
  }

  const plan = raw as Record<string, unknown>;
  const competitive = plan.competitive &&
      typeof plan.competitive === "object" &&
      !Array.isArray(plan.competitive)
    ? plan.competitive as Record<string, unknown>
    : null;
  const vertical = plan.vertical &&
      typeof plan.vertical === "object" &&
      !Array.isArray(plan.vertical)
    ? plan.vertical as Record<string, unknown>
    : null;
  const webResearch = plan.webResearch &&
      typeof plan.webResearch === "object" &&
      !Array.isArray(plan.webResearch)
    ? plan.webResearch as Record<string, unknown>
    : null;
  const competitiveInclude = competitive?.include === true;

  return {
    competitive: {
      include: competitiveInclude,
      competitorNames: competitiveInclude
        ? normalizeBoundedStrings(competitive?.competitorNames, 3)
        : [],
      categoryHints: competitiveInclude
        ? normalizeBoundedStrings(competitive?.categoryHints, 2)
        : [],
    },
    vertical: { include: vertical?.include === true },
    // Automatic external research has a deliberately higher bar than the
    // internal competitive/vertical reads. Whole-situation confidence must be
    // high and the field must be the literal boolean true.
    webResearch: {
      include: confidence === "high" && webResearch?.include === true,
    },
  };
}

// Exported for contract tests and for callers that normalize stored/replayed
// classifier output. Invalid retrieval fields always fail closed.
export function normalizeSituationResult(
  raw: unknown,
  validIds: Map<string, string>,
): SituationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return GENERAL_FALLBACK;
  }
  const obj = raw as Record<string, unknown>;

  const situationRaw = typeof obj.situation === "string"
    ? obj.situation.trim()
    : "";
  const situation = situationRaw || "general";

  let playbookId: string | null =
    typeof obj.playbookId === "string" && obj.playbookId.trim()
      ? obj.playbookId.trim()
      : null;
  if (playbookId && !validIds.has(playbookId)) {
    // Hallucinated UUID — drop the pick but keep the scopes.
    playbookId = null;
  }
  const playbookTitle = playbookId ? validIds.get(playbookId) ?? null : null;

  let confidence: SituationConfidence =
    obj.confidence === "high" || obj.confidence === "medium" ||
      obj.confidence === "low"
      ? obj.confidence
      : "low";
  if (confidence === "low") playbookId = null;

  const rationale = typeof obj.rationale === "string"
    ? obj.rationale.trim()
    : "";

  const derivedScopes = Array.isArray(obj.derivedScopes)
    ? (obj.derivedScopes as unknown[])
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length <= 60)
      .slice(0, 6)
    : [];
  const retrieval = normalizeRetrievalPlan(obj.retrieval, confidence);

  return {
    situation,
    playbookId,
    playbookTitle: playbookId ? playbookTitle : null,
    confidence,
    rationale,
    derivedScopes,
    retrieval,
  };
}

export async function classifySituation(
  args: ClassifySituationArgs,
): Promise<SituationResult> {
  const start = Date.now();
  try {
    const content = (args.userContent || "").trim();
    if (content.length < MIN_CONTENT_LEN) return GENERAL_FALLBACK;

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) {
      console.warn(
        "[situation-classifier] LOVABLE_API_KEY missing, falling back",
      );
      return GENERAL_FALLBACK;
    }

    const { data: pbRows, error: pbErr } = await args.supabase
      .from("playbooks")
      .select("id, title, problem_type, when_to_use")
      .eq("user_id", args.userId)
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .limit(PLAYBOOK_LIMIT);
    if (pbErr) {
      console.warn(
        "[situation-classifier] playbook fetch failed:",
        pbErr.message,
      );
      return GENERAL_FALLBACK;
    }
    const playbooks: PlaybookRow[] = (pbRows ?? []) as PlaybookRow[];
    if (!playbooks.length && !args.allowNoPlaybookClassification) {
      return GENERAL_FALLBACK;
    }

    const validIds = new Map(playbooks.map((p) => [p.id, p.title]));
    const { system, user } = buildPrompt(
      content,
      args.accountContext ?? "",
      playbooks,
    );

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CLASSIFIER_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: args.model || DEFAULT_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          max_tokens: MAX_OUTPUT_TOKENS,
          response_format: { type: "json_object" },
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(
        `[situation-classifier] gateway ${resp.status}: ${
          errText.slice(0, 200)
        }`,
      );
      return GENERAL_FALLBACK;
    }

    const data = await resp.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);
    const result = normalizeSituationResult(parsed, validIds);

    const latency = Date.now() - start;
    console.log(
      "[situation-classifier] completed",
      JSON.stringify({
        confidence: result.confidence,
        playbook_selected: result.playbookId !== null,
        playbook_menu_count: playbooks.length,
        derived_scope_count: result.derivedScopes.length,
        competitive_requested: result.retrieval.competitive.include,
        competitor_name_count:
          result.retrieval.competitive.competitorNames.length,
        category_hint_count: result.retrieval.competitive.categoryHints.length,
        vertical_requested: result.retrieval.vertical.include,
        web_research_requested: result.retrieval.webResearch.include,
        latency_ms: latency,
      }),
    );
    return result;
  } catch (e) {
    console.warn(
      "[situation-classifier] threw, falling back:",
      (e as Error).message,
    );
    return GENERAL_FALLBACK;
  }
}
