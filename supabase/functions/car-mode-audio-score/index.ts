// Car Mode AUDIO scorer — two-pass pipeline:
//   Step A (TRANSCRIBE-ONLY): send audio + a transcription-only prompt (no
//     scenario / task / model answer / rubric). This prevents Gemini from
//     confabulating a "transcript" from the model answer when audio is silent.
//   Step B (GRADE): only when Step A returns a non-empty real transcript, grade
//     it against the model answer + rubric.
//
// Input:  { audioBase64, mimeType, scenario, spokenTask, modelAnswer, rubric, responseShape? }
// Output: { transcript, score, passed, criteria, top_fix, elite_line, summary }
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

const NO_ANSWER = {
  transcript: "",
  score: 0,
  passed: false,
  top_fix: "No answer detected — try again.",
  elite_line: "",
  summary: "We didn't hear a spoken answer. Try again.",
};

function looksLikeNoAnswer(tx: string): boolean {
  const t = (tx || "").trim();
  if (!t) return true;
  // Strip punctuation, count word tokens with letters
  const words = t.replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < 2) return true;
  // Common transcription fillers when there's nothing to say
  const fillerOnly = /^(uh+|um+|hmm+|mm+|ah+|er+|oh+|yeah|ok|okay)([\s.,!?]+(uh+|um+|hmm+|mm+|ah+|er+|oh+|yeah|ok|okay))*[\s.,!?]*$/i;
  if (fillerOnly.test(t)) return true;
  return false;
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
    const fmt = audioFormatFromMime(body.mimeType);

    // ── STEP A: TRANSCRIBE ONLY ──────────────────────────────────────
    // CRITICAL: do NOT include scenario/task/modelAnswer/rubric here.
    const transcribeSys = "You are a strict speech transcriber. Transcribe ONLY what is actually spoken in the audio, verbatim. If there is no clear human speech (silence, breathing, noise, music, or nothing audible), return an empty string for transcript. NEVER invent, infer, paraphrase, complete, or guess content. NEVER add words that were not spoken.";
    const transcribeUser = "Transcribe the speech in this audio. Return JSON: {\"transcript\": \"<verbatim words or empty string>\"}";

    const txRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: transcribeSys },
          {
            role: "user",
            content: [
              { type: "text", text: transcribeUser },
              { type: "input_audio", input_audio: { data: body.audioBase64, format: fmt } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!txRes.ok) {
      const text = await txRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `gateway ${txRes.status}`, detail: text.slice(0, 800) }),
        { status: txRes.status === 429 || txRes.status === 402 ? txRes.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const txJson = await txRes.json();
    let txParsed: Record<string, unknown> = {};
    try { txParsed = JSON.parse(txJson.choices?.[0]?.message?.content ?? "{}"); } catch { txParsed = {}; }
    const transcript = String(txParsed.transcript ?? "").trim();

    // ── Empty / no-answer guard ──────────────────────────────────────
    if (looksLikeNoAnswer(transcript)) {
      return new Response(
        JSON.stringify({ ...NO_ANSWER, transcript: "", criteria: rubric.map((r) => ({ c: r.c, met: false })) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── STEP B: GRADE the real transcript ────────────────────────────
    const rubricList = rubric.map((r, i) => `${i + 1}. ${r.c}${r.must ? " (REQUIRED)" : ""}`).join("\n");
    const gradeSys = "You are an elite enterprise sales coach grading a salesperson's SPOKEN response. Grade ONLY what is in the transcript — never invent or assume what the rep said. If the transcript is empty, fragmentary, or does not actually address the task, return score 0 and say no answer was detected. Allow filler and natural delivery; reward substance over polish. Be terse.";
    const gradeUser = `SCENARIO:\n${body.scenario}\n\nTASK SPOKEN TO REP:\n${body.spokenTask}\n\nEXPECTED SHAPE: ${body.responseShape ?? "talk_track"}\n\nELITE MODEL ANSWER:\n${body.modelAnswer}\n\nRUBRIC CRITERIA:\n${rubricList || "(no rubric — judge against model answer)"}\n\nREP'S ACTUAL SPOKEN RESPONSE (verbatim transcript — grade ONLY this, nothing else):\n"""${transcript}"""\n\nReturn JSON only:
{
  "score": <0-100 integer>,
  "criteria": [{"c": "<criterion text>", "met": true|false}],
  "top_fix": "<one short sentence>",
  "elite_line": "<one short sentence echoing the model answer>",
  "summary": "<2 sentences max>"
}
Required criteria must be met=true to pass. If a required criterion is missed, top_fix MUST address it.`;

    const grRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: gradeSys },
          { role: "user", content: gradeUser },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!grRes.ok) {
      const text = await grRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `gateway ${grRes.status}`, detail: text.slice(0, 800) }),
        { status: grRes.status === 429 || grRes.status === 402 ? grRes.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const grJson = await grRes.json();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(grJson.choices?.[0]?.message?.content ?? "{}"); } catch { parsed = {}; }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))));
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : rubric.map((r) => ({ c: r.c, met: false }));
    const requiredOk = rubric.every((r, i) => {
      if (!r.must) return true;
      const match = (criteria as Array<{ c?: string; met?: boolean }>)[i];
      return match?.met === true;
    });
    const passed = requiredOk && score >= 70;

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
