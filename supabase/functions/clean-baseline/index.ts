/**
 * Phase 3.5A — Clean Baseline Endpoint.
 *
 * Calls the Lovable AI gateway with ZERO Strategy context:
 *   - No library retrieval
 *   - No account/opportunity memory
 *   - No Strategy system prompts or SOP
 *   - No expansion, synthesis, or workspace contracts
 *   - No working thesis, resource retrieval, or V2 reasoning
 *
 * This produces what a user would get from a generic LLM (ChatGPT-equivalent)
 * given only the raw user prompt and a minimal assistant instruction.
 *
 * Used exclusively by the Phase 3.5A Output Evaluation comparison.
 */
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.1/dist/module/lib/constants.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const { prompt } = body as { prompt: string };

    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({ error: "prompt is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const started = Date.now();

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful sales strategy assistant. " +
              "Answer the user's question with actionable, specific advice. " +
              "Do not reference any internal library, playbook, or proprietary methodology. " +
              "Use only general sales knowledge.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_completion_tokens: 4096,
      }),
    });

    const latencyMs = Date.now() - started;

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: `AI gateway error: ${resp.status}`,
          detail: errText.slice(0, 500),
          latencyMs,
        }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({
        text,
        latencyMs,
        baseline_mode: "clean_baseline",
        baseline_context_used: false,
        baseline_library_used: false,
        baseline_memory_used: false,
        model: "openai/gpt-5-mini",
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
