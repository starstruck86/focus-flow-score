// ════════════════════════════════════════════════════════════════
// Easy Prompt (task 3.1)
//
// Pre-generation rewrite step. If the user's message is terse and
// underspecified (e.g. "prep me for the Disney call", "what's the
// play on Adjust"), a small LLM pass expands it into a full Branch
// expansion-AE instruction BEFORE the situation classifier, library
// retrieval, and prompt assembly see it. The original message is
// still what's stored in chat history — the user never sees the
// expansion.
//
// Non-blocking by contract: any failure (LLM error, bad response,
// fetch failure, timeout, missing key) returns the original content
// untouched. Easy Prompt must never block the chat path.
// ════════════════════════════════════════════════════════════════

export interface ExpandPromptArgs {
  userContent: string;
  userId: string;
  supabase: unknown;
  /** Pre-formatted territory profile block (optional). */
  territoryContext?: string;
  /** Pre-formatted account context block (optional). */
  accountContext?: string;
  /** Override model for tests. */
  model?: string;
}

export interface ExpandPromptResult {
  expanded: string;
  wasExpanded: boolean;
  originalContent: string;
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 300;
const TIMEOUT_MS = 8_000;
const TEMPERATURE = 0.3;

// ─── Terse detection ─────────────────────────────────────────────
//
// A message is "terse" (and a candidate for expansion) when:
//   • It is short (< 20 words), AND
//   • It does NOT already contain Branch product / situation
//     vocabulary, AND
//   • It does NOT already look like a clear, structured ask
//     (multi-sentence, contains an explicit format word like
//     "draft / write / outline / email / one-pager / brief /
//     proposal / questions").
//
// Long, vocabulary-rich, or explicitly structured asks bypass
// expansion — the rep already gave us enough to ground on.

const BRANCH_VOCAB_RE = new RegExp(
  [
    "deep linking",
    "deferred deep linking",
    "universal ads",
    "email-to-app",
    "sms-to-app",
    "web-to-app",
    "\\bqr\\b",
    "\\baio\\b",
    "advanced privacy",
    "\\bmmp\\b",
    "attribution",
    "deferred link",
    "journeys",
    "footprint",
    "whitespace",
    "\\bqbr\\b",
    "expansion-arr",
    "adjust",
    "appsflyer",
  ].join("|"),
  "i",
);

const STRUCTURED_ASK_RE =
  /\b(draft|write|outline|build|generate|create|compose|prepare|prep)\s+(a|an|the|me)?\s*(email|one[- ]?pager|brief|proposal|qbr|deck|script|narrative|plan|response|questions|agenda|note|recap|follow[- ]?up)\b/i;

function wordCount(s: string): number {
  const t = (s || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function isTerse(content: string): boolean {
  const text = (content || "").trim();
  if (!text) return false;
  const words = wordCount(text);
  if (words >= 20) return false;
  if (BRANCH_VOCAB_RE.test(text)) return false;
  if (STRUCTURED_ASK_RE.test(text)) return false;
  // Multi-sentence asks (2+ sentences) are usually specific enough.
  const sentenceCount = (text.match(/[.!?]+\s+\S/g) || []).length + 1;
  if (sentenceCount >= 3) return false;
  return true;
}

// ─── Expansion system prompt ─────────────────────────────────────

const EXPANSION_SYSTEM_PROMPT = `You are a Branch.io expansion AE assistant. When given a terse sales question from a Strategic Account Executive, expand it into a complete, specific instruction that will produce a great answer.

Inject:
- The specific account name if mentioned (or referenced via context),
- The exact Branch situation (QBR prep, competitive displacement, expansion play, champion quiet, renewal risk, discovery, objection handling, business case),
- The specific Branch product most relevant (deep linking, deferred deep linking, Universal Ads, Email-to-App, SMS-to-App, Web-to-App, QR, AIO, Advanced Privacy, MMP/attribution),
- The competitive dynamic (Adjust, AppsFlyer) when implied,
- What the AE actually needs (a call script? a business case? a QBR narrative? a list of discovery questions? an objection handler? a one-pager?).

Frame everything as a Branch expansion AE working an existing customer (not a net-new prospect). The job is expansion-ARR, not new logo.

Return ONLY the expanded prompt — no preamble, no explanation, no "Here is the expanded prompt:" prefix.

If the question is already specific (long, contains Branch product names, or already has a clear structured ask), return it UNCHANGED.`;

function buildUserPrompt(
  userContent: string,
  territoryContext: string,
  accountContext: string,
): string {
  const parts: string[] = [];
  if (territoryContext && territoryContext.trim()) {
    parts.push(`Territory context:\n${territoryContext.trim()}`);
  }
  if (accountContext && accountContext.trim()) {
    parts.push(`Account context:\n${accountContext.trim()}`);
  }
  parts.push(`Terse AE question:\n${userContent.trim()}`);
  parts.push(`Return the expanded instruction now (or return the question unchanged if already specific).`);
  return parts.join("\n\n");
}

// ─── Main entry point ────────────────────────────────────────────

export async function expandPromptIfTerse(
  args: ExpandPromptArgs,
): Promise<ExpandPromptResult> {
  const start = Date.now();
  const originalContent = args.userContent ?? "";
  const fallback: ExpandPromptResult = {
    expanded: originalContent,
    wasExpanded: false,
    originalContent,
  };

  try {
    if (!isTerse(originalContent)) {
      console.log(
        `[easy-prompt] skipped=not_terse words=${wordCount(originalContent)}`,
      );
      return fallback;
    }

    const key = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
      .Deno?.env.get("LOVABLE_API_KEY");
    if (!key) {
      console.warn("[easy-prompt] LOVABLE_API_KEY missing, falling back");
      return fallback;
    }

    const userPrompt = buildUserPrompt(
      originalContent,
      args.territoryContext ?? "",
      args.accountContext ?? "",
    );

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
            { role: "system", content: EXPANSION_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: TEMPERATURE,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(
        `[easy-prompt] gateway ${resp.status}: ${errText.slice(0, 200)}`,
      );
      return fallback;
    }

    const data = (await resp.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    if (!text) {
      console.warn("[easy-prompt] empty completion, falling back");
      return fallback;
    }

    // If the model echoed the original (within 10 chars), treat as no-op.
    const normalizedOrig = originalContent.trim().toLowerCase();
    const normalizedNew = text.toLowerCase();
    const wasExpanded =
      normalizedNew !== normalizedOrig &&
      Math.abs(text.length - originalContent.trim().length) > 10;

    const latency = Date.now() - start;
    console.log(
      `[easy-prompt] expanded=${wasExpanded} ` +
        `original_len=${originalContent.length} ` +
        `expanded_len=${text.length} ` +
        `latency_ms=${latency}`,
    );

    return {
      expanded: wasExpanded ? text : originalContent,
      wasExpanded,
      originalContent,
    };
  } catch (e) {
    console.warn(
      "[easy-prompt] threw, falling back:",
      (e as Error).message,
    );
    return fallback;
  }
}
