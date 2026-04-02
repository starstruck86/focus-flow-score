/**
 * preprocess-transcript
 * ---------------------
 * Takes raw podcast transcript text and produces structured markdown
 * with topical section headings, cleaned paragraphs, and speaker turns.
 * This makes transcripts suitable for KI extraction by extract-tactics.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a transcript editor. Your job is to take raw, unstructured podcast/interview transcripts and produce a clean, structured document optimized for knowledge extraction.

Rules:
1. SEGMENT the transcript into topical sections. Each section gets a descriptive ## heading that captures the key topic discussed.
2. STRIP filler words and verbal tics: "um", "uh", "you know", "like" (when used as filler), "right?", "I mean", "sort of", "kind of" (when meaningless). Keep them ONLY if they carry meaning.
3. IDENTIFY speakers using conversation patterns. Label them as **Host:** and **Guest:** (or by name if mentioned). If you cannot distinguish speakers, use **Speaker:** for all.
4. CLEAN run-on sentences into proper paragraphs. Preserve the speaker's actual words and meaning — do NOT paraphrase or summarize. Fix grammar only where the meaning would otherwise be unclear.
5. PRESERVE all substantive content: specific examples, numbers, frameworks, stories, advice, techniques, and actionable insights. Do NOT omit or summarize these.
6. FORMAT as markdown with:
   - ## Section Heading (one per topical segment)
   - Speaker labels in bold at the start of each turn
   - Clean paragraphs within each section
   - > blockquote for particularly memorable or quotable statements
7. OUTPUT only the structured markdown. No preamble, no meta-commentary, no "Here is the structured transcript" intro.

The output will be fed into a knowledge extraction system that looks for tactical, actionable insights with source_excerpt quotes and source_location headings. Your section headings become the source_location. Your cleaned quotes become source_excerpts. Quality matters enormously.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, episode_title, episode_guest, show_name } = await req.json();

    if (!transcript || transcript.length < 100) {
      return new Response(
        JSON.stringify({ error: "Transcript too short or missing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context-aware user prompt
    const contextParts: string[] = [];
    if (episode_title) contextParts.push(`Episode: "${episode_title}"`);
    if (episode_guest) contextParts.push(`Guest: ${episode_guest}`);
    if (show_name) contextParts.push(`Show: ${show_name}`);
    const contextLine = contextParts.length > 0
      ? `Context: ${contextParts.join(" | ")}\n\n`
      : "";

    // For very long transcripts, process in chunks then combine
    const MAX_CHUNK = 50000; // ~50K chars per AI call
    let structuredOutput: string;

    if (transcript.length <= MAX_CHUNK) {
      structuredOutput = await processChunk(
        LOVABLE_API_KEY,
        `${contextLine}Raw transcript:\n\n${transcript}`
      );
    } else {
      // Split into overlapping chunks at paragraph boundaries
      const chunks = splitTranscript(transcript, MAX_CHUNK, 2000);
      const processedChunks: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkContext = `${contextLine}This is part ${i + 1} of ${chunks.length} of a longer transcript.\n\nRaw transcript (part ${i + 1}):\n\n${chunks[i]}`;
        const result = await processChunk(LOVABLE_API_KEY, chunkContext);
        processedChunks.push(result);
      }

      // Combine chunks, dedup any overlapping section headings
      structuredOutput = mergeChunks(processedChunks);
    }

    // Validate output quality
    const validation = validateStructuredOutput(structuredOutput, transcript);

    return new Response(
      JSON.stringify({
        structured_transcript: structuredOutput,
        original_length: transcript.length,
        structured_length: structuredOutput.length,
        section_count: (structuredOutput.match(/^## /gm) || []).length,
        validation,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("preprocess-transcript error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processChunk(apiKey: string, userContent: string): Promise<string> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI gateway error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  if (finishReason === "length" || finishReason === "MAX_TOKENS") {
    console.warn(`[preprocess-transcript] Output truncated (finish_reason: ${finishReason}). Content length: ${(choice?.message?.content || "").length}`);
  }
  return choice?.message?.content || "";
}

function splitTranscript(text: string, maxChunk: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChunk, text.length);

    // Try to split at a paragraph boundary
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      if (lastParagraph > start + maxChunk * 0.7) {
        end = lastParagraph;
      } else {
        const lastNewline = text.lastIndexOf("\n", end);
        if (lastNewline > start + maxChunk * 0.7) {
          end = lastNewline;
        }
      }
    }

    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

function mergeChunks(chunks: string[]): string {
  if (chunks.length === 1) return chunks[0];

  // Simple merge: concatenate with a separator, relying on section headings
  // to provide natural structure
  return chunks.join("\n\n---\n\n");
}

function validateStructuredOutput(
  structured: string,
  original: string
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Must have at least some section headings
  const headingCount = (structured.match(/^## /gm) || []).length;
  if (headingCount < 2) {
    issues.push("Too few section headings (expected at least 2)");
  }

  // Should retain substantial content (at least 30% of original length)
  if (structured.length < original.length * 0.2) {
    issues.push("Structured output suspiciously short vs original");
  }

  // Should not contain excessive HTML
  const htmlTags = (structured.match(/<[a-z][^>]*>/gi) || []).length;
  if (htmlTags > 3) {
    issues.push("Contains HTML tags");
  }

  return { valid: issues.length === 0, issues };
}
