import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getModelConfig } from '../_shared/getModelConfig.ts';

let MODEL_NAME = "claude-haiku-4-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface MemoryExtract {
  content: string;
  memory_type: string;
  confidence: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    MODEL_NAME = (await getModelConfig('extract-strategy-memory')).primary;
    const {
      userId,
      accountId,
      threadId,
      userMessage,
      assistantMessage,
    }: {
      userId: string;
      accountId: string;
      threadId: string;
      userMessage: string;
      assistantMessage: string;
    } = await req.json();

    if (!userId || !accountId || !threadId || !assistantMessage) {
      return new Response(JSON.stringify({ ok: false, reason: "missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (assistantMessage.trim().length < 200) {
      return new Response(JSON.stringify({ ok: true, extracted: 0, reason: "response too short" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ ok: false, reason: "no ANTHROPIC_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extractionPrompt = `You are extracting sales intelligence facts from a conversation between a sales rep and their AI assistant.

Extract 1-3 concrete, specific facts worth remembering about the account being discussed.

INCLUDE only facts about:
- Named contacts (name, title, role, relationship to deal)
- Pain points explicitly mentioned or confirmed
- Decisions made or next steps agreed upon
- Timeline, urgency, or budget signals
- Competitive intelligence surfaced
- Account strategic priorities or initiatives

EXCLUDE:
- Generic sales advice or best practices
- Hypothetical scenarios
- Product feature explanations
- Vague observations without specific detail

User message:
${userMessage.slice(0, 800)}

Assistant response:
${assistantMessage.slice(0, 1200)}

Return ONLY valid JSON. No markdown, no preamble. Format exactly:
{"memories": [{"content": "Specific concrete fact", "memory_type": "contact|pain|decision|signal|next_step", "confidence": 0.85}]}

Return {"memories": []} if nothing concrete and specific to capture.`;

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        max_tokens: 400,
        messages: [{ role: "user", content: extractionPrompt }],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      console.error("[extract-memory] Haiku error", aiResp.status, errText.slice(0, 200));
      return new Response(JSON.stringify({ ok: false, reason: "AI extraction failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const rawText = aiData.content?.[0]?.text ?? "{}";

    let extracted: { memories: MemoryExtract[] } = { memories: [] };
    try {
      const clean = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      extracted = JSON.parse(clean);
    } catch {
      console.warn("[extract-memory] JSON parse failed:", rawText.slice(0, 100));
      return new Response(JSON.stringify({ ok: true, extracted: 0, reason: "parse failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!extracted.memories?.length) {
      return new Response(JSON.stringify({ ok: true, extracted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const VALID_MEMORY_TYPES = new Set(["contact", "pain", "decision", "signal", "next_step"]);

    const { data: existing } = await supabase
      .from("account_strategy_memory")
      .select("content")
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .eq("is_irrelevant", false)
      .order("created_at", { ascending: false })
      .limit(30);

    const existingContents = new Set((existing ?? []).map((m: { content: string }) =>
      (m.content as string).toLowerCase().slice(0, 50)
    ));

    const toInsert = extracted.memories.filter((mem) => {
      if (!mem.content?.trim() || mem.content.trim().length < 15) return false;
      if (!VALID_MEMORY_TYPES.has(mem.memory_type)) return false;
      const fingerprint = mem.content.toLowerCase().slice(0, 50);
      return !existingContents.has(fingerprint);
    });

    if (!toInsert.length) {
      return new Response(JSON.stringify({ ok: true, extracted: 0, reason: "all duplicates" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = toInsert.map((mem) => ({
      user_id: userId,
      account_id: accountId,
      memory_type: mem.memory_type,
      content: mem.content.trim(),
      confidence: Math.min(1, Math.max(0, mem.confidence ?? 0.75)),
      source_thread_id: threadId,
      is_pinned: false,
      is_irrelevant: false,
    }));

    const { error: insertError } = await supabase
      .from("account_strategy_memory")
      .insert(rows);

    if (insertError) {
      console.error("[extract-memory] insert error:", insertError.message);
      return new Response(JSON.stringify({ ok: false, reason: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[extract-memory] saved ${rows.length} memories for account ${accountId}`);
    return new Response(
      JSON.stringify({ ok: true, extracted: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("[extract-memory] unexpected error:", String(e));
    return new Response(JSON.stringify({ ok: false, reason: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
