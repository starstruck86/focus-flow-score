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

export type ExplicitCompetitiveIntentKind =
  | "competitive_intel"
  | "named_competitor";

export interface ExplicitCompetitiveIntent {
  kind: ExplicitCompetitiveIntentKind;
  competitorNames: string[];
}

export interface SituationRetrievalPlan {
  competitive: {
    include: boolean;
    /** Canonical named competitors only; normalization caps this at three. */
    competitorNames: string[];
    /** Narrow catalog categories (for example, MMP or build-vs-buy); max two. */
    categoryHints: string[];
    /** Server-authored authorization marker; never accepted from model JSON. */
    explicitIntent?: ExplicitCompetitiveIntentKind;
  };
  vertical: { include: boolean };
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
  /** Structured linked-account name, used only to exclude false competitor names. */
  accountName?: string | null;
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

const STRONG_COMPETITIVE_CUE_RE =
  /(?:\bcompetitive\s+(?:intel(?:ligence)?|analysis|research|brief(?:ing)?|evidence)\b|\bcompetitors?\b|\bbattle[\s-]?cards?\b|\bagainst\b|\bversus\b|\bvs\b\.?)/i;

// `beat`, `replace`, and `displace` are ordinary sales/copy verbs unless their
// direct object is explicitly competitive. Keep this grammar deliberately
// narrower than the classification-only pre-gate below.
const COMPETITIVE_ACTION_SOURCE =
  String.raw`(?:beat(?:s|ing)?(?:\s+out)?|replac(?:e|es|ed|ing)|displac(?:e|es|ed|ing))`;
const COMPETITIVE_OBJECT_MODIFIERS_SOURCE =
  String.raw`(?:(?:a|an|the|my|our|your|their|this|that|current|existing|legacy|incumbent)\s+){0,4}`;
const COMPETITIVE_OBJECT_SOURCE =
  String.raw`(?:competitors?|vendors?|providers?|incumbents?|mmp(?:s)?|apps[\s-]?flyer|airbridge|kochava)`;
const QUALIFIED_COMPETITIVE_ACTION_RE = new RegExp(
  String.raw`\b${COMPETITIVE_ACTION_SOURCE}\b\s+${COMPETITIVE_OBJECT_MODIFIERS_SOURCE}${COMPETITIVE_OBJECT_SOURCE}\b`,
  "i",
);

const KNOWN_COMPETITOR_NON_ACTION_CUE_PREFIX = String.raw`(?:\b(?:against|versus|vs\.?)\s+(?:the\s+)?|\b(?:battle[\s-]?cards?|competitive\s+(?:intel(?:ligence)?|analysis|research|brief(?:ing)?|evidence))\s+(?:on|about|for)\s+(?:the\s+)?)`;
const KNOWN_COMPETITOR_ACTION_CUE_PREFIX =
  String.raw`(?:\b${COMPETITIVE_ACTION_SOURCE}\b\s+${COMPETITIVE_OBJECT_MODIFIERS_SOURCE})`;

function knownCompetitorCuePattern(
  aliasSource: string,
  allowCaseInsensitiveAction = true,
): RegExp {
  const prefix = allowCaseInsensitiveAction
    ? `(?:${KNOWN_COMPETITOR_NON_ACTION_CUE_PREFIX}|${KNOWN_COMPETITOR_ACTION_CUE_PREFIX})`
    : KNOWN_COMPETITOR_NON_ACTION_CUE_PREFIX;
  return new RegExp(
    `${prefix}(?:${aliasSource})\\b`,
    "i",
  );
}

const KNOWN_COMPETITORS: Array<{
  name: string;
  canonicalPattern: RegExp;
  cueBoundPattern: RegExp;
}> = [
  {
    name: "Adjust",
    canonicalPattern: /\bAdjust\b/,
    cueBoundPattern: knownCompetitorCuePattern("adjust", false),
  },
  {
    name: "AppsFlyer",
    canonicalPattern: /\b(?:AppsFlyer|Apps Flyer)\b/,
    cueBoundPattern: knownCompetitorCuePattern(String.raw`apps[\s-]?flyer`),
  },
  {
    name: "Airbridge",
    canonicalPattern: /\bAirbridge\b/,
    cueBoundPattern: knownCompetitorCuePattern("airbridge"),
  },
  {
    name: "Kochava",
    canonicalPattern: /\bKochava\b/,
    cueBoundPattern: knownCompetitorCuePattern("kochava"),
  },
  {
    name: "Singular",
    canonicalPattern: /\bSingular\b/,
    cueBoundPattern: knownCompetitorCuePattern("singular", false),
  },
];

const CONTEXTUAL_AGAINST_VERB_SOURCE =
  String.raw`(?:[Pp]osition(?:ed|ing|s)?|[Cc]ompet(?:e|es|ed|ing)|[Dd]ifferentiat(?:e|es|ed|ing)|[Ss]ell|[Ss]elling|[Ss]old|[Pp]itch(?:ed|ing|es)?|[Ee]valuat(?:e|ed|ing|es)|[Cc]ompar(?:e|ed|ing|es)|[Ww]in|[Ww]ins|[Ww]inning|[Ww]on)`;
const CONTEXTUAL_AGAINST_OBJECT_SOURCE =
  String.raw`(?:us|ourselves|our|the|this|that|product|platform|offering|solution|team|company|deal|account|opportunity)`;
const SENTENCE_CASE_ACTION_SOURCE =
  String.raw`(?:[Bb]eat(?:s|ing)?(?:\s+out)?|[Rr]eplac(?:e|es|ed|ing)|[Dd]isplac(?:e|es|ed|ing))`;
const UNKNOWN_COMPETITOR_CUE_SOURCE = [
  String.raw`\b(?:[Vv]ersus|[Vv][Ss])\b\.?`,
  String.raw`\b${CONTEXTUAL_AGAINST_VERB_SOURCE}\b(?:\s+${CONTEXTUAL_AGAINST_OBJECT_SOURCE}){0,4}\s+\b[Aa]gainst\b`,
  String.raw`\b${SENTENCE_CASE_ACTION_SOURCE}\b\s+${COMPETITIVE_OBJECT_MODIFIERS_SOURCE}`,
  String.raw`\b[Bb]attle[\s-]?[Cc]ards?\b\s+(?:on|about|for)\b`,
  String.raw`\b[Cc]ompetitive\s+(?:intel(?:ligence)?|analysis|research|brief(?:ing)?|evidence)\b\s+(?:on|about)\b`,
  String.raw`\b[Cc]ompetitors?\b(?:\s+(?:is|are|named|like)\b)?`,
].join("|");
const TITLE_CASE_ENTITY_SOURCE =
  String.raw`[A-Z][A-Za-z0-9&.'’_-]*(?:\s+[A-Z][A-Za-z0-9&.'’_-]*){0,2}`;
const CUE_BOUND_COMPETITOR_NAME_RE = new RegExp(
  String.raw`(?:${UNKNOWN_COMPETITOR_CUE_SOURCE})\s*(?:is\s+)?[:—–-]?\s*(?:the\s+)?(${TITLE_CASE_ENTITY_SOURCE})`,
  "g",
);

function normalizeEntityKey(value: string): string {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?:['’]s)\b/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const NON_ENTITY_CAPTURE_WORDS = new Set([
  "a",
  "an",
  "changing",
  "competitor",
  "competitors",
  "current",
  "deck",
  "existing",
  "forecast",
  "forecasts",
  "goal",
  "goals",
  "higher",
  "incumbent",
  "incumbents",
  "my",
  "mmp",
  "mmps",
  "number",
  "our",
  "paragraph",
  "pipeline",
  "prices",
  "pricing",
  "process",
  "processes",
  "product",
  "provider",
  "providers",
  "quarter",
  "quota",
  "revenue",
  "strategy",
  "target",
  "targets",
  "that",
  "the",
  "their",
  "this",
  "vendor",
  "vendors",
  "workflow",
  "workflows",
  "your",
  "wording",
]);

function isPlausibleCapturedCompetitor(value: string): boolean {
  const words = normalizeEntityKey(value).split(" ").filter(Boolean);
  return words.length > 0 &&
    !words.some((word) => NON_ENTITY_CAPTURE_WORDS.has(word));
}

function cleanCapturedCompetitor(value: string): string {
  return value.trim()
    .replace(/(?:['’]s)\s*$/u, "")
    .replace(/[.;:]+$/u, "")
    .trim();
}

function isExcludedEntityKey(key: string, excludedKeys: string[]): boolean {
  return excludedKeys.some((excluded) =>
    key === excluded || key.startsWith(`${excluded} `)
  );
}

function isCanonicalKnownCompetitorUse(
  content: string,
  competitor: (typeof KNOWN_COMPETITORS)[number],
): boolean {
  if (!competitor.canonicalPattern.test(content)) return false;
  if (competitor.name !== "Adjust" && competitor.name !== "Singular") {
    return true;
  }

  // Adjust and Singular are also ordinary English words. Canonical case alone
  // cannot authorize retrieval; require grammar that treats the token as a
  // product/company entity. Explicit competitive cues/actions are handled by
  // cueBoundPattern above.
  const entity = competitor.name;
  const entityAsSubject = new RegExp(
    String.raw`\b${entity}(?:['’]s\b|\s+(?:is|has|can|does|offers?|supports?|lacks?|vs\.?|versus|against)\b)`,
  );
  const entityAsObject = new RegExp(
    String.raw`\b(?:[Aa]bout|[Cc]ompare|[Ee]valuate|[Rr]esearch|[Aa]ssess)\s+(?:the\s+)?${entity}\b`,
  );
  const entityAsNamedModifier = new RegExp(
    String.raw`\bthe\s+${entity}\s+(?:platform|product|pricing|capabilit(?:y|ies)|strengths?|weaknesses?|positioning)\b`,
  );
  return entityAsSubject.test(content) || entityAsObject.test(content) ||
    entityAsNamedModifier.test(content);
}

/**
 * High-bar deterministic authorization for explicit competitive asks.
 * This is intentionally narrower than `isIntelligenceClassificationCandidate`:
 * broad words may reach the LLM, but they may not bypass a low-confidence plan.
 */
export function detectExplicitCompetitiveIntent(
  userContent: string,
  accountName: string | null = null,
): ExplicitCompetitiveIntent | null {
  const content = (userContent || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!content) return null;

  const rawNames: string[] = [];
  for (const competitor of KNOWN_COMPETITORS) {
    if (
      competitor.cueBoundPattern.test(content) ||
      isCanonicalKnownCompetitorUse(content, competitor)
    ) rawNames.push(competitor.name);
  }
  for (const match of content.matchAll(CUE_BOUND_COMPETITOR_NAME_RE)) {
    if (match[1] && isPlausibleCapturedCompetitor(match[1])) {
      rawNames.push(cleanCapturedCompetitor(match[1]));
    }
  }

  const accountKey = normalizeEntityKey(accountName || "");
  const excludedKeys = accountKey ? [accountKey] : [];
  const seen = new Set<string>();
  const competitorNames: string[] = [];
  for (const name of normalizeBoundedStrings(rawNames, 10)) {
    const key = normalizeEntityKey(name);
    if (!key || isExcludedEntityKey(key, excludedKeys) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    competitorNames.push(name);
    if (competitorNames.length === 3) break;
  }

  const strongCue = STRONG_COMPETITIVE_CUE_RE.test(content);
  const qualifiedAction = QUALIFIED_COMPETITIVE_ACTION_RE.test(content);
  if (!strongCue && !qualifiedAction && competitorNames.length === 0) {
    return null;
  }

  return {
    kind: competitorNames.length > 0
      ? "named_competitor"
      : "competitive_intel",
    competitorNames,
  };
}

/**
 * Classification-only pre-gate for contextless chat turns. This deliberately
 * recognizes intent shapes rather than a closed competitor allowlist. A match
 * never authorizes a database query; only the normalized retrieval plan can.
 */
export function isIntelligenceClassificationCandidate(text: string): boolean {
  if (detectExplicitCompetitiveIntent(text) !== null) return true;
  return /\b(competitor|competitive|compete|vs\.?|versus|against|incumbent|battle[\s-]?cards?|beat|replace|alternative(?:s)?\s+to|rip[-\s]+and[-\s]+replace|displace(?:ment)?|build[-\s]?vs[-\s]?buy|industry|vertical|market|landscape|adjust|apps[\s-]?flyer|airbridge|kochava|singular)\b/i
    .test(text || "");
}

const EMPTY_RETRIEVAL_PLAN: SituationRetrievalPlan = {
  competitive: { include: false, competitorNames: [], categoryHints: [] },
  vertical: { include: false },
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
    '    "vertical": { "include": boolean }',
    "  }",
    "}",
    "",
    "Rules:",
    "- playbookId MUST be one of the listed UUIDs verbatim, or null. Never invent an ID.",
    '- Prefer null + situation="general" over a weak match. confidence="low" REQUIRES playbookId=null.',
    "- derivedScopes are concept/tactic/problem-type terms, not the rep's literal words. No stopwords, no account names.",
    "- competitive.include is true ONLY for a named competitor, competitive/displacement evaluation, build-vs-buy, vendor consolidation, or when competitor-specific positioning would materially change the answer.",
    "- vertical.include is true ONLY when ACCOUNT CONTEXT identifies a linked account and the ask needs industry/vertical POV, account research, discovery strategy, market framing, or vertical-specific messaging. It is false without a linked account, and for generic rewrites, small copy assets, and unrelated tactical asks.",
    "- competitorNames may use names in the rep question or ACCOUNT CONTEXT. Never invent a competitor and never return the account name. Max 3.",
    "- categoryHints are narrow catalog categories such as MMP or build-vs-buy. Max 2.",
    '- confidence="low" MUST set both retrieval include flags to false.',
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
  };
}

// Exported for contract tests and for callers that normalize stored/replayed
// classifier output. Invalid retrieval fields always fail closed.
export function normalizeSituationResult(
  raw: unknown,
  validIds: Map<string, string>,
  options: {
    explicitCompetitiveIntent?: ExplicitCompetitiveIntent | null;
    excludedCompetitiveNames?: string[];
  } = {},
): SituationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return applyExplicitCompetitiveIntent(
      GENERAL_FALLBACK,
      options.explicitCompetitiveIntent ?? null,
      options.excludedCompetitiveNames ?? [],
    );
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

  return applyExplicitCompetitiveIntent(
    {
      situation,
      playbookId,
      playbookTitle: playbookId ? playbookTitle : null,
      confidence,
      rationale,
      derivedScopes,
      retrieval,
    },
    options.explicitCompetitiveIntent ?? null,
    options.excludedCompetitiveNames ?? [],
  );
}

function applyExplicitCompetitiveIntent(
  result: SituationResult,
  explicitIntent: ExplicitCompetitiveIntent | null,
  excludedNames: string[] = [],
): SituationResult {
  if (!explicitIntent) return result;

  const excludedKeys = excludedNames.map(normalizeEntityKey).filter(Boolean);
  // A deterministically detected named competitor is authoritative. Model
  // output may refine a generic explicit request, but it may never broaden a
  // server-detected named request with additional titles.
  const classifierNames = explicitIntent.kind === "named_competitor"
    ? []
    : result.retrieval.competitive.competitorNames;
  const competitorNames = normalizeBoundedStrings([
    ...explicitIntent.competitorNames,
    ...classifierNames,
  ], 10).filter((name) =>
    !isExcludedEntityKey(normalizeEntityKey(name), excludedKeys)
  ).slice(0, 3);
  const derivedScopes = normalizeBoundedStrings([
    "competitive",
    ...competitorNames,
    ...result.derivedScopes,
  ], 10).filter((scope) => scope.length <= 60).slice(0, 6);
  const resolvedExplicitIntent: ExplicitCompetitiveIntentKind =
    competitorNames.length > 0
      ? "named_competitor"
      : explicitIntent.kind;

  return {
    ...result,
    derivedScopes,
    retrieval: {
      ...result.retrieval,
      competitive: {
        ...result.retrieval.competitive,
        include: true,
        competitorNames,
        explicitIntent: resolvedExplicitIntent,
      },
    },
  };
}

export async function classifySituation(
  args: ClassifySituationArgs,
): Promise<SituationResult> {
  const start = Date.now();
  const content = (args.userContent || "").trim();
  const explicitCompetitiveIntent = detectExplicitCompetitiveIntent(
    content,
    args.accountName ?? null,
  );
  const fallback = () =>
    applyExplicitCompetitiveIntent(
      GENERAL_FALLBACK,
      explicitCompetitiveIntent,
      args.accountName ? [args.accountName] : [],
    );
  try {
    if (content.length < MIN_CONTENT_LEN) return fallback();

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) {
      console.warn(
        "[situation-classifier] LOVABLE_API_KEY missing, falling back",
      );
      return fallback();
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
      return fallback();
    }
    const playbooks: PlaybookRow[] = (pbRows ?? []) as PlaybookRow[];
    if (!playbooks.length && !args.allowNoPlaybookClassification) {
      return fallback();
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
      return fallback();
    }

    const data = await resp.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);
    const result = normalizeSituationResult(parsed, validIds, {
      explicitCompetitiveIntent,
      excludedCompetitiveNames: args.accountName ? [args.accountName] : [],
    });

    const latency = Date.now() - start;
    console.log(
      "[situation-classifier] completed",
      JSON.stringify({
        confidence: result.confidence,
        playbook_selected: result.playbookId !== null,
        playbook_menu_count: playbooks.length,
        derived_scope_count: result.derivedScopes.length,
        competitive_requested: result.retrieval.competitive.include,
        competitive_explicit_intent:
          result.retrieval.competitive.explicitIntent ?? null,
        competitor_name_count:
          result.retrieval.competitive.competitorNames.length,
        category_hint_count: result.retrieval.competitive.categoryHints.length,
        vertical_requested: result.retrieval.vertical.include,
        latency_ms: latency,
      }),
    );
    return result;
  } catch (e) {
    console.warn(
      "[situation-classifier] threw, falling back:",
      (e as Error).message,
    );
    return fallback();
  }
}
