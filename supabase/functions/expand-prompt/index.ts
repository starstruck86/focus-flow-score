/**
 * expand-prompt — Easy Prompt (visible/editable)
 *
 * Client-triggered terse-prompt expansion. The user taps "Expand" in the
 * composer; this returns a fuller Branch expansion-AE instruction that the
 * client drops back INTO the composer for the user to edit before sending.
 *
 * Direct Anthropic (claude-haiku) — no Lovable gateway. Non-blocking by
 * contract: any failure returns { expanded: original, wasExpanded: false }.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getModelConfig } from '../_shared/getModelConfig.ts';

let MODEL_NAME = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_OUTPUT_TOKENS = 400;
const TIMEOUT_MS = 8_000;
const TEMPERATURE = 0.3;

const BRANCH_VOCAB_RE = new RegExp(
  [
    "deep linking", "deferred deep linking", "universal ads", "email-to-app",
    "sms-to-app", "web-to-app", "\\bqr\\b", "\\baio\\b", "advanced privacy",
    "\\bmmp\\b", "attribution", "deferred link", "journeys", "footprint",
    "whitespace", "\\bqbr\\b", "expansion-arr",
    "adjust", "appsflyer", "kochava", "singular", "airbridge", "tenjin",
  ].join("|"),
  "i",
);

const STRUCTURED_ASK_RE =
  /\b(draft|write|outline|build|generate|create|compose|prepare|prep)\s+(a|an|the|me)?\s*(email|one[- ]?pager|brief|proposal|qbr|deck|script|narrative|plan|response|questions|agenda|note|recap|follow[- ]?up)\b/i;

function wordCount(s: string): number {
  const t = (s || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

function isTerse(content: string): boolean {
  const text = (content || "").trim();
  if (!text) return false;
  if (wordCount(text) >= 20) return false;
  if (BRANCH_VOCAB_RE.test(text)) return false;
  if (STRUCTURED_ASK_RE.test(text)) return false;
  const sentenceCount = (text.match(/[.!?]+\s+\S/g) || []).length + 1;
  if (sentenceCount >= 3) return false;
  return true;
}

const EXPANSION_SYSTEM_PROMPT = `You are a Branch.io expansion AE assistant. When given a terse sales question from a Strategic Account Executive, expand it into a complete, specific instruction that will produce a great answer.

Inject:
- The specific account name if mentioned (or referenced via context),
- The exact Branch situation (QBR prep, competitive displacement, expansion play, champion quiet, renewal risk, discovery, objection handling, business case),
- The specific Branch product most relevant (deep linking, deferred deep linking, Universal Ads, Email-to-App, SMS-to-App, Web-to-App, QR, AIO, Advanced Privacy, MMP/attribution),
- The competitive dynamic (Adjust, AppsFlyer, Kochava, Singular, Airbridge, Tenjin) when implied,
- What the AE actually needs (a call script? a business case? a QBR narrative? a list of discovery questions? an objection handler? a one-pager?).

Frame everything as a Branch expansion AE working an existing customer (not a net-new prospect). The job is expansion-ARR, not new logo.

Return ONLY the expanded prompt — no preamble, no explanation, no "Here is the expanded prompt:" prefix.

If the question is already specific, return it UNCHANGED.`;

function getAnthropicHeaders(): Record<string, string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const respond = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let originalContent = "";
  try {
    MODEL_NAME = (await getModelConfig('expand-prompt')).primary;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const body = await req.json();
    originalContent = (body?.userContent ?? "").toString();
    const territoryContext = (body?.territoryContext ?? "").toString();
    const accountContext = (body?.accountContext ?? "").toString();

    const fallback = { expanded: originalContent, wasExpanded: false, originalContent };

    if (!isTerse(originalContent)) {
      console.log(`[expand-prompt] skipped=not_terse words=${wordCount(originalContent)}`);
      return respond(fallback);
    }

    const parts: string[] = [];
    if (territoryContext.trim()) parts.push(`Territory context:\n${territoryContext.trim()}`);
    if (accountContext.trim()) parts.push(`Account context:\n${accountContext.trim()}`);
    parts.push(`Terse AE question:\n${originalContent.trim()}`);
    parts.push(`Return the expanded instruction now (or return the question unchanged if already specific).`);
    const userPrompt = parts.join("\n\n");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: getAnthropicHeaders(),
        signal: ctrl.signal,
        body: JSON.stringify({
          model: MODEL_NAME,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: TEMPERATURE,
          system: EXPANSION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(`[expand-prompt] anthropic ${resp.status}: ${errText.slice(0, 200)}`);
      return respond(fallback);
    }

    const data = await resp.json().catch(() => null);
    const text = (data?.content?.find((b: any) => b.type === "text")?.text || "").trim();
    if (!text) {
      console.warn("[expand-prompt] empty completion, falling back");
      return respond(fallback);
    }

    const normalizedOrig = originalContent.trim().toLowerCase();
    const wasExpanded =
      text.toLowerCase() !== normalizedOrig &&
      Math.abs(text.length - originalContent.trim().length) > 10;

    console.log(`[expand-prompt] expanded=${wasExpanded} original_len=${originalContent.length} expanded_len=${text.length}`);

    return respond({
      expanded: wasExpanded ? text : originalContent,
      wasExpanded,
      originalContent,
    });
  } catch (e) {
    console.warn("[expand-prompt] threw, falling back:", (e as Error).message);
    return respond({ expanded: originalContent, wasExpanded: false, originalContent });
  }
});
