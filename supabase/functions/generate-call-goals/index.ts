import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const { opportunity_id } = await req.json();
    if (!opportunity_id) throw new Error("opportunity_id required");

    // Fetch opportunity
    const { data: opp, error: oppErr } = await supabase
      .from("opportunities")
      .select("*, accounts!opportunities_account_id_fkey(name, industry, tier, motion)")
      .eq("id", opportunity_id)
      .single();
    if (oppErr || !opp) throw new Error("Opportunity not found");

    // Fetch existing methodology
    const { data: methodology } = await supabase
      .from("opportunity_methodology")
      .select("*")
      .eq("opportunity_id", opportunity_id)
      .maybeSingle();

    // Fetch recent transcripts for this opportunity or account
    const { data: transcripts } = await supabase
      .from("call_transcripts")
      .select("title, call_date, call_type, summary, content")
      .or(`opportunity_id.eq.${opportunity_id}${opp.account_id ? `,account_id.eq.${opp.account_id}` : ''}`)
      .order("call_date", { ascending: false })
      .limit(5);

    // Fetch transcript grades for this account
    const { data: grades } = await supabase
      .from("transcript_grades")
      .select("overall_grade, overall_score, coaching_issue, replacement_behavior, meddicc_signals, cotm_signals, call_type")
      .order("created_at", { ascending: false })
      .limit(5);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Build context
    const meddiccFields = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'];
    const gaps = methodology
      ? meddiccFields.filter(f => !(methodology as any)[`${f}_confirmed`]).map(f => f.replace(/_/g, ' '))
      : meddiccFields.map(f => f.replace(/_/g, ' '));

    const cotmFields = ['before_state', 'after_state', 'negative_consequences', 'positive_business_outcomes', 'required_capabilities', 'metrics_value'];
    const cotmGaps = methodology
      ? cotmFields.filter(f => !((methodology as any)[`${f}_notes`] || '').trim()).map(f => f.replace(/_/g, ' '))
      : cotmFields.map(f => f.replace(/_/g, ' '));

    const accountInfo = (opp as any).accounts;
    const transcriptContext = (transcripts || []).map((t: any) =>
      `- ${t.call_date} | ${t.call_type || 'Call'} | ${t.title}\n  Summary: ${(t.summary || t.content?.substring(0, 200) || 'No summary')}`
    ).join('\n');

    const gradeContext = (grades || []).map((g: any) =>
      `- Grade: ${g.overall_grade} | Issue: ${g.coaching_issue || 'none'} | Fix: ${g.replacement_behavior || 'none'}`
    ).join('\n');

    const existingGoals = (methodology?.call_goals || [])
      .filter((g: any) => !g.completed)
      .map((g: any) => g.text)
      .join(', ');

    const prompt = `Generate 3-5 specific, actionable call goal outcomes for the next customer-facing meeting on this opportunity.

## Opportunity
- Name: ${opp.name}
- Stage: ${opp.stage || 'Unknown'}
- ARR: $${opp.arr || 0}
- Next Step: ${opp.next_step || 'None'}
- Notes: ${opp.notes || 'None'}
${accountInfo ? `- Account: ${accountInfo.name} (${accountInfo.industry || 'Unknown'}, Tier ${accountInfo.tier || 'B'})` : ''}

## MEDDICC Gaps (NOT yet confirmed)
${gaps.length > 0 ? gaps.join(', ') : 'All confirmed ✓'}

## Command of the Message Gaps (missing notes)
${cotmGaps.length > 0 ? cotmGaps.join(', ') : 'All documented ✓'}

## Recent Call History
${transcriptContext || 'No prior calls'}

## Recent Coaching Feedback
${gradeContext || 'No grades yet'}

## Existing Uncompleted Goals
${existingGoals || 'None'}

## Rules
- Each goal should be ONE specific outcome that can be confirmed/denied after the call
- Prioritize uncovering MEDDICC and CotM gaps — these are cumulative across calls, focus on what's still missing
- Consider the deal stage — early stages need more discovery, later stages need process/champion validation
- Make goals behavioral and evidence-based, e.g. "Get the CFO to articulate the cost of inaction" not "Discuss budget"
- Do NOT repeat existing uncompleted goals
- Reference specific gaps and prior call context when relevant`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an elite sales coach. Generate laser-focused call objectives that drive deal progression. Be specific and prescriptive." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_call_goals",
            description: "Generate specific call goal outcomes for the next meeting",
            parameters: {
              type: "object",
              properties: {
                goals: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string", description: "The specific goal outcome" },
                      rationale: { type: "string", description: "Why this goal matters for deal progression" },
                      framework: { type: "string", description: "Which framework gap this addresses (MEDDICC element or CotM element)" },
                    },
                    required: ["text", "rationale", "framework"],
                    additionalProperties: false,
                  },
                  minItems: 3,
                  maxItems: 5,
                },
              },
              required: ["goals"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_call_goals" } },
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
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      throw new Error("AI goal generation failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No goals generated");

    const { goals } = JSON.parse(toolCall.function.arguments);

    // Merge with existing goals
    const existingCallGoals = methodology?.call_goals || [];
    const newGoals = goals.map((g: any) => ({
      id: crypto.randomUUID(),
      text: g.text,
      completed: false,
      rationale: g.rationale,
      framework: g.framework,
    }));

    const mergedGoals = [...existingCallGoals, ...newGoals];

    // Upsert methodology with new goals
    await supabase
      .from("opportunity_methodology")
      .upsert({
        user_id: user.id,
        opportunity_id,
        call_goals: mergedGoals,
      }, { onConflict: "user_id,opportunity_id" });

    return new Response(JSON.stringify({ goals: newGoals, total: mergedGoals.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-call-goals error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
