/**
 * analyze-call — ST9 Proactive Deal Analysis
 *
 * Triggered after every Post-Call Log save (fire-and-forget from the client).
 * Classifies the call situation, retrieves top-3 KIs, generates Next Best Action,
 * and stores results back in call_logs.nba_situation / nba_text / nba_ki_titles.
 *
 * Non-blocking: errors are logged but never surface to the user.
 * No streaming: single synchronous LLM call (Anthropic claude-haiku).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withEdgeBuildAttestation } from "../_shared/edgeBuildAttestation.ts";
import { classifySituation } from "../_shared/strategy-router/situationClassifier.ts";
import { retrieveLibraryContext } from "../_shared/strategy-core/index.ts";
import { getModelConfig } from '../_shared/getModelConfig.ts';

let MODEL_NAME = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getAnthropicHeaders(): Record<string, string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

async function callClaude(messages: Array<{ role: string; content: string }>, system: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: getAnthropicHeaders(),
    body: JSON.stringify({
      model: MODEL_NAME,
      max_tokens: 512,
      temperature: 0.3,
      system,
      messages,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Anthropic error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.content?.find((b: any) => b.type === "text")?.text ?? "";
  return text.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withEdgeBuildAttestation(
      new Response(null, { headers: corsHeaders }),
      "analyze-call",
    );
  }

  try {
    MODEL_NAME = (await getModelConfig('analyze-call')).primary;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth
    const { data: { user } } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { call_log_id, account_id, summary, expansion_signal_text } = body as {
      call_log_id: string;
      account_id: string | null;
      summary: string;
      expansion_signal_text?: string | null;
    };

    if (!call_log_id || !summary?.trim()) {
      return new Response(JSON.stringify({ error: "call_log_id and summary required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[analyze-call] starting call_log_id=${call_log_id} account_id=${account_id}`);

    // Step 1 — Classify situation from call summary
    const userContent = [summary, expansion_signal_text].filter(Boolean).join(". ");
    const situation = await classifySituation({
      supabase,
      userId: user.id,
      userContent,
      accountContext: "",
    });

    console.log(`[analyze-call] situation=${situation.situation} playbook=${situation.playbookId} confidence=${situation.confidence}`);

    // Step 2 — Retrieve top-3 KIs matching the situation
    const scopes = situation.derivedScopes.length > 0
      ? situation.derivedScopes.slice(0, 6)
      : [situation.situation, "expansion", "next_step"].filter(Boolean);

    let kiTitles: string[] = [];
    let kiContext = "";
    try {
      const library = await retrieveLibraryContext(supabase, user.id, {} as any, {
        scopes,
        maxKIs: 3,
        maxPlaybooks: 1,
        preferredPlaybookId: situation.playbookId,
      });
      kiTitles = (library?.knowledgeItems ?? []).slice(0, 3).map((ki: any) => ki.title ?? "").filter(Boolean);
      kiContext = library?.contextString ?? "";
    } catch (e) {
      console.warn("[analyze-call] retrieveLibraryContext failed (non-fatal):", (e as Error).message);
    }

    console.log(`[analyze-call] ki_titles=${JSON.stringify(kiTitles)}`);

    // Step 3 — Generate NBA text
    const systemPrompt = `You are a Branch.io expansion AE's sales coach. Given a post-call log entry, produce a concise Next Best Action (NBA) in 3–4 sentences maximum.

The NBA must be:
- Specific and actionable (name who, what, when)
- Grounded in the call details
- Focused on advancing Branch expansion
- Written for the AE to act on immediately

Do NOT use placeholder text. Do NOT hedge. State the action directly.`;

    const userMsg = `Call summary: ${summary}${expansion_signal_text ? `\n\nExpansion signal: ${expansion_signal_text}` : ""}

Situation classified: ${situation.situation} (confidence: ${situation.confidence})

${kiContext ? `Relevant knowledge items:\n${kiContext.slice(0, 2000)}` : "No library context available."}

Generate the Next Best Action for this account.`;

    let nbaText = "";
    try {
      nbaText = await callClaude([{ role: "user", content: userMsg }], systemPrompt);
    } catch (e) {
      console.warn("[analyze-call] LLM call failed (non-fatal):", (e as Error).message);
      nbaText = `Follow up on: ${summary.slice(0, 120)}`;
    }

    console.log(`[analyze-call] nba_text_length=${nbaText.length}`);

    // Step 4 — Persist results back to call_logs
    const { error: updateError } = await supabase
      .from("call_logs")
      .update({
        nba_situation: situation.situation,
        nba_text: nbaText,
        nba_ki_titles: kiTitles.length > 0 ? kiTitles : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", call_log_id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[analyze-call] update failed:", updateError.message);
      return new Response(JSON.stringify({ error: "Failed to persist analysis" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[analyze-call] complete call_log_id=${call_log_id} situation=${situation.situation}`);

    return new Response(
      JSON.stringify({
        ok: true,
        call_log_id,
        nba_situation: situation.situation,
        nba_text: nbaText,
        nba_ki_titles: kiTitles,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[analyze-call] unhandled error:", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
