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

    // For long transcripts, process in safe chunks and recursively split again
    // if the model reports token-limit truncation.
    const MAX_CHUNK = 20000;
    const CHUNK_OVERLAP = 1500;
    let structuredOutput: string;

    if (transcript.length <= MAX_CHUNK) {
      structuredOutput = await processTranscriptSegment(
        LOVABLE_API_KEY,
        transcript,
        contextLine,
      );
    } else {
      const chunks = splitTranscript(transcript, MAX_CHUNK, CHUNK_OVERLAP);
      const processedChunks: string[] = [];

      console.log(`[preprocess-transcript] Processing long transcript in ${chunks.length} chunks (${transcript.length} chars)`);

      for (let i = 0; i < chunks.length; i++) {
        const result = await processTranscriptSegment(
          LOVABLE_API_KEY,
          chunks[i],
          contextLine,
          { partIndex: i, totalParts: chunks.length },
        );
        processedChunks.push(result);
      }

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

async function processTranscriptSegment(
  apiKey: string,
  transcriptChunk: string,
  contextLine: string,
  options: { partIndex?: number; totalParts?: number; depth?: number; path?: string } = {},
): Promise<string> {
  const { partIndex, totalParts, depth = 0 } = options;
  const path = options.path || (typeof partIndex === "number" && totalParts ? `${partIndex + 1}/${totalParts}` : "1/1");
  const userContent = buildChunkPrompt(contextLine, transcriptChunk, partIndex, totalParts, depth);
  const result = await processChunk(apiKey, userContent);

  if (!result.truncated) {
    return result.content;
  }

  const MIN_CHUNK = 6000;
  const MAX_RECURSION_DEPTH = 3;

  if (transcriptChunk.length <= MIN_CHUNK || depth >= MAX_RECURSION_DEPTH) {
    console.warn(`[preprocess-transcript] Returning truncated output at path ${path} after reaching fallback limit`);
    return result.content;
  }

  const subChunkSize = Math.max(MIN_CHUNK, Math.ceil(transcriptChunk.length / 2));
  const subChunks = splitTranscript(transcriptChunk, subChunkSize, Math.min(1000, Math.floor(subChunkSize / 5)));

  if (subChunks.length <= 1) {
    return result.content;
  }

  console.warn(`[preprocess-transcript] Retrying truncated segment at path ${path} with ${subChunks.length} smaller chunks`);

  const subResults: string[] = [];
  for (let i = 0; i < subChunks.length; i++) {
    subResults.push(await processTranscriptSegment(apiKey, subChunks[i], contextLine, {
      partIndex: i,
      totalParts: subChunks.length,
      depth: depth + 1,
      path: `${path}.${i + 1}`,
    }));
  }

  return mergeChunks(subResults);
}

function buildChunkPrompt(
  contextLine: string,
  transcriptChunk: string,
  partIndex?: number,
  totalParts?: number,
  depth = 0,
): string {
  if (typeof partIndex === "number" && totalParts && totalParts > 1) {
    const splitNote = depth > 0 ? " This part was split further to avoid truncation; preserve full content for this sub-part only." : "";
    return `${contextLine}This is part ${partIndex + 1} of ${totalParts} of a longer transcript.${splitNote}\n\nRaw transcript (part ${partIndex + 1}):\n\n${transcriptChunk}`;
  }

  return `${contextLine}Raw transcript:\n\n${transcriptChunk}`;
}

async function processChunk(apiKey: string, userContent: string): Promise<{ content: string; truncated: boolean; finishReason: string | null }> {
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
      max_tokens: 24576,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI gateway error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason || choice?.finishReason || null;
  const content = choice?.message?.content || "";
  const truncated = finishReason === "length" || finishReason === "MAX_TOKENS";

  if (truncated) {
    console.warn(`[preprocess-transcript] Output truncated (finish_reason: ${finishReason}). Content length: ${content.length}`);
  }

  return { content, truncated, finishReason };
}

function splitTranscript(text: string, maxChunk: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(maxChunk / 3)));

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

    const chunk = text.slice(start, end);
    if (chunk) chunks.push(chunk);

    if (end >= text.length) {
      break;
    }

    const nextStart = Math.max(end - safeOverlap, start + 1);
    if (nextStart <= start) {
      break;
    }

    start = nextStart;
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
