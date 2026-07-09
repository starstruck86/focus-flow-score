// ════════════════════════════════════════════════════════════════
// classify-signal — Signal Inbox classifier
//
// Takes raw pasted text from Corey, classifies it into one of four
// intelligence heads (sales / competitive / product / market), extracts
// a signal_type + 1-sentence implication for his Branch.io expansion
// territory, then inserts into account_signals and returns the row.
//
// Follows the same gateway pattern as
// supabase/functions/_shared/strategy-router/situationClassifier.ts.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getModelConfig } from '../_shared/getModelConfig.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIMEOUT_MS = 12_000;
const MAX_TOKENS = 400;

const HEADS = ["sales", "competitive", "product", "market"] as const;
type Head = (typeof HEADS)[number];

const SIGNAL_TYPES = [
  "leadership_change",
  "budget_signal",
  "app_launch",
  "expansion_signal",
  "usage_update",
  "contact_change",
  "renewal_signal",
  "competitor_move",
  "product_update",
  "market_trend",
  "other",
] as const;
type SignalType = (typeof SIGNAL_TYPES)[number];

const SYSTEM_PROMPT = [
  "You are a Branch.io expansion AE intelligence classifier. Classify the provided text into exactly one intelligence head and extract the key implication.",
  "",
  "Intelligence heads:",
  "- sales: account-specific intel about one of the AE's accounts (leadership change, budget signal, app launch, expansion signal, usage update, contact change, renewal signal)",
  "- competitive: intel about Branch competitors (Adjust, AppsFlyer, Kochava, Singular) — pricing, features, GTM moves, acquisitions",
  "- product: Branch product updates (new Branch feature, SDK release, pricing change, product announcement)",
  "- market: industry/market trends affecting mobile attribution, deep linking, or app growth (regulation, platform changes, industry reports)",
  "",
  "Return ONLY valid JSON (no markdown):",
  "{",
  '  "intelligence_head": "sales" | "competitive" | "product" | "market",',
  '  "signal_type": "leadership_change" | "budget_signal" | "app_launch" | "expansion_signal" | "usage_update" | "contact_change" | "renewal_signal" | "competitor_move" | "product_update" | "market_trend" | "other",',
  '  "implications": "One specific sentence: what this means for Corey\'s expansion territory at Branch.io",',
  '  "confidence": 0.0-1.0',
  "}",
].join("\n");

function extractJson(text: string): any {
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
      try { return JSON.parse(candidate.slice(open, close + 1)); } catch { return null; }
    }
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { primary: model } = await getModelConfig('classify-signal');
    const body = await req.json().catch(() => ({}));
    const rawText: string = (body?.rawText ?? "").toString().trim();
    const userId: string = (body?.userId ?? "").toString().trim();
    const accountId: string | null = body?.accountId ?? null;
    const accountName: string | null = body?.accountName ?? null;
    const sourceLabel: string | null = body?.sourceLabel ?? null;
    const sourceUrl: string | null = body?.sourceUrl ?? null;

    if (!rawText || rawText.length < 4) {
      return new Response(JSON.stringify({ error: "rawText required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctxLines: string[] = [];
    if (accountName) ctxLines.push(`Linked account: ${accountName}`);
    if (sourceLabel) ctxLines.push(`Source: ${sourceLabel}`);
    const userMsg = (ctxLines.length ? ctxLines.join("\n") + "\n\n" : "") +
      `TEXT TO CLASSIFY:\n${rawText.slice(0, 6000)}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMsg },
          ],
          temperature: 0,
          max_tokens: MAX_TOKENS,
          response_format: { type: "json_object" },
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(`[classify-signal] gateway ${resp.status}: ${errText.slice(0, 300)}`);
      const status = resp.status === 429 || resp.status === 402 ? resp.status : 502;
      return new Response(JSON.stringify({ error: "gateway_error", status: resp.status, detail: errText.slice(0, 200) }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);

    let head: Head = "sales";
    if (parsed && HEADS.includes(parsed.intelligence_head)) head = parsed.intelligence_head;
    let sigType: SignalType = "other";
    if (parsed && SIGNAL_TYPES.includes(parsed.signal_type)) sigType = parsed.signal_type;
    const implications: string = typeof parsed?.implications === "string" ? parsed.implications.trim() : "";
    const confidence: number = typeof parsed?.confidence === "number" ? parsed.confidence : 0.5;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: inserted, error: insErr } = await supabase
      .from("account_signals")
      .insert({
        user_id: userId,
        raw_text: rawText,
        signal_type: sigType,
        intelligence_head: head,
        implications,
        linked_account_id: accountId,
        linked_account_name: accountName,
        source_label: sourceLabel,
        source_url: sourceUrl,
      })
      .select()
      .single();

    if (insErr) {
      console.error("[classify-signal] insert failed:", insErr.message);
      return new Response(JSON.stringify({ error: "insert_failed", detail: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[classify-signal] head=${head} type=${sigType} confidence=${confidence}`);

    return new Response(JSON.stringify({ signal: inserted, classification: { intelligence_head: head, signal_type: sigType, implications, confidence } }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[classify-signal] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", detail: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
