import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { objection, category, context, difficulty, response } = await req.json();
    if (!objection || !response) {
      return new Response(JSON.stringify({ error: "Missing objection or response" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an elite sales coach grading an objection handle. Grade BRUTALLY HONESTLY — most reps are C-level.

GRADING CRITERIA:
1. ACKNOWLEDGE: Did they validate the buyer's concern without being dismissive? (10pts)
2. ISOLATE: Did they ask a clarifying question or isolate the real issue? (15pts)
3. REFRAME: Did they shift the conversation from cost/feature to value/impact? (25pts)
4. EVIDENCE: Did they use proof points, data, or relevant examples? (15pts)
5. ADVANCE: Did they maintain control and move toward a next step? (15pts)
6. TONE: Was it conversational, not robotic or scripted? (10pts)
7. CONCISENESS: Was it tight, not rambling? (10pts)

GRADE SCALE:
A+ (95-100): Elite — world-class handle, could train others
A  (88-94): Excellent — strong across all dimensions
B+ (82-87): Good — solid handle with minor gaps
B  (75-81): Above average — handles it but misses opportunities
C+ (68-74): Average — gets through it but predictable
C  (60-67): Below average — mechanical, misses the real issue
D  (45-59): Poor — falls into common traps
F  (<45): Failed — made it worse

Default to C unless they genuinely impressed you. An A requires something special.

CONTEXT:
- Objection category: ${category}
- Buyer context: ${context}
- Difficulty: ${difficulty}/3

Respond with ONLY valid JSON:
{
  "grade": "C+",
  "score": 68,
  "feedback": "One sentence summary of what they did and missed",
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2"],
  "betterResponse": "The exact words an A+ rep would say in this situation — specific, natural, powerful",
  "framework": "Name the framework this maps to (e.g., 'Feel-Felt-Found', 'Isolate & Reframe', 'Cost of Inaction')"
}`;

    const aiResp = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `BUYER'S OBJECTION:\n"${objection}"\n\nREP'S RESPONSE:\n"${response}"` },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      throw new Error(`AI request failed: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    
    // Strip markdown code fences if present
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    const parsed = JSON.parse(content);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("grade-objection-drill error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
