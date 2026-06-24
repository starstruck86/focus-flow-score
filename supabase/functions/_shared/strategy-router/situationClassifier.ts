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

export interface SituationResult {
  situation: string;
  playbookId: string | null;
  playbookTitle: string | null;
  confidence: SituationConfidence;
  rationale: string;
  derivedScopes: string[];
}

export interface ClassifySituationArgs {
  supabase: any;
  userId: string;
  userContent: string;
  /** Pre-formatted account context block (e.g. assembled.contextBlock). */
  accountContext?: string;
  /** Override model for tests. */
  model?: string;
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

const GENERAL_FALLBACK: SituationResult = {
  situation: "general",
  playbookId: null,
  playbookTitle: null,
  confidence: "low",
  rationale: "",
  derivedScopes: [],
};

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function buildPlaybookMenu(rows: PlaybookRow[]): string {
  return rows
    .map((p, i) => {
      const lines = [
        `${i + 1}. id: ${p.id}`,
        `   title: ${p.title}`,
        p.problem_type ? `   problem_type: ${p.problem_type}` : null,
        p.when_to_use ? `   when_to_use: ${truncate(p.when_to_use, 320)}` : null,
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
    '  "derivedScopes": string[]       // 2–4 topic keywords for retrieval (e.g. ["competitive","adjust","displacement"])',
    "}",
    "",
    "Rules:",
    "- playbookId MUST be one of the listed UUIDs verbatim, or null. Never invent an ID.",
    '- Prefer null + situation="general" over a weak match. confidence="low" REQUIRES playbookId=null.',
    "- derivedScopes are concept/tactic/problem-type terms, not the rep's literal words. No stopwords, no account names.",
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

function normalize(
  raw: unknown,
  validIds: Map<string, string>,
): SituationResult {
  if (!raw || typeof raw !== "object") return GENERAL_FALLBACK;
  const obj = raw as Record<string, unknown>;

  const situationRaw = typeof obj.situation === "string" ? obj.situation.trim() : "";
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
    obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
      ? obj.confidence
      : "low";
  if (confidence === "low") playbookId = null;

  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";

  const derivedScopes = Array.isArray(obj.derivedScopes)
    ? (obj.derivedScopes as unknown[])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && s.length <= 60)
        .slice(0, 6)
    : [];

  return {
    situation,
    playbookId,
    playbookTitle: playbookId ? playbookTitle : null,
    confidence,
    rationale,
    derivedScopes,
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
      console.warn("[situation-classifier] LOVABLE_API_KEY missing, falling back");
      return GENERAL_FALLBACK;
    }

    const { data: pbRows, error: pbErr } = await args.supabase
      .from("playbooks")
      .select("id, title, problem_type, when_to_use")
      .eq("user_id", args.userId)
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .limit(PLAYBOOK_LIMIT);
    if (pbErr) {
      console.warn("[situation-classifier] playbook fetch failed:", pbErr.message);
      return GENERAL_FALLBACK;
    }
    const playbooks: PlaybookRow[] = (pbRows ?? []) as PlaybookRow[];
    if (!playbooks.length) return GENERAL_FALLBACK;

    const validIds = new Map(playbooks.map((p) => [p.id, p.title]));
    const { system, user } = buildPrompt(content, args.accountContext ?? "", playbooks);

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
        `[situation-classifier] gateway ${resp.status}: ${errText.slice(0, 200)}`,
      );
      return GENERAL_FALLBACK;
    }

    const data = await resp.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);
    const result = normalize(parsed, validIds);

    const latency = Date.now() - start;
    console.log(
      `[situation-classifier] situation=${result.situation} ` +
      `playbookId=${result.playbookId ?? "null"} ` +
      `confidence=${result.confidence} ` +
      `scopes=[${result.derivedScopes.join(",")}] ` +
      `latency_ms=${latency}`,
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
