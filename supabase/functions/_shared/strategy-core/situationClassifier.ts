// ════════════════════════════════════════════════════════════════
// Situation Classifier (task 1.1)
//
// One LLM call that triages the rep's question, picks a specific
// playbook by ID from the user's actual playbook list, and emits
// retrieval keywords that feed libraryRetrieval.
//
// Returns null on any failure — caller MUST fall back to the legacy
// deriveLibraryScopes path so chat never blocks on classifier issues.
// ════════════════════════════════════════════════════════════════

export type ClassifierConfidence = "high" | "medium" | "low";

export interface SituationClassification {
  situation: string;
  situation_summary: string;
  playbook_id: string | null;
  playbook_title: string | null;
  confidence: ClassifierConfidence;
  scopes: string[];
  reasoning: string;
}

export interface ClassifySituationArgs {
  userId: string;
  userContent: string;
  account?: {
    name?: string | null;
    industry?: string | null;
    tech_stack?: string[] | null;
    tags?: string[] | null;
  } | null;
  opportunity?: {
    stage?: string | null;
    close_date?: string | null;
    amount?: number | null;
  } | null;
  recentTurns?: Array<{ role: string; content: string }>;
  /** Override model for tests. */
  model?: string;
}

interface PlaybookRow {
  id: string;
  title: string;
  problem_type: string | null;
  when_to_use: string | null;
  why_it_matters: string | null;
  confidence_score: number | null;
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const PLAYBOOK_LIMIT = 50;
const MIN_CONTENT_LEN = 12;
const MAX_TURN_CHARS = 400;

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function renderPlaybookList(rows: PlaybookRow[]): string {
  if (!rows.length) return "(none — return playbook_id=null)";
  return rows
    .map((p) => {
      const lines = [
        `- id: ${p.id}`,
        `  title: ${p.title}`,
        p.problem_type ? `  problem_type: ${p.problem_type}` : null,
        p.when_to_use ? `  when_to_use: ${truncate(p.when_to_use, 320)}` : null,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n");
}

function renderAccountBlock(a: ClassifySituationArgs["account"]): string {
  if (!a) return "";
  const parts: string[] = [];
  if (a.name) parts.push(`name=${a.name}`);
  if (a.industry) parts.push(`industry=${a.industry}`);
  if (a.tech_stack?.length) parts.push(`tech=${a.tech_stack.slice(0, 6).join(",")}`);
  if (a.tags?.length) parts.push(`tags=${a.tags.slice(0, 6).join(",")}`);
  return parts.length ? `ACCOUNT: { ${parts.join(" | ")} }` : "";
}

function renderOppBlock(o: ClassifySituationArgs["opportunity"]): string {
  if (!o) return "";
  const parts: string[] = [];
  if (o.stage) parts.push(`stage=${o.stage}`);
  if (o.close_date) parts.push(`close=${o.close_date}`);
  if (o.amount != null) parts.push(`amount=${o.amount}`);
  return parts.length ? `OPPORTUNITY: { ${parts.join(" | ")} }` : "";
}

function renderTurnsBlock(turns?: ClassifySituationArgs["recentTurns"]): string {
  if (!turns?.length) return "";
  const recent = turns.slice(-2);
  const formatted = recent
    .map((t) => `${(t.role || "user").toUpperCase()}: ${truncate(t.content || "", MAX_TURN_CHARS)}`)
    .join("\n");
  return `RECENT TURNS:\n${formatted}`;
}

function buildSystemPrompt(rows: PlaybookRow[]): string {
  return [
    "You are a sales-situation triage classifier.",
    "Given a rep's question plus optional account/opportunity context, identify:",
    "  (a) the situation they are in,",
    "  (b) which of the listed playbooks (if any) best matches,",
    "  (c) 3–6 high-signal retrieval keywords for knowledge lookup.",
    "",
    "Rules:",
    "- playbook_id MUST be an exact UUID from AVAILABLE PLAYBOOKS, or null. Never invent an ID.",
    "- Prefer null over a weak match. confidence=\"low\" REQUIRES playbook_id=null.",
    "- scopes are concepts / tactics / objection types — not the rep's literal words, no account names, no stopwords.",
    "- situation is a short snake_case label (e.g. champion_went_quiet).",
    "",
    "AVAILABLE PLAYBOOKS:",
    renderPlaybookList(rows),
    "",
    "Respond ONLY as JSON matching this exact shape:",
    "{",
    '  "situation": string,',
    '  "situation_summary": string,',
    '  "playbook_id": string | null,',
    '  "playbook_title": string | null,',
    '  "confidence": "high" | "medium" | "low",',
    '  "scopes": string[],',
    '  "reasoning": string',
    "}",
  ].join("\n");
}

function buildUserPrompt(args: ClassifySituationArgs): string {
  const parts: string[] = [
    `REP QUESTION: ${JSON.stringify(args.userContent)}`,
  ];
  const acct = renderAccountBlock(args.account);
  if (acct) parts.push(acct);
  const opp = renderOppBlock(args.opportunity);
  if (opp) parts.push(opp);
  const turns = renderTurnsBlock(args.recentTurns);
  if (turns) parts.push(turns);
  return parts.join("\n");
}

function extractJson(text: string): any | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Strip ```json fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last-ditch: grab the first {...} block.
    const brace = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (brace >= 0 && last > brace) {
      try {
        return JSON.parse(candidate.slice(brace, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalize(
  raw: any,
  validIds: Set<string>,
  titleById: Map<string, string>,
): SituationClassification | null {
  if (!raw || typeof raw !== "object") return null;
  const situation = typeof raw.situation === "string" && raw.situation.trim()
    ? raw.situation.trim()
    : "unknown";
  const situation_summary = typeof raw.situation_summary === "string"
    ? raw.situation_summary.trim()
    : "";
  let playbook_id: string | null = typeof raw.playbook_id === "string" ? raw.playbook_id.trim() : null;
  if (playbook_id && !validIds.has(playbook_id)) {
    // Hallucinated ID — drop it rather than fail the whole classification.
    playbook_id = null;
  }
  const playbook_title = playbook_id ? (titleById.get(playbook_id) ?? null) : null;
  let confidence: ClassifierConfidence =
    raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
      ? raw.confidence
      : "low";
  // Enforce: low confidence MUST not pin a playbook.
  if (confidence === "low") playbook_id = null;
  const scopes = Array.isArray(raw.scopes)
    ? raw.scopes
        .filter((s: unknown): s is string => typeof s === "string")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 1 && s.length <= 60)
        .slice(0, 8)
    : [];
  const reasoning = typeof raw.reasoning === "string" ? raw.reasoning.trim() : "";

  if (!scopes.length && !playbook_id) return null;

  return {
    situation,
    situation_summary,
    playbook_id,
    playbook_title: playbook_id ? playbook_title : null,
    confidence,
    scopes,
    reasoning,
  };
}

export async function classifySituation(
  supabase: any,
  args: ClassifySituationArgs,
): Promise<SituationClassification | null> {
  const start = Date.now();
  try {
    const content = (args.userContent || "").trim();
    if (content.length < MIN_CONTENT_LEN) return null;

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) {
      console.warn("[situation-classifier] LOVABLE_API_KEY missing, skipping");
      return null;
    }

    // Fetch playbooks for the user (cap for prompt size).
    const { data: pbRows, error: pbErr } = await supabase
      .from("playbooks")
      .select("id, title, problem_type, when_to_use, why_it_matters, confidence_score")
      .eq("user_id", args.userId)
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .limit(PLAYBOOK_LIMIT);
    if (pbErr) {
      console.warn("[situation-classifier] playbook fetch failed:", pbErr.message);
      return null;
    }
    const playbooks: PlaybookRow[] = (pbRows ?? []) as PlaybookRow[];
    const validIds = new Set(playbooks.map((p) => p.id));
    const titleById = new Map(playbooks.map((p) => [p.id, p.title]));

    const model = args.model || DEFAULT_MODEL;
    const body = {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(playbooks) },
        { role: "user", content: buildUserPrompt(args) },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    let resp: Response;
    try {
      resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(
        `[situation-classifier] gateway ${resp.status}: ${errText.slice(0, 200)}`,
      );
      return null;
    }

    const data = await resp.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);
    const normalized = normalize(parsed, validIds, titleById);

    const latency = Date.now() - start;
    if (!normalized) {
      console.warn(
        `[situation-classifier] empty/invalid result latency_ms=${latency} raw=${truncate(text, 200)}`,
      );
      return null;
    }

    console.log(
      `[situation-classifier] situation=${normalized.situation} ` +
      `playbook=${normalized.playbook_title ?? "null"} ` +
      `confidence=${normalized.confidence} ` +
      `scopes=[${normalized.scopes.join(",")}] ` +
      `latency_ms=${latency}`,
    );
    return normalized;
  } catch (e) {
    console.warn("[situation-classifier] failed:", (e as Error).message);
    return null;
  }
}
