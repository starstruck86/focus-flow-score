import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
    const { data: kis } = await adminClient
      .from("knowledge_items")
      .select("id, title, tactic_summary, why_it_matters, when_to_use, when_not_to_use, example_usage, framework, chapter, sub_chapter")
      .eq("chapter", topic)
      .eq("active", true)
      .order("confidence_score", { ascending: false })
      .limit(25);

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
    const systemPrompt = `You are an elite sales coach building a training lesson. You write concisely, practically, and with high standards. No fluff. Every sentence must teach something actionable.

You will receive a lesson title, topic, difficulty level, and a set of Knowledge Items (KIs) extracted from real sales training content. Use them as your source material.

Return a JSON object with exactly this structure:
{
  "lesson_content": {
    "concept": "2-3 paragraph explanation of the core concept. Clear, direct, practical.",
    "what_good_looks_like": "A specific example from the KIs showing this concept done well. Include the exact words a rep would say.",
    "breakdown": "Why the example works — break down the mechanics. What specifically makes it effective.",
    "when_to_use": "Specific scenarios where this applies. Be concrete, not generic.",
    "when_not_to_use": "When this approach backfires or is wrong. Be honest about limitations."
  },
  "quiz_content": {
    "mc_questions": [
      {
        "id": "q1",
        "question": "A scenario-based question testing APPLICATION of the concept, not recall.",
        "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
        "correct_answer": "B",
        "explanation": "Why B is correct and why the others fall short."
      },
      {
        "id": "q2",
        "question": "Another application question from a different angle.",
        "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
        "correct_answer": "C",
        "explanation": "Why C is correct."
      }
    ],
    "open_ended_prompt": "A realistic sales scenario where the user must apply the concept. E.g. 'Your prospect just said X. Write your response using the technique from this lesson.'",
    "rubric": "What a strong answer includes: [criteria]. What a weak answer looks like: [anti-patterns]. Grade on: application of concept, specificity, tone."
  }
}

Rules:
- Quiz questions must test APPLICATION, not recall
- The open-ended prompt must be a realistic scenario
- Use the KIs as source material but synthesize — don't just copy
- Match the difficulty level in complexity
- Be specific. Use exact phrases a rep would say.`;

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
