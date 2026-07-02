// Car Mode AUDIO scorer — ElevenLabs Scribe (STT) + Gemini Flash (grader).
//
// Pipeline:
//   Step A (TRANSCRIBE): ElevenLabs Scribe v2 speech-to-text on the raw audio,
//     using ONLY the audio (no scenario / task / model answer / rubric). This
//     prevents the transcriber from confabulating the model answer on silence.
//   Silence / hallucination gate: word-count AND cumulative speech-duration
//     computed from Scribe's per-word timestamps, PLUS a phrase blacklist for
//     the classic phantom outputs ("thank you", "you", etc.).
//   Step B (GRADE): only when the gate passes, Gemini Flash grades the real
//     transcript against the model answer + rubric.
//
// Input:  { audioBase64, mimeType, scenario, spokenTask, modelAnswer, rubric, responseShape? }
// Output: { has_clear_speech, transcript, score, passed, criteria, top_fix, elite_line, summary }
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

// ── Silence / hallucination gate thresholds ──────────────────────────
const MIN_REAL_WORDS = 3;          // fewer than this → treat as no answer
const MIN_SPEECH_DURATION_MS = 700; // cumulative word-span duration
const GATEWAY_TIMEOUT_MS = 30_000;

function extFromMime(mime: string): string {
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
  has_clear_speech: false,
  transcript: "",
  score: 0,
  passed: false,
  top_fix: "No answer detected — try again.",
  elite_line: "",
  summary: "We didn't hear a spoken answer. Try again.",
};

function looksLikePhantom(tx: string): boolean {
  const t = (tx || "").trim();
  if (!t) return true;
  const normalized = t.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
  const compact = normalized.replace(/[\s.,!?]+/g, "");
  const hallucinations = new Set([
    "thank you", "thank you.", "thank you for watching",
    "thanks for watching", "thanks", "bye", "you", "okay", "ok",
    "so", "please subscribe", "subscribe", ".",
  ]);
  if (hallucinations.has(normalized) || hallucinations.has(t.toLowerCase()) || compact === "") return true;
  if (["thankyou", "thankyouforwatching", "thanksforwatching", "pleasesubscribe", "subscribe"].includes(compact)) return true;
  const fillerOnly = /^(uh+|um+|hmm+|mm+|ah+|er+|oh+|yeah|ok|okay)([\s.,!?]+(uh+|um+|hmm+|mm+|ah+|er+|oh+|yeah|ok|okay))*[\s.,!?]*$/i;
  if (fillerOnly.test(t)) return true;
  return false;
}

interface ScribeWord { text: string; start?: number; end?: number; type?: string }
interface ScribeResponse { text?: string; language_code?: string; words?: ScribeWord[] }

/**
 * Word-count AND cumulative speech-duration gate over Scribe's words[].
 * A phantom transcript like "thank you" fails min-words (2 < 3) AND
 * min-duration (word spans typically <500ms), so both gates must pass
 * before we treat the audio as a real answer.
 */
function passesSpeechGate(scribe: ScribeResponse): boolean {
  const words = Array.isArray(scribe.words) ? scribe.words : [];
  const real = words.filter((w) => (w.type ?? "word") === "word" && /\p{L}/u.test(w.text ?? ""));
  if (real.length < MIN_REAL_WORDS) return false;
  let totalSec = 0;
  for (const w of real) {
    const s = typeof w.start === "number" ? w.start : 0;
    const e = typeof w.end === "number" ? w.end : s;
    if (e > s) totalSec += (e - s);
  }
  if (totalSec * 1000 < MIN_SPEECH_DURATION_MS) return false;
  return true;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error(`${label} timed out after ${GATEWAY_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
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
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const elKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!elKey) {
      return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rubric = Array.isArray(body.rubric) ? body.rubric : [];
    const ext = extFromMime(body.mimeType);

    // ── STEP A: TRANSCRIBE via ElevenLabs Scribe v2 ──────────────────
    const audioBytes = base64ToBytes(body.audioBase64);
    const fd = new FormData();
    fd.append("file", new File([audioBytes], `audio.${ext}`, { type: body.mimeType || `audio/${ext}` }));
    fd.append("model_id", "scribe_v2");
    fd.append("language_code", "eng");

    let txRes: Response;
    try {
      txRes = await fetchWithTimeout("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": elKey },
        body: fd,
      }, "elevenlabs-stt");
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "transcription timed out", detail: String((e as Error).message ?? e) }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!txRes.ok) {
      const detail = await txRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `elevenlabs-stt ${txRes.status}`, detail: detail.slice(0, 800) }),
        { status: txRes.status === 429 || txRes.status === 402 || txRes.status === 401 ? txRes.status : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const scribe = (await txRes.json()) as ScribeResponse;
    const transcript = String(scribe.text ?? "").trim();

    // ── Silence / hallucination gate ─────────────────────────────────
    // Words[] duration + count gate FIRST (catches phantom "thank you" clips
    // with just 2 tokens and <500ms duration), then blacklist for the rare
    // case a phantom still slips through.
    if (!transcript || !passesSpeechGate(scribe) || looksLikePhantom(transcript)) {
      return new Response(
        JSON.stringify({ ...NO_ANSWER, criteria: rubric.map((r) => ({ c: r.c, met: false })) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── STEP B: GRADE the real transcript ────────────────────────────
    const rubricList = rubric.map((r, i) => `${i + 1}. ${r.c}${r.must ? " (REQUIRED)" : ""}`).join("\n");
    const gradeSys = "You are an elite enterprise sales coach grading a salesperson's SPOKEN response. Grade ONLY what is in the transcript — never invent or assume what the rep said. If the transcript is empty, fragmentary, generic, unrelated, or does not clearly address the task, return score 0 and say no answer was detected. Allow filler and natural delivery; reward substance over polish. Be terse.";
    const gradeUser = `SCENARIO:\n${body.scenario}\n\nTASK SPOKEN TO REP:\n${body.spokenTask}\n\nEXPECTED SHAPE: ${body.responseShape ?? "talk_track"}\n\nELITE MODEL ANSWER:\n${body.modelAnswer}\n\nRUBRIC CRITERIA:\n${rubricList || "(no rubric — judge against model answer)"}\n\nREP'S ACTUAL SPOKEN RESPONSE (verbatim transcript — grade ONLY this, nothing else):\n"""${transcript}"""\n\nReturn JSON only:
{
  "score": <0-100 integer>,
  "criteria": [{"c": "<criterion text>", "met": true|false}],
  "top_fix": "<one short sentence>",
  "elite_line": "<one short sentence echoing the model answer>",
  "summary": "<2 sentences max>"
}
Required criteria must be met=true to pass. If a required criterion is missed, top_fix MUST address it.`;

    let grRes: Response;
    try {
      grRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: gradeSys },
            { role: "user", content: gradeUser },
          ],
          response_format: { type: "json_object" },
        }),
      }, "grading");
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "grading timed out", detail: String((e as Error).message ?? e) }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
    const passed = requiredOk && score >= 85;

    return new Response(
      JSON.stringify({
        has_clear_speech: true,
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
