import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userResponse, prompt, rubric, lessonTitle, concept, lessonId } = await req.json();

    if (!userResponse?.trim()) {
      return new Response(JSON.stringify({ error: "userResponse required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an elite sales coach grading a trainee's response. Be direct, specific, and constructive. No fluff.

Return a JSON object:
{
  "score": <0-100>,
  "feedback": "<3-5 sentences: what was good, what was weak, and a better version of their response>"
}

Scoring guide:
- 90-100: Elite. Specific, uses the right technique, would work in a real call.
- 70-89: Good foundation but missing specificity or key elements.
- 50-69: Shows understanding but wouldn't land in a real conversation.
- Below 50: Missed the concept or gave a generic response.

Always include a "Better version:" section showing what an elite rep would say.`;

    const userPrompt = `Lesson: ${lessonTitle || 'Unknown'}
Concept: ${concept || 'N/A'}
Prompt given to trainee: ${prompt || 'N/A'}
Rubric: ${rubric || 'N/A'}

Trainee's response:
"${userResponse}"

Grade this response.`;

    const aiResponse = await fetch("https://ai.lovable.dev/api/v1/chat/completions", {
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
        temperature: 0.5,
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI grading failed:", aiResponse.status);
      return new Response(JSON.stringify({ error: "Grading failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await aiResponse.json();
    const content = result.choices?.[0]?.message?.content;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse grading JSON");
      return new Response(JSON.stringify({ error: "Invalid grading response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const score: number = typeof parsed.score === 'number' ? parsed.score : 50;
    const feedback: string = parsed.feedback ?? "Unable to grade response.";

    // Persist progress (mastery gate). Requires lessonId + authenticated user.
    if (lessonId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData } = await userClient.auth.getUser();
        const userId = userData?.user?.id;

        if (userId) {
          const adminClient = createClient(supabaseUrl, serviceKey);

          const { data: existing } = await adminClient
            .from('user_lesson_progress')
            .select('best_score, attempts')
            .eq('user_id', userId)
            .eq('lesson_id', lessonId)
            .maybeSingle();

          const existingBestScore = existing?.best_score ?? 0;
          const existingAttempts = existing?.attempts ?? 0;
          const nowIso = new Date().toISOString();
          const passed = score >= 65;

          await adminClient.from('user_lesson_progress').upsert({
            user_id: userId,
            lesson_id: lessonId,
            status: passed ? 'passed' : 'in_progress',
            mastery_score: score,
            best_score: Math.max(score, existingBestScore),
            attempts: existingAttempts + 1,
            last_attempt_at: nowIso,
            passed_at: passed ? nowIso : null,
            updated_at: nowIso,
          }, { onConflict: 'user_id,lesson_id' });
        }
      } catch (e) {
        console.error("progress upsert failed:", e);
      }
    }

    return new Response(JSON.stringify({ score, feedback, passed: score >= 65 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
