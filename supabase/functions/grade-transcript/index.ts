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

    const { transcript_id } = await req.json();
    if (!transcript_id) throw new Error("transcript_id required");

    // Fetch transcript
    const { data: transcript, error: tErr } = await supabase
      .from("call_transcripts")
      .select("*")
      .eq("id", transcript_id)
      .single();
    if (tErr || !transcript) throw new Error("Transcript not found");

    // Fetch user's resource links (methodology/playbooks)
    const { data: resources } = await supabase
      .from("resource_links")
      .select("label, category, url, notes")
      .limit(20);

    const resourceContext = (resources || []).length > 0
      ? `The user follows these sales methodologies and resources:\n${(resources || []).map((r: any) => `- ${r.label} (${r.category})${r.notes ? ': ' + r.notes : ''}`).join('\n')}`
      : "No specific sales methodology resources have been uploaded yet. Use general best practices (MEDDICC, Challenger, SPIN).";

    // Fetch account context if available
    let accountContext = "";
    if (transcript.account_id) {
      const { data: account } = await supabase
        .from("accounts")
        .select("name, industry, tier, motion")
        .eq("id", transcript.account_id)
        .single();
      if (account) {
        accountContext = `\nAccount context: ${account.name} (${account.industry || 'unknown industry'}, Tier ${account.tier || 'B'}, Motion: ${account.motion || 'new-logo'})`;
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an elite sales coach who grades call transcripts with brutal honesty and actionable precision. You evaluate on three dimensions:

**STYLE** (0-100): Communication presence, tone, confidence, rapport-building, active listening, empathy, storytelling ability, how they handle objections emotionally.

**ACUMEN** (0-100): Business & product knowledge, discovery quality, understanding of buyer's world, ability to connect solutions to pain points, competitive positioning, value articulation, strategic questioning.

**CADENCE** (0-100): Call structure & pacing, opening effectiveness, agenda setting, transition management, next-step commitment, time management, closing technique, urgency creation.

${resourceContext}
${accountContext}

Grade honestly — most reps are C-level. An A requires exceptional performance. Give scores that differentiate.

You MUST pick ONE focus area (Style, Acumen, or Cadence) for your actionable feedback — choose the one where improvement would have the highest ROI for this specific rep based on the transcript.`;

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
          { role: "user", content: `Grade this call transcript:\n\nTitle: ${transcript.title}\nType: ${transcript.call_type || 'Unknown'}\nParticipants: ${transcript.participants || 'Unknown'}\n\nTranscript:\n${transcript.content.substring(0, 12000)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "grade_transcript",
            description: "Submit the grading results for a sales call transcript",
            parameters: {
              type: "object",
              properties: {
                overall_score: { type: "integer", description: "Overall score 0-100" },
                overall_grade: { type: "string", enum: ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"], description: "Letter grade" },
                style_score: { type: "integer", description: "Style dimension score 0-100" },
                acumen_score: { type: "integer", description: "Acumen dimension score 0-100" },
                cadence_score: { type: "integer", description: "Cadence dimension score 0-100" },
                style_notes: { type: "string", description: "2-3 sentence assessment of style" },
                acumen_notes: { type: "string", description: "2-3 sentence assessment of acumen" },
                cadence_notes: { type: "string", description: "2-3 sentence assessment of cadence" },
                strengths: { type: "array", items: { type: "string" }, description: "2-3 specific strengths observed" },
                improvements: { type: "array", items: { type: "string" }, description: "2-3 specific areas to improve" },
                feedback_focus: { type: "string", enum: ["style", "acumen", "cadence"], description: "The ONE dimension to focus actionable feedback on" },
                actionable_feedback: { type: "string", description: "One specific, actionable piece of coaching advice for the chosen focus area. Be direct, specific, and prescriptive. Include an example of what to say or do differently." },
                summary: { type: "string", description: "2-3 sentence executive summary of the call performance" },
                methodology_alignment: { type: "string", description: "How well the call aligned with the user's sales methodology/resources, if any are provided" },
              },
              required: ["overall_score", "overall_grade", "style_score", "acumen_score", "cadence_score", "style_notes", "acumen_notes", "cadence_notes", "strengths", "improvements", "feedback_focus", "actionable_feedback", "summary"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "grade_transcript" } },
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
      throw new Error("AI grading failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No grading response from AI");

    const grade = JSON.parse(toolCall.function.arguments);

    // Upsert into transcript_grades
    const { data: saved, error: saveErr } = await supabase
      .from("transcript_grades")
      .upsert({
        user_id: user.id,
        transcript_id,
        overall_grade: grade.overall_grade,
        overall_score: grade.overall_score,
        style_score: grade.style_score,
        acumen_score: grade.acumen_score,
        cadence_score: grade.cadence_score,
        style_notes: grade.style_notes,
        acumen_notes: grade.acumen_notes,
        cadence_notes: grade.cadence_notes,
        strengths: grade.strengths,
        improvements: grade.improvements,
        actionable_feedback: grade.actionable_feedback,
        feedback_focus: grade.feedback_focus,
        summary: grade.summary,
        methodology_alignment: grade.methodology_alignment || null,
      }, { onConflict: "transcript_id" })
      .select()
      .single();

    if (saveErr) {
      console.error("Save error:", saveErr);
      throw new Error("Failed to save grade");
    }

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("grade-transcript error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
