// Car Mode scorer — grades spoken response vs model answer + rubric using Lovable AI Gateway.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RubricItem { c: string; must?: boolean }
interface Body {
  transcript: string;
  scenario: string;
  spokenTask: string;
  modelAnswer: string;
  rubric: RubricItem[];
  responseShape?: "quick_reply" | "talk_track";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    const transcript = (body.transcript ?? "").trim();
    if (!transcript) {
      return new Response(JSON.stringify({ error: "empty transcript" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const rubric = Array.isArray(body.rubric) ? body.rubric : [];
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rubricList = rubric.map((r, i) => `${i + 1}. ${r.c}${r.must ? " (REQUIRED)" : ""}`).join("\n");
    const sys = `You are an elite enterprise sales coach grading a salesperson's SPOKEN response during a hands-free practice rep. Grade fairly — they're speaking, not writing, so allow filler and natural delivery. Reward substance over polish. Be terse.`;
    const user = `SCENARIO:\n${body.scenario}\n\nTASK SPOKEN TO REP:\n${body.spokenTask}\n\nEXPECTED SHAPE: ${body.responseShape ?? "talk_track"}\n\nELITE MODEL ANSWER:\n${body.modelAnswer}\n\nRUBRIC CRITERIA:\n${rubricList || "(no rubric — judge against model answer)"}\n\nREP'S SPOKEN RESPONSE (auto-transcribed, may have errors):\n"""${transcript}"""\n\nReturn JSON only with this exact shape:
{
  "score": <0-100 integer>,
  "criteria": [{"c": "<criterion text>", "met": true|false}],
  "top_fix": "<one short sentence — the single most important thing to improve>",
  "elite_line": "<one short sentence echoing what elite sounded like, derived from the model answer>",
  "summary": "<2 sentences max of feedback for the rep>"
}
Required criteria (marked REQUIRED) must be met = true for the rep to pass. If a required criterion is missed, the top_fix MUST be about that.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return new Response(JSON.stringify({ error: `gateway ${res.status}`, detail: text.slice(0, 500) }), { status: res.status === 429 || res.status === 402 ? res.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const j = await res.json();
    const rawContent: string = j.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(rawContent || "{}"); } catch { parsed = null; }
    // Hardening (post-forensics): silent parse-fallback used to fabricate score:0
    // + all-criteria-false verdicts on gateway hiccups, corrupting mastery data.
    // Surface parse failure and missing/NaN score as a 502 so the caller can retry.
    const rawScoreNum = Number((parsed as Record<string, unknown> | null)?.score);
    if (!parsed || !Number.isFinite(rawScoreNum)) {
      return new Response(
        JSON.stringify({ error: "grader_parse_failed", raw: rawContent.slice(0, 200) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const score = Math.max(0, Math.min(100, Math.round(rawScoreNum)));
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : rubric.map((r) => ({ c: r.c, met: false }));
    // pass = all REQUIRED criteria met AND score >= 85 (§7.33 unified pass bar)
    const requiredOk = rubric.every((r, i) => {
      if (!r.must) return true;
      const match = (criteria as Array<{ c?: string; met?: boolean }>)[i];
      return match?.met === true;
    });
    const passed = requiredOk && score >= 85;

    return new Response(
      JSON.stringify({
        score,
        passed,
        criteria,
        top_fix: String(parsed.top_fix ?? "Tighten your response and lead with the buyer's outcome."),
        elite_line: String(parsed.elite_line ?? (body.modelAnswer ?? "").split(/[.!?]/)[0]?.trim() ?? ""),
        summary: String(parsed.summary ?? ""),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
