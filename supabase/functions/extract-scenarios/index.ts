import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_SKILLS = [
  "objection_handling",
  "discovery",
  "executive_response",
  "deal_control",
  "qualification",
] as const;

const VALID_DIFFICULTIES = ["foundational", "intermediate", "advanced"] as const;

const SYSTEM_PROMPT = `You are an elite sales coach analyzing a real call transcript.

Your job is to extract high-quality training scenarios from this call.

RULES:
1. DO NOT summarize the call
2. DO NOT explain the call
3. DO NOT give general advice
4. ONLY produce scenarios that can be practiced
5. ALWAYS return 5 scenarios if the transcript has enough substance

Each scenario must include:
- title: short, specific, actionable (describe the situation)
- skillFocus: MUST be one of: ${VALID_SKILLS.join(", ")}
- context: 1-2 sentences describing the situation with relevant business context
- objection: the exact moment the rep needs to respond — should feel like something a buyer would actually say
- difficulty: MUST be one of: ${VALID_DIFFICULTIES.join(", ")}
- sourceExcerpt: a real quote from the BUYER (not the rep) that reveals the moment worth practicing. Quote the buyer's words that the rep failed to handle well.
- coachingHint: one sentence — what the rep should do differently (not the full answer)

DIFFICULTY CALIBRATION:
- foundational: the rep violated a basic principle any trained rep should know (e.g., pitching before discovering, ignoring stated priorities, answering questions not asked)
- intermediate: the rep missed a real opportunity that requires situational awareness (e.g., weak follow-up, generic competitive response, shallow discovery)
- advanced: the moment requires high skill and nuance to handle well (e.g., navigating exec-level politics, recovering credibility, handling multi-threaded deals)
Default DOWN, not up. If in doubt between foundational and intermediate, choose foundational.

PRIORITIZATION:
Tier 1 (most important): moments that would kill or stall the deal — loss of control, missed qualification, weak objection handling, pitching before understanding the problem
Tier 2: shallow discovery, missed follow-ups, generic responses
Tier 3: style issues (too long, unclear, etc.)

CRITICAL: The FIRST and most important thing to check is whether the rep understood the buyer's actual problem before proposing a solution. If the rep pitched before doing discovery, that MUST be the first scenario. This is almost always the highest-leverage mistake.

If multiple mistakes exist in one moment, choose the highest-leverage mistake.

Every scenario must feel like: "This is exactly what I should practice next"
NOT: "This is what happened in the call"`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, title, callType } = await req.json();

    if (!transcript || transcript.length < 200) {
      return new Response(
        JSON.stringify({ error: "Transcript too short (min 200 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "Missing API key" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contextParts: string[] = [];
    if (title) contextParts.push(`Call title: "${title}"`);
    if (callType) contextParts.push(`Call type: ${callType}`);
    const contextLine = contextParts.length > 0 ? contextParts.join(" | ") + "\n\n" : "";

    const userPrompt = `${contextLine}Analyze this transcript and extract 3-5 training scenarios.

Return ONLY a JSON array of scenario objects. No markdown, no explanation, no code fences.

Transcript:
---
${transcript.slice(0, 30000)}
---`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_scenarios",
              description: "Extract training scenarios from a call transcript",
              parameters: {
                type: "object",
                properties: {
                  scenarios: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Short, specific, actionable title" },
                        skillFocus: { type: "string", enum: [...VALID_SKILLS] },
                        context: { type: "string", description: "1-2 sentences of business context" },
                        objection: { type: "string", description: "The exact buyer moment the rep must respond to" },
                        difficulty: { type: "string", enum: [...VALID_DIFFICULTIES] },
                        sourceExcerpt: { type: "string", description: "Real quote from the transcript" },
                        coachingHint: { type: "string", description: "One sentence: what the rep should do differently" },
                      },
                      required: ["title", "skillFocus", "context", "objection", "difficulty", "sourceExcerpt", "coachingHint"],
                      additionalProperties: false,
                    },
                    minItems: 3,
                    maxItems: 5,
                  },
                },
                required: ["scenarios"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_scenarios" } },
        temperature: 0.4,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI API error:", aiResp.status, errText);

      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "AI generation failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResp.json();

    // Extract from tool call response
    let scenarios: any[] = [];
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        scenarios = parsed.scenarios || [];
      } catch {
        console.error("Failed to parse tool call arguments");
      }
    }

    // Fallback: try content as JSON
    if (scenarios.length === 0) {
      const content = aiData.choices?.[0]?.message?.content || "";
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        scenarios = Array.isArray(parsed) ? parsed : parsed.scenarios || [];
      } catch {
        console.error("Failed to parse content fallback");
      }
    }

    // Validate and normalize
    scenarios = scenarios
      .filter((s: any) => s.title && s.skillFocus && s.context && s.objection)
      .map((s: any) => ({
        ...s,
        skillFocus: VALID_SKILLS.includes(s.skillFocus) ? s.skillFocus : "objection_handling",
        difficulty: VALID_DIFFICULTIES.includes(s.difficulty) ? s.difficulty : "intermediate",
      }))
      .slice(0, 5);

    if (scenarios.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not extract scenarios from this transcript" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ scenarios }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("extract-scenarios error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
