import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service client for writes
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { lessonId } = await req.json();
    if (!lessonId) {
      return new Response(JSON.stringify({ error: "lessonId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch lesson shell ──
    const { data: lesson, error: lessonErr } = await adminClient
      .from("learning_lessons")
      .select("*, learning_modules!inner(title, course_id, learning_courses!inner(title, topic))")
      .eq("id", lessonId)
      .single();

    if (lessonErr || !lesson) {
      return new Response(JSON.stringify({ error: "Lesson not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (lesson.generation_status === "complete" && lesson.lesson_content) {
      return new Response(JSON.stringify({ status: "already_generated", lessonId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark generating
    await adminClient
      .from("learning_lessons")
      .update({ generation_status: "generating" })
      .eq("id", lessonId);

    // ── Fetch relevant KIs ──
    const topic = lesson.topic;
    let { data: kis } = await adminClient
      .from("knowledge_items")
      .select("id, title, tactic_summary, why_it_matters, when_to_use, when_not_to_use, example_usage, framework, chapter, sub_chapter")
      .eq("chapter", topic)
      .eq("active", true)
      .eq("is_core_ae", true)
      .order("confidence_score", { ascending: false })
      .limit(25);

    // Fallback: if chapter name doesn't match (e.g. "deal_control" is a spider_dimension,
    // not a chapter name), query by spider_dimension instead
    if (!kis || kis.length < 5) {
      const { data: dimKis } = await adminClient
        .from("knowledge_items")
        .select("id, title, tactic_summary, why_it_matters, when_to_use, when_not_to_use, example_usage, framework, chapter, sub_chapter")
        .eq("spider_dimension", topic)
        .eq("active", true)
        .eq("is_core_ae", true)
        .order("confidence_score", { ascending: false })
        .limit(25);

      if (dimKis && dimKis.length > (kis?.length ?? 0)) {
        kis = dimKis;
      }
    }

    if (!kis || kis.length === 0) {
      await adminClient
        .from("learning_lessons")
        .update({ generation_status: "failed" })
        .eq("id", lessonId);
      return new Response(JSON.stringify({ error: "No KIs found for topic" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kiContext = kis
      .slice(0, 15)
      .map((ki, i) => `[KI-${i + 1}] ${ki.title}\nSummary: ${ki.tactic_summary}\nWhy: ${ki.why_it_matters}\nWhen: ${ki.when_to_use}\nWhen not: ${ki.when_not_to_use || 'N/A'}\nExample: ${ki.example_usage || 'N/A'}`)
      .join("\n\n");

    const sourceKiIds = kis.slice(0, 15).map((ki) => ki.id);

    // ── Generate with AI ──
    const systemPrompt = `You are an elite sales coach building a training lesson for a Strategic Account Executive (AE) with years of enterprise sales experience.

CRITICAL AUDIENCE CONTEXT: This person sells complex solutions to sophisticated Fortune 500 and mid-market companies. They regularly interact with C-suite executives — CFOs, CROs, CTOs, CPOs. They are NOT a new hire or SDR. Do NOT explain basic sales concepts. Do NOT use generic or beginner-level scenarios.

All scenarios must involve:
- Enterprise deals with multiple stakeholders and political complexity
- C-level or VP-level buyer personas with real business agendas
- Sophisticated objections (strategic misalignment, board mandate conflicts, incumbent vendor entrenchment, procurement gatekeeping)
- High-stakes deal moments — not routine calls
- Deal values and business impact at scale

The 'difficulty_level' in the user prompt sets the bar WITHIN enterprise content:
- 'intermediate' = solid AE practitioner navigating complex deals
- 'advanced' = elite-level, nuanced, C-suite ready, requires deep commercial instinct

Return a JSON object with exactly this structure:
{
  "lesson_content": {
    "concept": "2-3 paragraphs on the core concept. Direct, practical, no fluff. Written for someone who already knows the basics and wants the advanced mechanics.",
    "what_good_looks_like": "A specific, realistic enterprise scenario showing this concept done at an elite level. Include the exact words a top AE would say — not generic, not textbook. The buyer should be a real executive with a real agenda.",
    "breakdown": "Why the example works. Break down the specific moves — what the rep said, why it lands, what would have happened with a weaker response.",
    "when_to_use": "Specific enterprise scenarios where this applies. Reference deal stages, buyer personas, or political situations — not generic triggers.",
    "when_not_to_use": "When this approach backfires. Be honest. Name the situations where even experienced AEs misapply this."
  },
  "quiz_content": {
    "mc_questions": [
      {
        "id": "q1",
        "question": "A realistic enterprise scenario — the buyer says something specific. Which response best applies the concept from this lesson? The scenario should involve a C-level or VP-level buyer.",
        "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
        "correct_answer": "B",
        "explanation": "Why B is correct. Why the other options fall short — be specific about what's wrong with each."
      },
      {
        "id": "q2",
        "question": "A different enterprise scenario testing the same concept from a different angle — a different deal stage, persona, or context.",
        "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
        "correct_answer": "C",
        "explanation": "Why C is correct."
      }
    ],
    "open_ended_prompt": "A specific, high-stakes enterprise scenario. Include the company context (size, stage, buyer persona, deal situation). The buyer says something concrete. The AE must respond using the technique from this lesson. Example format: 'You are 3 weeks into a deal with the CRO of a $200M SaaS company. She just said: [specific statement]. Write your response.'",
    "rubric": "What a strong answer includes (3-4 specific criteria). What a weak answer looks like (specific anti-patterns to avoid). Grade on: application of the concept, enterprise-level specificity, control of the conversation."
  }
}

Rules:
- NEVER use generic examples like 'the prospect uses spreadsheets' or 'data reconciliation takes 10 hours'
- Every scenario must be immediately recognizable as enterprise-level
- Quiz questions test APPLICATION and JUDGMENT, not recall of frameworks
- The open-ended prompt must be a scenario a Strategic AE would actually face
- Use the KIs as source material but synthesize — do not copy verbatim`;

    const userPrompt = `Generate a lesson for:

Title: ${lesson.title}
Topic: ${topic}
Difficulty: ${lesson.difficulty_level}
Course: ${(lesson as any).learning_modules?.learning_courses?.title || 'Unknown'}
Module: ${(lesson as any).learning_modules?.title || 'Unknown'}

Knowledge Items to draw from:

${kiContext}`;

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      await adminClient
        .from("learning_lessons")
        .update({ generation_status: "failed" })
        .eq("id", lessonId);
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
      });
    } catch (fetchErr) {
      console.error("AI fetch network error:", fetchErr);
      await adminClient
        .from("learning_lessons")
        .update({ generation_status: "failed" })
        .eq("id", lessonId);
      return new Response(JSON.stringify({ error: "AI service unreachable", detail: String(fetchErr) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI call failed:", aiResponse.status, errText);
      await adminClient
        .from("learning_lessons")
        .update({ generation_status: "failed" })
        .eq("id", lessonId);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.choices?.[0]?.message?.content;
    if (!content) {
      await adminClient
        .from("learning_lessons")
        .update({ generation_status: "failed" })
        .eq("id", lessonId);
      return new Response(JSON.stringify({ error: "Empty AI response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI JSON:", content.substring(0, 500));
      await adminClient
        .from("learning_lessons")
        .update({ generation_status: "failed" })
        .eq("id", lessonId);
      return new Response(JSON.stringify({ error: "Invalid AI JSON" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Store result ──
    const { error: updateErr } = await adminClient
      .from("learning_lessons")
      .update({
        lesson_content: parsed.lesson_content,
        quiz_content: parsed.quiz_content,
        source_ki_ids: sourceKiIds,
        generation_status: "complete",
        generated_at: new Date().toISOString(),
        generation_model: "google/gemini-2.5-flash",
      })
      .eq("id", lessonId);

    if (updateErr) {
      console.error("Update failed:", updateErr);
      return new Response(JSON.stringify({ error: "Failed to save lesson" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ status: "complete", lessonId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
