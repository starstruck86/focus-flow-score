import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

const BASE_SYSTEM_PROMPT = `You are an elite sales execution coach. Extract TACTICAL PLAYS from content.

A Knowledge Item is a PLAY — a structured, situational, reusable tactical entry that tells a rep exactly when, why, and how to execute. Every play must be FULLY ATTRIBUTED to its source.

EVERY knowledge item MUST include ALL of these fields:

1. "title" — verb-led action title (e.g. "Reframe the budget objection using cost-of-inaction")
2. "framework" — methodology (GAP Selling, Challenger Sale, MEDDPICC, Command of the Message, SPIN Selling, or "General"). REQUIRED — never empty.
3. "who" — thought leader or author (Keenan, Dixon, McMahon, Force Management, Chris Voss, or "Unknown"). REQUIRED — never empty.
4. "source_excerpt" — the EXACT quote or passage from the source content that supports this play. Copy verbatim from the content. Minimum 2 sentences. REQUIRED.
5. "source_location" — where in the content this was found: section heading, paragraph number, or approximate location (e.g. "Section: Discovery Questions", "Opening paragraphs", "Near: 'The key to...'"). REQUIRED.
6. "macro_situation" — WHEN does this play apply? 2-4 sentences describing the big-picture scenario including deal stage, buyer behavior, competitive dynamics.
7. "micro_strategy" — WHAT are you specifically doing? 2-3 sentences on the tactical approach.
8. "why_it_matters" — WHY does this work? 2-3 sentences on the psychology or sales principle.
9. "how_to_execute" — HOW to do it step by step. 3-5 concrete steps with exact phrasing. Must be immediately usable.
10. "what_this_unlocks" — OUTCOME when executed well. 2-3 sentences.
11. "when_to_use" — specific trigger conditions (2-3 sentences, not a single phrase)
12. "when_not_to_use" — boundaries and anti-patterns (2-3 sentences)
13. "example_usage" — a REALISTIC conversational talk track or email snippet. Must sound like a real human. Minimum 3-4 sentences.
14. "tactic_summary" — concise 2-3 sentence summary for quick reference
15. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
16. "knowledge_type" — skill|product|competitive
17. "sub_chapter" — optional sub-category

ATTRIBUTION IS MANDATORY:
- Every play MUST have a non-empty "framework", "who", "source_excerpt", and "source_location"
- "source_excerpt" must be a VERBATIM quote from the content, not a paraphrase
- If you cannot find a clear source passage for a play, DO NOT include it

QUALITY GATES — REJECT any item that:
- Has any field shorter than 2 sentences (except title, chapter, knowledge_type, sub_chapter)
- Is generic advice without specific phrasing
- Contains UI / HTML / CSS artifacts
- Describes what to think rather than what to DO
- Has no clear source attribution
- Could apply to any situation (not situational enough)

Return high-quality tactical plays as a JSON array. Quality over quantity.
Only return the JSON array, no markdown fences.`;

const TRANSCRIPT_ADDENDUM = `

TRANSCRIPT-SPECIFIC INSTRUCTIONS:
You are extracting from a podcast/interview transcript. The guest is sharing hard-won tactical knowledge. Your job is to find the SPECIFIC TECHNIQUES, FRAMEWORKS, and ACTIONABLE METHODS they describe — not summaries of conversation topics.

GOOD plays from transcripts:
- A specific discovery question technique the guest describes with examples
- A concrete negotiation move with exact phrasing they recommend
- A step-by-step framework they walk through in detail

BAD plays from transcripts (REJECT these):
- "The guest discussed the importance of discovery" — this is a topic summary, not a play
- Vague advice like "build rapport with buyers" without specific how-to
- Anything where the source_excerpt is just a speaker transition or filler

For each section of transcript, ask: "Could a sales rep USE this in their next call?" If the answer is vague, skip it.
Extract 4-8 plays from the full transcript. Prioritize DEPTH over breadth — fewer, richer plays.`;

const LESSON_ADDENDUM = `

STRUCTURED LESSON INSTRUCTIONS:
You are extracting from a structured training lesson that includes both written content and a video transcript. This is high-quality, curated educational content — it contains MORE tactical density than a typical podcast.

Extract EVERY distinct tactic, framework, or actionable technique covered in the lesson. This content is deliberately structured to teach multiple concepts. DO NOT under-extract.

Look for:
- Named frameworks or scoring models (e.g. "Use Case and Budget" framework)
- Specific research techniques with concrete steps
- Prioritization criteria with examples
- Signal detection methods (competitor usage, headcount growth, relevant problems)
- Territory management strategies
- Account scoring/tiering approaches
- Rules of thumb or heuristics the instructor shares
- Prioritization tiers, categories, or decision trees
- Research methods or data sources the instructor recommends
- Specific tools, platforms, or workflows mentioned

Each distinct technique, method, signal, or rule is its OWN separate play. If the lesson teaches 12 things, return 12 plays.
Titles may describe the technique naturally — they do NOT need to start with a verb.`;

// ── Lesson Stage-1: Exhaustive enumeration prompt ──
const LESSON_ENUMERATE_SYSTEM = `You are an expert training content analyst. Your job is to create an exhaustive inventory of every distinct teachable concept in a structured lesson.

For each concept, return a JSON object with:
- "candidate_title": a short descriptive title (3-10 words)
- "concept_type": one of "framework", "technique", "rule", "signal", "method", "model", "tool", "heuristic", "tier", "criteria"
- "source_hint": a short quote or paragraph reference from the content (1-2 sentences)
- "section": which part of the lesson this comes from

Be EXHAUSTIVE. Include every distinct:
- Named frameworks or models
- Scoring criteria or prioritization rules  
- Research techniques or data-gathering methods
- Signal detection approaches
- Decision rules or heuristics
- Tools or platform-specific workflows
- Tiering systems or categorization schemes
- Specific metrics or thresholds mentioned

Return ONLY a JSON array. No markdown fences. If the lesson contains 15 concepts, list all 15. Do NOT summarize or merge adjacent concepts.`;

const DOCUMENT_ITEM_TARGET = '2-4';
const TRANSCRIPT_ITEM_TARGET = '4-8';
const LESSON_ITEM_TARGET = '8-20';

const LESSON_TRANSCRIPT_MARKER = '--- Video Transcript ---';

function isStructuredLesson(content: string, title?: string, resourceType?: string): boolean {
  // Method 1: has transcript marker at a reasonable position
  const markerIndex = content.indexOf(LESSON_TRANSCRIPT_MARKER);
  if (markerIndex > 500) return true;
  // Method 2: title matches "Course > Lesson" pattern AND is a video/lesson type with enough content
  const hasCourseTitle = (title || '').includes('>');
  const isVideoType = ['video', 'lesson'].includes((resourceType || '').toLowerCase());
  if (hasCourseTitle && isVideoType && content.length >= 500) return true;
  return false;
}

/** Clean lesson content: trim neighboring lesson titles that pollute the start */
function prepareLessonContent(content: string, title?: string): string {
  if (!title || !title.includes('>')) return content;
  const lessonName = title.split('>').pop()?.trim();
  if (!lessonName || lessonName.length < 3) return content;
  
  // Find where the actual lesson title appears in the content
  const idx = content.toLowerCase().indexOf(lessonName.toLowerCase());
  if (idx > 0 && idx < 2000) {
    // Trim everything before the lesson title (navigation noise from neighboring lessons)
    return content.slice(idx).trim();
  }
  return content;
}

// Chunking config — transcripts use MUCH larger chunks aligned to section headings
const DOC_CHUNK_SIZE = 8000;
const DOC_CHUNK_OVERLAP = 500;
const TRANSCRIPT_CHUNK_SIZE = 25000; // ~15 min of transcript per chunk
const TRANSCRIPT_CHUNK_OVERLAP = 1500;
// No hard cap — quality gates are the only filter. Every validated play is kept.
const DOC_SINGLE_PASS_THRESHOLD = 12000;
const TRANSCRIPT_SINGLE_PASS_THRESHOLD = 30000; // Single-pass for episodes < ~20 min
const MAX_TOKENS = 16384;

function isTranscriptType(resourceType?: string): boolean {
  return ['transcript', 'podcast', 'audio', 'podcast_episode', 'video', 'recording'].includes(
    (resourceType || '').toLowerCase()
  );
}

/** Split transcript content on ## section headings for natural boundaries */
function chunkTranscriptBySections(content: string, maxChunk: number, overlap: number): string[] {
  // Split on markdown section headings
  const sections = content.split(/(?=^## )/m);
  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if (!section.trim()) continue;

    if (current.length + section.length > maxChunk && current.length > 2000) {
      chunks.push(current);
      // Overlap: include the tail of the previous chunk
      const overlapText = current.slice(-overlap);
      current = overlapText + '\n\n' + section;
    } else {
      current += (current ? '\n\n' : '') + section;
    }
  }
  if (current.trim().length > 500) {
    chunks.push(current);
  }

  // If section-based splitting produced only 1 chunk or no sections found, fall back to paragraph splitting
  if (chunks.length <= 1 && content.length > maxChunk) {
    return chunkByParagraphs(content, maxChunk, overlap);
  }

  return chunks.length > 0 ? chunks : [content];
}

/** Fallback paragraph-based chunking for non-sectioned content */
function chunkByParagraphs(content: string, maxChunk: number, overlap: number): string[] {
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20);
  const chunks: string[] = [];
  let current = '';
  let overlapBuffer = '';

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunk && current.length > 0) {
      chunks.push(current);
      overlapBuffer = current.slice(-overlap);
      current = overlapBuffer + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim().length > 200) {
    chunks.push(current);
  }

  return chunks;
}

/** Route to the right chunking strategy */
function chunkContent(content: string, isTranscript: boolean): string[] {
  if (isTranscript) {
    if (content.length <= TRANSCRIPT_SINGLE_PASS_THRESHOLD) return [content];
    return chunkTranscriptBySections(content, TRANSCRIPT_CHUNK_SIZE, TRANSCRIPT_CHUNK_OVERLAP);
  }
  if (content.length <= DOC_SINGLE_PASS_THRESHOLD) return [content];
  return chunkByParagraphs(content, DOC_CHUNK_SIZE, DOC_CHUNK_OVERLAP);
}

async function requestExtraction(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<any> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      const retry = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
      });
      if (!retry.ok) throw new Error(`AI error after retry: ${retry.status}`);
      return retry.json();
    }
    throw new Error(`AI error: ${res.status}`);
  }

  return res.json();
}

function parseAiResponse(result: any): any[] {
  const raw = result?.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return [];
      }
    }
    return [];
  }
}

function isTruncatedResponse(result: any): boolean {
  const finishReason = result?.choices?.[0]?.finish_reason || result?.choices?.[0]?.finishReason || null;
  return finishReason === 'length' || finishReason === 'MAX_TOKENS';
}

async function extractFromChunk(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<any[]> {
  const primaryResult = await requestExtraction(apiKey, systemPrompt, userPrompt, MAX_TOKENS);
  let items = parseAiResponse(primaryResult);

  if (items.length > 0 && !isTruncatedResponse(primaryResult)) {
    return items;
  }

  // Retry with reduced output request
  const retryPrompt = `${userPrompt}\n\nIMPORTANT: Return exactly 2 tactical plays maximum. Keep every field complete but concise, and output valid JSON only.`;
  const retryResult = await requestExtraction(apiKey, systemPrompt, retryPrompt, MAX_TOKENS);
  const retryItems = parseAiResponse(retryResult);

  if (retryItems.length > 0) {
    items = retryItems;
  }

  return items;
}

/** Deduplicate by title similarity — conservative for lessons */
function deduplicateItems(items: any[], isLesson = false): any[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = (s: string) => new Set(normalize(s).split(/\s+/).filter(w => w.length > 2));
  // Lessons use a much higher dedup threshold to avoid merging adjacent tactics
  const OVERLAP_THRESHOLD = isLesson ? 0.85 : 0.6;

  const result: any[] = [];
  for (const item of items) {
    const itemWords = words(item.title || '');
    const itemSummaryWords = words(item.tactic_summary || '');
    let isDupe = false;
    for (let i = 0; i < result.length; i++) {
      const existingWords = words(result[i].title || '');
      const intersection = [...itemWords].filter(w => existingWords.has(w));
      const overlapRatio = intersection.length / Math.min(itemWords.size, existingWords.size);
      // For lessons, also check tactic_summary overlap to catch semantically identical items
      const existingSummaryWords = words(result[i].tactic_summary || '');
      const summaryIntersection = [...itemSummaryWords].filter(w => existingSummaryWords.has(w));
      const summaryOverlap = itemSummaryWords.size > 0 && existingSummaryWords.size > 0
        ? summaryIntersection.length / Math.min(itemSummaryWords.size, existingSummaryWords.size)
        : 0;

      const titleMatch = overlapRatio > OVERLAP_THRESHOLD;
      const substringMatch = !isLesson && (normalize(item.title).includes(normalize(result[i].title)) || normalize(result[i].title).includes(normalize(item.title)));
      const compositeDupe = isLesson && overlapRatio > 0.7 && summaryOverlap > 0.7;

      if (titleMatch || substringMatch || compositeDupe) {
        isDupe = true;
        if ((item.source_excerpt?.length || 0) > (result[i].source_excerpt?.length || 0)) {
          result[i] = item;
        }
        break;
      }
    }
    if (!isDupe) result.push(item);
  }
  return result;
}

/** Validate a single extracted item — stricter for raw transcripts, relaxed for structured lessons */
function validateItem(item: any, isTranscript: boolean, isLesson: boolean): boolean {
  const MIN_FIELD_LEN = 40;
  const HTML_PATTERN = /<[a-z][\s\S]*>/i;

  if (!item.title) return false;
  if (!item.tactic_summary || item.tactic_summary.length < 15) return false;

  const example = item.example_usage || item.example || '';

  // Structured lessons get relaxed validation — the content is curated, not raw
  if (isLesson) {
    // Minimal gates for lesson content: title + summary + at least some how-to or source
    if (!item.how_to_execute && !item.source_excerpt) return false;
    const allText = [item.title, item.tactic_summary, item.how_to_execute, example].join(' ');
    if (HTML_PATTERN.test(allText)) return false;
    // Accept defaults for attribution fields — lesson author is known from resource metadata
    if (!item.framework) item.framework = 'General';
    if (!item.who) item.who = 'Unknown';
    if (!item.source_location) item.source_location = 'Lesson content';
    return true;
  }

  // Non-lesson: stricter validation
  if (!item.framework || item.framework.trim() === '') return false;
  if (!item.who || item.who.trim() === '') return false;
  if (!item.source_excerpt || item.source_excerpt.length < 20) return false;
  if (!item.source_location || item.source_location.trim() === '') return false;
  if (!item.when_to_use || item.when_to_use.length < 20) return false;

  if (!item.macro_situation || item.macro_situation.length < MIN_FIELD_LEN) return false;
  if (!item.micro_strategy || item.micro_strategy.length < MIN_FIELD_LEN) return false;
  if (!item.how_to_execute || item.how_to_execute.length < MIN_FIELD_LEN) return false;
  if (example.length < 30) return false;

  const allText = [item.title, item.tactic_summary, item.macro_situation, item.how_to_execute, example].join(' ');
  if (HTML_PATTERN.test(allText)) return false;

  // Transcript-specific: title must be verb-led, not a sentence fragment
  if (isTranscript) {
    const verbLedPattern = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize|apply|deploy|establish|negotiate|prepare|structure|deliver|align|engage|trigger|introduce|propose|define|prioritize|execute|implement|develop|assess|evaluate|document|track|measure|monitor|adapt|adjust|escalate|de-escalate|simplify|clarify|articulate|illustrate|connect|link|uncover|reveal|expose|surface|extract|capture|name|label|restate|mirror|acknowledge|interrupt|pause|reset|redirect|flip|invert|plant|seed|earn|secure|protect|defend|block|pre-empt|anticipate|signal|flag|commit|lock|tie|bundle|unbundle|separate|isolate|stack|layer|combine|sequence|time|delay|accelerate|slow|speed|pace|control|manage|own|run|facilitate|orchestrate|coordinate|coach|mentor|advise|guide|steer|navigate|overcome)\b/i;
    if (!verbLedPattern.test(item.title.trim())) {
      return false;
    }
    if (item.tactic_summary.toLowerCase().startsWith(item.title.toLowerCase().slice(0, 25))) {
      return false;
    }
    if (item.how_to_execute.length < 80) return false;
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    // Allow service-role key via custom header for server-side batch operations
    const batchKey = req.headers.get('x-batch-key');
    const isServiceRole = batchKey != null && batchKey === serviceRoleKey;
    
    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { title, content, description, tags, resourceType } = await req.json();

    if (!content || content.length < 100) {
      return new Response(JSON.stringify({ items: [], chunks_total: 0, chunks_processed: 0, chunks_failed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isTranscript = isTranscriptType(resourceType);
    const isLesson = isStructuredLesson(content, title, resourceType);
    const itemTarget = isLesson ? LESSON_ITEM_TARGET : isTranscript ? TRANSCRIPT_ITEM_TARGET : DOCUMENT_ITEM_TARGET;

    // ══════════════════════════════════════════════════
    // LESSON MODE: 2-stage pipeline
    // ══════════════════════════════════════════════════
    if (isLesson) {
      const cleanedContent = prepareLessonContent(content, title);
      console.log(`[extract-tactics] LESSON detected: "${title}" | original=${content.length} cleaned=${cleanedContent.length} chars`);
      const result = await extractLessonTwoStage(LOVABLE_API_KEY, cleanedContent, title, description, tags, resourceType);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ══════════════════════════════════════════════════
    // STANDARD MODE: chunked extraction for docs/transcripts
    // ══════════════════════════════════════════════════
    const systemPrompt = isTranscript
      ? BASE_SYSTEM_PROMPT + TRANSCRIPT_ADDENDUM
      : BASE_SYSTEM_PROMPT;

    const chunks = chunkContent(content, isTranscript);
    const totalChunks = chunks.length;
    let processedChunks = 0;
    let failedChunks = 0;
    const allItems: any[] = [];

    console.log(`[extract-tactics] ${isTranscript ? 'TRANSCRIPT' : 'DOCUMENT'} mode | Content: ${content.length} chars → ${totalChunks} chunk(s)`);

    for (let i = 0; i < chunks.length; i++) {
      const chunkLabel = totalChunks > 1 ? `Chunk ${i + 1} of ${totalChunks}` : '';
      const approxPosition = totalChunks > 1
        ? `~${Math.round((i / totalChunks) * 100)}% through the content`
        : '';
      const sectionHeadings = (chunks[i].match(/^## .+$/gm) || []).map(h => h.replace('## ', '')).join(', ');

      const userPrompt = `Extract structured tactical plays from this ${resourceType || 'document'}:

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}
${chunkLabel ? `\nPosition: ${chunkLabel} (${approxPosition})` : ''}
${sectionHeadings ? `\nSections covered: ${sectionHeadings}` : ''}
${totalChunks > 1 ? `\nIMPORTANT: Extract ${itemTarget} plays from THIS section only. Do not repeat plays from other sections.` : `\nExtract at least ${itemTarget} plays. If the content contains more distinct tactics, extract them all.`}

Content:
${chunks[i]}

Remember: every play MUST include source_excerpt (verbatim quote), source_location, framework, and who. No play without attribution.`;

      try {
        const chunkItems = await extractFromChunk(LOVABLE_API_KEY, systemPrompt, userPrompt);
        for (const item of chunkItems) {
          if (totalChunks > 1 && item.source_location) {
            item.source_location = `${chunkLabel} — ${item.source_location}`;
          }
        }
        allItems.push(...chunkItems);
        processedChunks++;
        console.log(`[extract-tactics] ${chunkLabel || 'Single pass'}: ${chunkItems.length} items`);
      } catch (err) {
        failedChunks++;
        console.error(`[extract-tactics] ${chunkLabel} failed:`, err);
      }
    }

    const deduped = deduplicateItems(allItems, false);

    // Validate and normalize — using transcript-aware validation
    const validated = deduped
      .filter(item => validateItem(item, isTranscript, false))
      .map((item: any) => ({
        ...item,
        tactic_summary: item.tactic_summary,
        example_usage: item.example_usage || item.example,
        why_it_matters: item.why_it_matters || item.why_this_works || item.micro_strategy,
        what_this_unlocks: item.what_this_unlocks || null,
        source_title: title,
      }));

    console.log(`[extract-tactics] Final: ${validated.length} validated from ${allItems.length} raw, ${processedChunks}/${totalChunks} chunks`);

    return new Response(JSON.stringify({
      items: validated,
      chunks_total: totalChunks,
      chunks_processed: processedChunks,
      chunks_failed: failedChunks,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('extract-tactics error:', error);
    return new Response(JSON.stringify({ error: 'Extraction failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ══════════════════════════════════════════════════════
// LESSON 2-STAGE PIPELINE
// ══════════════════════════════════════════════════════

async function extractLessonTwoStage(
  apiKey: string,
  content: string,
  title: string,
  description: string | undefined,
  tags: string[],
  resourceType: string | undefined,
): Promise<{ items: any[]; chunks_total: number; chunks_processed: number; chunks_failed: number; lesson_pipeline: any }> {
  const pipelineLog: any = { stage1_candidates: 0, stage2_raw: 0, stage2_validated: 0, recovery_found: 0, recovery_added: 0, final: 0 };

  console.log(`[extract-tactics] LESSON 2-STAGE mode | Content: ${content.length} chars`);

  // ── STAGE 1: Exhaustive enumeration ──
  const enumeratePrompt = `Analyze this structured training lesson and create an exhaustive inventory of every distinct teachable concept, technique, framework, rule, signal, method, or heuristic.

Title: ${title}
${description ? `Description: ${description}` : ''}

Content:
${content}

List EVERY distinct concept. If the lesson teaches 15 things, return 15 items. Do NOT merge related concepts — each gets its own entry.`;

  let candidates: any[] = [];
  try {
    const enumResult = await requestExtraction(apiKey, LESSON_ENUMERATE_SYSTEM, enumeratePrompt, 4096);
    candidates = parseAiResponse(enumResult);
    pipelineLog.stage1_candidates = candidates.length;
    console.log(`[extract-tactics] Stage 1 enumeration: ${candidates.length} candidates`);
  } catch (err) {
    console.error('[extract-tactics] Stage 1 enumeration failed:', err);
  }

  // ── STAGE 2: Full KI expansion ──
  const candidateList = candidates.length > 0
    ? candidates.map((c: any, i: number) => `${i + 1}. ${c.candidate_title || c.title || 'Untitled'} [${c.concept_type || 'technique'}] — ${c.source_hint || ''}`).join('\n')
    : '(No enumeration available — extract everything you can find)';

  const stage2System = BASE_SYSTEM_PROMPT + LESSON_ADDENDUM;
  const stage2Prompt = `Extract structured tactical plays from this training lesson.

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}

${candidates.length > 0 ? `The following ${candidates.length} distinct concepts were identified in this lesson. You MUST produce a full KI play for EACH one:\n\n${candidateList}\n\n` : ''}
Content:
${content}

CRITICAL: Produce one complete play per concept listed above. Do not merge concepts. Do not skip any. If you find additional concepts not in the list, include those too.
Titles may describe the concept naturally — they do NOT need to start with a verb.`;

  let rawItems: any[] = [];
  try {
    const stage2Result = await requestExtraction(apiKey, stage2System, stage2Prompt, MAX_TOKENS);
    rawItems = parseAiResponse(stage2Result);

    // If truncated, try a second pass for remaining candidates
    if (isTruncatedResponse(stage2Result) && candidates.length > rawItems.length) {
      console.log(`[extract-tactics] Stage 2 truncated at ${rawItems.length} items, retrying remaining`);
      const producedTitles = rawItems.map((it: any) => (it.title || '').toLowerCase());
      const missed = candidates.filter((c: any) => {
        const ct = (c.candidate_title || '').toLowerCase();
        return !producedTitles.some((pt: string) => pt.includes(ct.slice(0, 20)) || ct.includes(pt.slice(0, 20)));
      });

      if (missed.length > 0) {
        const missedList = missed.map((c: any, i: number) => `${i + 1}. ${c.candidate_title} [${c.concept_type}] — ${c.source_hint || ''}`).join('\n');
        const continuationPrompt = `Continue extracting plays from this lesson. These ${missed.length} concepts were NOT covered in the previous pass:\n\n${missedList}\n\nContent:\n${content}\n\nProduce one complete play per concept. Return ONLY a JSON array.`;
        const contResult = await requestExtraction(apiKey, stage2System, continuationPrompt, MAX_TOKENS);
        const contItems = parseAiResponse(contResult);
        rawItems.push(...contItems);
        console.log(`[extract-tactics] Continuation pass: ${contItems.length} additional items`);
      }
    }

    pipelineLog.stage2_raw = rawItems.length;
    console.log(`[extract-tactics] Stage 2 extraction: ${rawItems.length} raw items`);
  } catch (err) {
    console.error('[extract-tactics] Stage 2 extraction failed:', err);
  }

  // ── Validate with lesson-aware rules ──
  const deduped = deduplicateItems(rawItems, true);
  const validated = deduped
    .filter(item => validateItem(item, false, true))
    .map((item: any) => ({
      ...item,
      tactic_summary: item.tactic_summary,
      example_usage: item.example_usage || item.example,
      why_it_matters: item.why_it_matters || item.why_this_works || item.micro_strategy,
      what_this_unlocks: item.what_this_unlocks || null,
      source_title: title,
    }));

  pipelineLog.stage2_validated = validated.length;

  // ── STAGE 3: Missed-tactics recovery ──
  if (candidates.length > 0 && validated.length < candidates.length) {
    const producedTitles = validated.map((v: any) => (v.title || '').toLowerCase());
    const producedSummaries = validated.map((v: any) => (v.tactic_summary || '').toLowerCase());
    const missed = candidates.filter((c: any) => {
      const ct = (c.candidate_title || '').toLowerCase();
      const titleCovered = producedTitles.some((pt: string) => {
        const ctWords = ct.split(/\s+/).filter((w: string) => w.length > 2);
        const overlap = ctWords.filter((w: string) => pt.includes(w));
        return overlap.length >= Math.min(3, ctWords.length * 0.5);
      });
      const summaryCovered = producedSummaries.some((ps: string) => {
        const words = ct.split(/\s+/).filter((w: string) => w.length > 3);
        const hits = words.filter((w: string) => ps.includes(w));
        return hits.length >= Math.min(2, words.length * 0.4);
      });
      return !titleCovered && !summaryCovered;
    });

    pipelineLog.recovery_found = missed.length;

    if (missed.length > 0 && missed.length <= 10) {
      console.log(`[extract-tactics] Recovery: ${missed.length} candidates not covered, re-extracting`);
      const missedList = missed.map((c: any, i: number) => `${i + 1}. ${c.candidate_title} [${c.concept_type}] — ${c.source_hint || ''}`).join('\n');
      const recoveryPrompt = `These ${missed.length} concepts from the lesson were missed in the initial extraction. Extract a full play for EACH one:

${missedList}

Title: ${title}
Content:
${content}

Return ONLY a JSON array. One play per concept.`;

      try {
        const recoveryResult = await requestExtraction(apiKey, stage2System, recoveryPrompt, MAX_TOKENS);
        const recoveryItems = parseAiResponse(recoveryResult);
        const recoveryValidated = recoveryItems
          .filter(item => validateItem(item, false, true))
          .map((item: any) => ({
            ...item,
            tactic_summary: item.tactic_summary,
            example_usage: item.example_usage || item.example,
            why_it_matters: item.why_it_matters || item.why_this_works || item.micro_strategy,
            what_this_unlocks: item.what_this_unlocks || null,
            source_title: title,
          }));

        // Dedup recovery items against already-validated set
        const combined = [...validated, ...recoveryValidated];
        const finalDeduped = deduplicateItems(combined, true);
        const added = finalDeduped.length - validated.length;
        pipelineLog.recovery_added = added;

        if (added > 0) {
          console.log(`[extract-tactics] Recovery added ${added} new items`);
          validated.push(...finalDeduped.slice(validated.length));
        }
      } catch (err) {
        console.error('[extract-tactics] Recovery pass failed:', err);
      }
    }
  }

  pipelineLog.final = validated.length;
  console.log(`[extract-tactics] LESSON FINAL: ${validated.length} items (from ${candidates.length} candidates, ${rawItems.length} raw)`);

  return {
    items: validated,
    chunks_total: 1,
    chunks_processed: 1,
    chunks_failed: 0,
    lesson_pipeline: pipelineLog,
  };
}
