// Bounded, fail-soft retrieval for situation-gated competitive and vertical
// intelligence. The classifier's normalized retrieval plan is the sole
// authorization to query these sources; this module never infers intent from
// the user's prose.

import type { SituationResult } from "../strategy-router/situationClassifier.ts";

const MAX_ACCOUNT_RISKS = 10;
const MAX_CATALOG_ROWS = 100;
const MAX_COMPETITIVE_ROWS = 3;
const MAX_COMPETITIVE_RECORD_CHARS = 1_800;
const MAX_COMPETITIVE_CHARS = 5_000;
const MAX_VERTICAL_ROWS = 100;
const MAX_VERTICAL_CHARS = 5_000;
const MAX_TERM_HIT_SCORE = 8;
const TRUNCATION_MARKER = "\n[…truncated]";
const INLINE_TRUNCATION_MARKER = " […truncated]";
const ACTIVE_RISK_STATUSES = [
  "identified",
  "monitoring",
  "mitigating",
  "realized",
];

type AccountRef = {
  id?: string | null;
  vertical_id?: string | null;
  industry?: string | null;
};

type RetrievalPlanLike = {
  competitive?: {
    include?: unknown;
    competitorNames?: unknown;
    categoryHints?: unknown;
    explicitIntent?: unknown;
  };
  vertical?: { include?: unknown };
};

interface CompetitiveIntelRow {
  id: unknown;
  competitor_name: unknown;
  category: unknown;
  positioning: unknown;
  build_vs_buy_talking_points: unknown;
  displacement_questions: unknown;
  evidence: unknown;
  source_url: unknown;
  created_at: unknown;
}

interface VerticalRow {
  id: unknown;
  name: unknown;
}

interface VerticalBriefRow {
  id: unknown;
  vertical_id: unknown;
  version: unknown;
  pov_deck_md: unknown;
  rendered_at: unknown;
}

export interface SituationIntelligenceResult {
  competitiveContext: string;
  verticalContext: string;
  competitiveSources: Array<{
    id: string;
    title: string;
    sourceUrl?: string | null;
    createdAt: string;
  }>;
  verticalSource: {
    id: string;
    title: string;
    version: number;
    renderedAt: string;
  } | null;
  telemetry: {
    competitive: {
      requested: boolean;
      queried: boolean;
      matched: number;
      reason: string;
      truncated: boolean;
      error?: string;
    };
    vertical: {
      requested: boolean;
      queried: boolean;
      matched: boolean;
      reason: string;
      truncated: boolean;
      error?: string;
    };
  };
}

type CompetitiveTelemetry =
  SituationIntelligenceResult["telemetry"]["competitive"];
type VerticalTelemetry = SituationIntelligenceResult["telemetry"]["vertical"];

type CompetitiveReadResult =
  & Pick<
    SituationIntelligenceResult,
    "competitiveContext" | "competitiveSources"
  >
  & { telemetry: CompetitiveTelemetry };

type VerticalReadResult =
  & Pick<
    SituationIntelligenceResult,
    "verticalContext" | "verticalSource"
  >
  & { telemetry: VerticalTelemetry };

class StableQueryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function sanitizeMultiline(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\u2028\u2029]/g, "\n")
    // Do not allow retrieved content to spoof the caller's evidence envelope.
    .replace(
      /═{2,}\s*(?:END\s+)?RETRIEVED\s+INTELLIGENCE[^\n]*═{2,}/gi,
      "[retrieved-data boundary removed]",
    )
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function sanitizeInline(value: unknown): string {
  return sanitizeMultiline(value).replace(/\s+/g, " ").trim();
}

function sanitizeMetadata(value: unknown): string {
  return sanitizeInline(value)
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\|/g, "/");
}

function normalizeSignal(value: unknown): string {
  return sanitizeInline(value).toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizeCompetitorMatchKey(value: unknown): string {
  return normalizeSignal(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function truncateBounded(
  value: string,
  maxChars: number,
  marker = TRUNCATION_MARKER,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  const available = Math.max(0, maxChars - marker.length);
  const minimumBoundary = Math.floor(available * 0.6);
  const paragraph = value.lastIndexOf("\n\n", available);
  const line = value.lastIndexOf("\n", available);
  const space = value.lastIndexOf(" ", available);
  const boundary = paragraph >= minimumBoundary
    ? paragraph
    : line >= minimumBoundary
    ? line
    : space >= minimumBoundary
    ? space
    : available;
  const prefix = value.slice(0, boundary).trimEnd().slice(0, available);
  return {
    text: `${prefix}${marker}`.slice(0, maxChars),
    truncated: true,
  };
}

function truncateInline(value: string, maxChars: number): string {
  return truncateBounded(value, maxChars, INLINE_TRUNCATION_MARKER).text;
}

function safeJson(value: unknown): string {
  try {
    const rendered = JSON.stringify(value);
    return typeof rendered === "string" ? rendered : "";
  } catch {
    return "";
  }
}

function safeSourceUrl(value: unknown): string {
  const raw = sanitizeInline(value);
  if (!raw || raw.length > 2_048) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function safeTimestamp(value: unknown): string {
  const raw = sanitizeInline(value);
  if (!raw) return "";
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : "";
}

function boundedStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeStrings(
    value
      .filter((item): item is string => typeof item === "string")
      .map(sanitizeInline)
      .filter((item) => item.length >= 2 && item.length <= 80),
    limit,
  );
}

function dedupeStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = sanitizeInline(value);
    const key = normalizeSignal(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= limit) break;
  }
  return output;
}

function retrievalPlan(situation: SituationResult): RetrievalPlanLike {
  const value =
    (situation as SituationResult & { retrieval?: unknown }).retrieval;
  return value && typeof value === "object" ? value as RetrievalPlanLike : {};
}

function competitiveRequested(situation: SituationResult): boolean {
  return retrievalPlan(situation).competitive?.include === true;
}

function verticalRequested(situation: SituationResult): boolean {
  return retrievalPlan(situation).vertical?.include === true;
}

function emptyCompetitive(
  requested: boolean,
  reason: string,
  options: { queried?: boolean; error?: string } = {},
): CompetitiveReadResult {
  return {
    competitiveContext: "",
    competitiveSources: [],
    telemetry: {
      requested,
      queried: options.queried === true,
      matched: 0,
      reason,
      truncated: false,
      ...(options.error ? { error: options.error } : {}),
    },
  };
}

function emptyVertical(
  requested: boolean,
  reason: string,
  options: { queried?: boolean; error?: string } = {},
): VerticalReadResult {
  return {
    verticalContext: "",
    verticalSource: null,
    telemetry: {
      requested,
      queried: options.queried === true,
      matched: false,
      reason,
      truncated: false,
      ...(options.error ? { error: options.error } : {}),
    },
  };
}

function bulletValues(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value.slice(0, 3)
    : value == null
    ? []
    : [value];
  return values
    .map((item) => {
      const rendered = typeof item === "string" ? item : safeJson(item);
      const clean = sanitizeInline(rendered);
      return clean ? truncateInline(clean, 420) : "";
    })
    .filter(Boolean);
}

function renderList(label: string, value: unknown): string {
  const values = bulletValues(value);
  return values.length
    ? `${label}:\n${values.map((item) => `- ${item}`).join("\n")}`
    : "";
}

interface RankedCompetitiveRow {
  row: CompetitiveIntelRow;
  id: string;
  name: string;
  category: string;
  sourceUrl: string;
  createdAt: string;
  score: number;
}

function rankCompetitiveRows(args: {
  rows: unknown[];
  candidateNames: string[];
  riskNames: string[];
  categoryHints: string[];
  scopes: string[];
  requiredNames?: string[];
  allowUnscored?: boolean;
}): RankedCompetitiveRow[] {
  const candidateKeys = args.candidateNames.map(normalizeSignal).filter(
    Boolean,
  );
  const riskKeys = new Set(args.riskNames.map(normalizeSignal).filter(Boolean));
  const requiredNameKeys = new Set(
    (args.requiredNames ?? []).map(normalizeCompetitorMatchKey).filter(Boolean),
  );
  const categorySignals = dedupeStrings(
    [...args.categoryHints, ...args.scopes],
    8,
  ).map(normalizeSignal);

  return args.rows
    .filter((value): value is CompetitiveIntelRow =>
      !!value && typeof value === "object"
    )
    .map((row) => {
      const id = sanitizeInline(row.id);
      const name = sanitizeMetadata(row.competitor_name);
      const category = sanitizeMetadata(row.category);
      const sourceUrl = safeSourceUrl(row.source_url);
      const createdAt = safeTimestamp(row.created_at);
      // Product rule from the retrieval contract: only provenance-complete
      // catalog records may enter the model context. Nullable/invalid source
      // metadata makes the row non-prompt-grade rather than "uncited".
      if (!id || !name || !sourceUrl || !createdAt) return null;

      const nameKey = normalizeSignal(row.competitor_name);
      const requiredNameMatched = requiredNameKeys.has(
        normalizeCompetitorMatchKey(row.competitor_name),
      );
      if (
        requiredNameKeys.size > 0 &&
        !requiredNameMatched
      ) return null;
      const categoryKey = normalizeSignal(row.category);
      const searchable = [
        nameKey,
        categoryKey,
        normalizeSignal(row.positioning),
      ].filter(Boolean).join(" ");

      let score = requiredNameMatched ? 100 : 0;
      for (const candidate of candidateKeys) {
        if (candidate === nameKey) score += 100;
        else if (candidate.includes(nameKey) || nameKey.includes(candidate)) {
          score += 40;
        }
      }
      if (riskKeys.has(nameKey)) score += 25;
      if (categoryKey && categorySignals.includes(categoryKey)) score += 20;

      let termHits = 0;
      for (const term of categorySignals) {
        if (term && searchable.includes(term)) termHits += 1;
      }
      score += Math.min(termHits, MAX_TERM_HIT_SCORE);

      return score > 0 || args.allowUnscored === true
        ? { row, id, name, category, sourceUrl, createdAt, score }
        : null;
    })
    .filter((value): value is RankedCompetitiveRow => value !== null)
    .sort((a, b) =>
      b.score - a.score ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
}

function renderCompetitiveRecord(entry: RankedCompetitiveRow): {
  text: string;
  truncated: boolean;
} {
  const row = entry.row;
  const header = [
    `Competitor: ${entry.name}`,
    entry.category ? `Category: ${entry.category}` : "",
    `Source: ${entry.sourceUrl.replace(/\|/g, "%7C")}`,
    `Updated: ${entry.createdAt.slice(0, 10)}`,
  ].filter(Boolean).join(" | ");
  const positioning = sanitizeMultiline(row.positioning);
  const raw = [
    `[${header}]`,
    positioning ? `Positioning: ${positioning}` : "",
    renderList("Evidence", row.evidence),
    renderList("Displacement questions", row.displacement_questions),
    renderList("Build-vs-buy", row.build_vs_buy_talking_points),
  ].filter(Boolean).join("\n");
  return truncateBounded(raw, MAX_COMPETITIVE_RECORD_CHARS);
}

async function readCompetitive(args: {
  supabase: any;
  userId: string;
  account: AccountRef | null;
  situation: SituationResult;
}): Promise<CompetitiveReadResult> {
  const requested = competitiveRequested(args.situation);
  if (!requested) return emptyCompetitive(false, "classifier_not_requested");
  const plan = retrievalPlan(args.situation).competitive;
  const explicitIntent = plan?.explicitIntent === "competitive_intel" ||
      plan?.explicitIntent === "named_competitor"
    ? plan.explicitIntent
    : null;
  if (args.situation.confidence === "low" && explicitIntent === null) {
    return emptyCompetitive(true, "low_confidence");
  }

  let queried = false;
  let riskNames: string[] = [];
  let auxiliaryError: string | undefined;

  if (sanitizeInline(args.account?.id)) {
    queried = true;
    try {
      const { data, error } = await args.supabase
        .from("account_risks")
        .select("competitor, severity, likelihood, observed_at")
        .eq("user_id", args.userId)
        .eq("account_id", args.account!.id)
        .eq("risk_type", "competitor_presence")
        .in("status", ACTIVE_RISK_STATUSES)
        .not("competitor", "is", null)
        .order("severity", { ascending: false, nullsFirst: false })
        .order("likelihood", { ascending: false, nullsFirst: false })
        .order("observed_at", { ascending: false })
        .limit(MAX_ACCOUNT_RISKS);
      if (error) throw new StableQueryError("account_risk_query_failed");
      riskNames = boundedStrings(
        (Array.isArray(data) ? data : []).map((row: any) => row?.competitor),
        MAX_ACCOUNT_RISKS,
      );
    } catch {
      auxiliaryError = "account_risk_query_failed";
    }
  }

  const classifierNames = boundedStrings(plan?.competitorNames, 3);
  const categoryHints = boundedStrings(plan?.categoryHints, 2);
  const candidateNames = dedupeStrings([...classifierNames, ...riskNames], 5);
  const scopes = dedupeStrings(
    (args.situation.derivedScopes || []).map(sanitizeInline),
    6,
  );

  const namedExplicitRequest = explicitIntent === "named_competitor" ||
    (explicitIntent === "competitive_intel" && classifierNames.length > 0);
  const allowBroadCatalog = explicitIntent === "competitive_intel" &&
    classifierNames.length === 0;
  if (namedExplicitRequest && classifierNames.length === 0) {
    return emptyCompetitive(true, "named_competitor_missing", {
      queried,
      error: auxiliaryError,
    });
  }
  if (
    !candidateNames.length && !categoryHints.length && !allowBroadCatalog
  ) {
    return emptyCompetitive(true, "no_named_or_category_signal", {
      queried,
      error: auxiliaryError,
    });
  }

  queried = true;
  try {
    const { data, error } = await args.supabase
      .from("competitive_intel")
      .select(
        "id, competitor_name, category, positioning, build_vs_buy_talking_points, displacement_questions, evidence, source_url, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(MAX_CATALOG_ROWS);
    if (error) throw new StableQueryError("catalog_query_failed");

    let ranked = rankCompetitiveRows({
      rows: Array.isArray(data) ? data : [],
      candidateNames,
      riskNames,
      categoryHints,
      scopes,
      requiredNames: namedExplicitRequest ? classifierNames : [],
    });
    let usedBroadFallback = false;
    if (ranked.length === 0 && allowBroadCatalog) {
      ranked = rankCompetitiveRows({
        rows: Array.isArray(data) ? data : [],
        candidateNames,
        riskNames,
        categoryHints,
        scopes,
        requiredNames: [],
        allowUnscored: true,
      });
      usedBroadFallback = ranked.length > 0;
    }
    const rendered: Array<{ entry: RankedCompetitiveRow; text: string }> = [];
    let truncated = ranked.length > MAX_COMPETITIVE_ROWS;

    for (const entry of ranked.slice(0, MAX_COMPETITIVE_ROWS)) {
      const record = renderCompetitiveRecord(entry);
      const existingChars = rendered.map((item) =>
        item.text
      ).join("\n\n").length;
      const nextChars = existingChars + (rendered.length > 0 ? 2 : 0) +
        record.text.length;
      if (nextChars > MAX_COMPETITIVE_CHARS) {
        truncated = true;
        break;
      }
      rendered.push({ entry, text: record.text });
      truncated ||= record.truncated;
    }

    return {
      competitiveContext: rendered.map((item) => item.text).join("\n\n"),
      competitiveSources: rendered.map(({ entry }) => ({
        id: entry.id,
        title: entry.name,
        sourceUrl: entry.sourceUrl,
        createdAt: entry.createdAt,
      })),
      telemetry: {
        requested: true,
        queried,
        matched: rendered.length,
        reason: rendered.length
          ? usedBroadFallback
            ? "matched_explicit_broad"
            : "matched"
          : "no_positive_match",
        truncated,
        ...(auxiliaryError ? { error: auxiliaryError } : {}),
      },
    };
  } catch {
    return emptyCompetitive(true, "catalog_error", {
      queried,
      error: "catalog_query_failed",
    });
  }
}

async function resolveVertical(args: {
  supabase: any;
  userId: string;
  account: AccountRef;
}): Promise<VerticalRow | null> {
  const verifiedVerticalId = sanitizeInline(args.account.vertical_id);
  if (verifiedVerticalId) {
    const { data, error } = await args.supabase
      .from("verticals")
      .select("id, name")
      .eq("user_id", args.userId)
      .eq("id", verifiedVerticalId)
      .maybeSingle();
    if (error) throw new StableQueryError("vertical_lookup_failed");
    return data && typeof data === "object" ? data as VerticalRow : null;
  }

  const industry = normalizeSignal(args.account.industry);
  if (!industry) return null;
  const { data, error } = await args.supabase
    .from("verticals")
    .select("id, name")
    .eq("user_id", args.userId)
    .limit(MAX_VERTICAL_ROWS);
  if (error) throw new StableQueryError("vertical_lookup_failed");
  const matches = (Array.isArray(data) ? data : [])
    .filter((row: any) => normalizeSignal(row?.name) === industry);
  return matches.length === 1 ? matches[0] as VerticalRow : null;
}

async function readVertical(args: {
  supabase: any;
  userId: string;
  account: AccountRef | null;
  situation: SituationResult;
}): Promise<VerticalReadResult> {
  const requested = verticalRequested(args.situation);
  if (!requested) return emptyVertical(false, "classifier_not_requested");
  if (args.situation.confidence === "low") {
    return emptyVertical(true, "low_confidence");
  }
  if (!sanitizeInline(args.account?.id)) {
    return emptyVertical(true, "no_linked_account");
  }

  let vertical: VerticalRow | null;
  try {
    vertical = await resolveVertical({
      supabase: args.supabase,
      userId: args.userId,
      account: args.account!,
    });
  } catch {
    return emptyVertical(true, "vertical_error", {
      queried: true,
      error: "vertical_lookup_failed",
    });
  }

  // If neither a vertical_id nor an industry exists, resolveVertical performs
  // no query. Otherwise it verifies/looks up the user-owned vertical.
  const queriedVertical = !!sanitizeInline(args.account?.vertical_id) ||
    !!normalizeSignal(args.account?.industry);
  if (!vertical) {
    return emptyVertical(true, "vertical_unmapped", {
      queried: queriedVertical,
    });
  }

  const verticalId = sanitizeInline(vertical.id);
  const verticalName = sanitizeMetadata(vertical.name);
  if (!verticalId || !verticalName) {
    return emptyVertical(true, "vertical_unmapped", { queried: true });
  }

  try {
    const { data, error } = await args.supabase
      .from("vertical_briefs")
      .select("id, vertical_id, version, pov_deck_md, rendered_at")
      .eq("user_id", args.userId)
      .eq("vertical_id", verticalId)
      .eq("is_current", true)
      .not("pov_deck_md", "is", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new StableQueryError("vertical_brief_query_failed");
    if (!data || typeof data !== "object") {
      return emptyVertical(true, "no_current_pov_deck", { queried: true });
    }

    const row = data as VerticalBriefRow;
    const deck = sanitizeMultiline(row.pov_deck_md);
    const id = sanitizeInline(row.id);
    const version =
      typeof row.version === "number" && Number.isFinite(row.version)
        ? Math.trunc(row.version)
        : null;
    const renderedAt = safeTimestamp(row.rendered_at);
    if (!deck) {
      return emptyVertical(true, "no_current_pov_deck", { queried: true });
    }
    if (!id || version === null || !renderedAt) {
      return emptyVertical(true, "invalid_vertical_metadata", {
        queried: true,
      });
    }

    const rendered = truncateBounded(
      `[Vertical: ${verticalName} | Brief v${version} | Rendered: ${
        renderedAt.slice(0, 10)
      }]\n${deck}`,
      MAX_VERTICAL_CHARS,
    );
    return {
      verticalContext: rendered.text,
      verticalSource: {
        id,
        title: `${verticalName} POV`,
        version,
        renderedAt,
      },
      telemetry: {
        requested: true,
        queried: true,
        matched: true,
        reason: "matched",
        truncated: rendered.truncated,
      },
    };
  } catch {
    return emptyVertical(true, "vertical_error", {
      queried: true,
      error: "vertical_brief_query_failed",
    });
  }
}

export async function retrieveSituationIntelligence(args: {
  supabase: any;
  userId: string;
  account: AccountRef | null;
  situation: SituationResult;
}): Promise<SituationIntelligenceResult> {
  const requestedCompetitive = competitiveRequested(args.situation);
  const requestedVertical = verticalRequested(args.situation);
  const [competitive, vertical] = await Promise.all([
    readCompetitive(args).catch(() =>
      emptyCompetitive(requestedCompetitive, "catalog_error", {
        error: "unexpected_competitive_failure",
      })
    ),
    readVertical(args).catch(() =>
      emptyVertical(requestedVertical, "vertical_error", {
        error: "unexpected_vertical_failure",
      })
    ),
  ]);

  return {
    competitiveContext: competitive.competitiveContext,
    verticalContext: vertical.verticalContext,
    competitiveSources: competitive.competitiveSources,
    verticalSource: vertical.verticalSource,
    telemetry: {
      competitive: competitive.telemetry,
      vertical: vertical.telemetry,
    },
  };
}
