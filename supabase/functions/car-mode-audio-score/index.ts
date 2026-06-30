// Car Mode AUDIO scorer — transcribes the rep's spoken answer AND grades it
// in a single Gemini call via the Lovable AI Gateway (no extra API key).
//
// Input:  { audioBase64, mimeType, scenario, spokenTask, modelAnswer, rubric, responseShape? }
// Output: { transcript, score, passed, criteria, top_fix, elite_line, summary }
//
// Uses Gemini's native audio understanding through the gateway's
// /v1/chat/completions endpoint with an `input_audio` content block.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RubricItem { c: string; must?: boolean }
interface Body {
  audioBase64: string;
  mimeType: string;
  scenario: string;
  spokenTask: string;
  modelAnswer: string;
  rubric: RubricItem[];
  responseShape?: "quick_reply" | "talk_track";
}

// Map browser MIME → format string accepted by the gateway's input_audio block.
function audioFormatFromMime(mime: string): string {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("flac")) return "flac";
  return "webm";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    if (!body.audioBase64 || body.audioBase64.length < 200) {
      return new Response(JSON.stringify({ error: "empty audio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rubric = Array.isArray(body.rubric) ? body.rubric : [];
    const rubricList = rubric.map((r, i) => `${i + 1}. ${r.c}${r.must ? " (REQUIRED)" : ""}`).join("\n");
    const fmt = audioFormatFromMime(body.mimeType);

    const sys = `You are an elite enterprise sales coach. The salesperson recorded a SPOKEN answer to a practice drill while driving. You will (1) transcribe their audio verbatim and (2) grade the response. Grade fairly — allow filler and natural delivery. Reward substance over polish. Be terse.`;
    const userText = `SCENARIO:\n${body.scenario}\n\nTASK SPOKEN TO REP:\n${body.spokenTask}\n\nEXPECTED SHAPE: ${body.responseShape ?? "talk_track"}\n\nELITE MODEL ANSWER:\n${body.modelAnswer}\n\nRUBRIC CRITERIA:\n${rubricList || "(no rubric — judge against model answer)"}\n\nThe rep's recorded answer is attached as audio. Transcribe it exactly as spoken, then grade.

Return JSON only with this exact shape:
{
  "transcript": "<verbatim transcription of the audio>",
  "score": <0-100 integer>,
  "criteria": [{"c": "<criterion text>", "met": true|false}],
  "top_fix": "<one short sentence — the single most important thing to improve>",
  "elite_line": "<one short sentence echoing what elite sounded like, derived from the model answer>",
  "summary": "<2 sentences max of feedback for the rep>"
}
Required criteria (marked REQUIRED) must be met = true for the rep to pass. If a required criterion is missed, the top_fix MUST be about that. If the audio is silent or unintelligible, return score 0 and top_fix "We couldn't hear your answer — try again."`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "input_audio", input_audio: { data: body.audioBase64, format: fmt } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `gateway ${res.status}`, detail: text.slice(0, 800) }),
        {
          status: res.status === 429 || res.status === 402 ? res.status : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const j = await res.json();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}"); } catch { parsed = {}; }

    const transcript = String(parsed.transcript ?? "").trim();
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))));
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : rubric.map((r) => ({ c: r.c, met: false }));
    const requiredOk = rubric.every((r, i) => {
      if (!r.must) return true;
      const match = (criteria as Array<{ c?: string; met?: boolean }>)[i];
      return match?.met === true;
    });
    const passed = requiredOk && score >= 70 && transcript.length > 0;

    return new Response(
      JSON.stringify({
        transcript,
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
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
