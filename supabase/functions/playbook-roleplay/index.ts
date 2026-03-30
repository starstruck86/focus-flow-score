/**
 * Playbook Roleplay Edge Function
 * 
 * Streams AI buyer responses during playbook roleplay sessions.
 * Hardened: realistic pressure, anti-pattern detection, direct coaching.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, scenario, mode, knowledgeGrounding } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Build system prompt based on mode
    let systemPrompt = scenario;
    
    if (mode === 'feedback') {
      systemPrompt = `You are an elite sales coach who has just observed a live roleplay session. The scenario was:
${scenario}

Review the conversation and provide BRUTALLY HONEST, DIRECT coaching. No sugarcoating.

Format your response EXACTLY like this:

## What Worked
- Quote specific moments where the rep executed well (use their exact words)
- Explain WHY it worked on the buyer
- If nothing worked well, say so directly

## What Hurt the Conversation
- Identify the exact moment the conversation went sideways
- Quote the rep's words that caused the problem
- Explain the buyer's reaction and why it happened
- Call out: rambling, pitching too early, avoiding questions, filler words, being too agreeable

## What to Change Next Time
- Give 2-3 specific, rewritten responses — show EXACTLY what they should have said instead
- Each rewrite should include the context (what the buyer said) and the improved response
- Explain why the rewrite is better

## Score: X/10
One sentence justification. Be honest — a 5 is average, a 7 is good, a 9 is exceptional.

## Retry Focus
If they retry right now, the ONE thing to focus on improving.

Be direct. Be specific. Quote their actual words. This is coaching, not praise.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI roleplay failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("playbook-roleplay error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
