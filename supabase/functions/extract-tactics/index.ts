import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

// ══════════════════════════════════════════════════════════════
// SYSTEM PROMPT — upgraded for maximum extraction depth
// ══════════════════════════════════════════════════════════════

const BASE_SYSTEM_PROMPT = `You are an expert knowledge extraction engine for a sales performance operating system.

Your job is to convert source content into high-value, reusable Knowledge Items (KIs) that improve future coaching, discovery prep, deal strategy, objection handling, messaging, and execution.

Do NOT summarize the document at a high level.
Do NOT extract fluff, generic statements, or obvious filler.
Do NOT output low-value sentence fragments.

Instead, extract durable, reusable tactical knowledge:
- frameworks
- decision rules
- playbooks
- tactics
- diagnostic questions
- execution patterns
- messaging structures
- traps to avoid
- examples that teach a repeatable lesson

Each KI must be useful later in a real sales workflow.

Prefer:
- "how to do it"
- "when to use it"
- "why it matters"
- "what this unlocks"
- "what good looks like"
- "what to avoid"

Avoid:
- vague motivational advice
- generic statements with no actionability
- duplicate points phrased differently
- content that only makes sense inside the original document without enough context

If the source is rich, extract more KIs. Do not artificially cap output to 2–4 items.
Target output volume based on source richness:
- short but meaningful source: 3–6 KIs
- medium source: 6–10 KIs
- rich source: 10–18 KIs

Every KI must be:
- specific
- action-oriented
- reusable
- non-duplicative
- grounded in the source

EVERY knowledge item MUST include ALL of these fields:
1. "title" — verb-led action title (e.g. "Reframe the budget objection using cost-of-inaction")
2. "knowledge_type" — skill|product|competitive
3. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
4. "sub_chapter" — optional sub-category
5. "tactic_summary" — concise 2-3 sentence summary for quick reference
6. "why_it_matters" — WHY does this work? 2-3 sentences on the psychology or sales principle.
7. "when_to_use" — specific trigger conditions (2-3 sentences)
8. "when_not_to_use" — boundaries and anti-patterns (2-3 sentences)
9. "example_usage" — a REALISTIC conversational talk track or email snippet. 3-4 sentences minimum.
10. "macro_situation" — WHEN does this play apply? 2-4 sentences.
11. "micro_strategy" — WHAT are you specifically doing? 2-3 sentences.
12. "how_to_execute" — HOW to do it step by step. 3-5 concrete steps.
13. "what_this_unlocks" — OUTCOME when executed well. 2-3 sentences.
14. "source_excerpt" — EXACT verbatim quote from source. Minimum 2 sentences.
15. "source_location" — where in the content this was found.
16. "framework" — methodology (GAP Selling, Challenger Sale, MEDDPICC, etc. or "General"). REQUIRED.
17. "who" — thought leader/author or "Unknown". REQUIRED.

QUALITY GATES — REJECT any item that:
- Has any field shorter than 2 sentences (except title, chapter, knowledge_type, sub_chapter)
- Is generic advice without specific phrasing
- Contains UI / HTML / CSS artifacts
- Describes what to think rather than what to DO
- Has no clear source attribution
- Could apply to any situation (not situational enough)

Return high-quality tactical plays as a JSON array. Only return the JSON array, no markdown fences.`;

// ── Pass modifiers for multi-pass extraction ──

const PASS_MODIFIERS: Record<string, string> = {
  core: `Pass 1 — Core Tactics: Extract explicit tactical knowledge directly stated in the source.
Focus on clear tactics, frameworks, sequences, checklists, objection handling, discovery strategy, qualification logic, and execution guidance.`,

  hidden: `Pass 2 — Hidden Insights: Extract non-obvious insights that were likely missed in a first-pass extraction.

Look for:
- implied decision rules
- patterns behind examples
- nuanced "why this works"
- hidden constraints
- sequencing logic
- tradeoffs
- judgment calls
- signals of good vs bad execution

Do not repeat items already captured in Pass 1.
Favor deeper interpretation over restating the source.`,

  framework: `Pass 3 — Framework Synthesis: Convert the source into reusable playbooks, mental models, and frameworks.

Look for:
- operating systems
- repeatable sales motions
- diagnostic trees
- prep frameworks
- call structures
- coaching models
- execution sequences
- "if this, then that" guidance

If the source implies a framework but does not name it explicitly, synthesize it as a reusable KI.
Do not duplicate prior items.`,
};

const TRANSCRIPT_ADDENDUM = `

TRANSCRIPT-SPECIFIC INSTRUCTIONS:
You are extracting from a podcast/interview transcript. Find SPECIFIC TECHNIQUES, FRAMEWORKS, and ACTIONABLE METHODS — not summaries of conversation topics.

GOOD plays: specific discovery question techniques, concrete negotiation moves with exact phrasing, step-by-step frameworks.
BAD plays: topic summaries like "The guest discussed discovery", vague advice like "build rapport".

For each section ask: "Could a sales rep USE this in their next call?" If vague, skip it.`;

const LESSON_ADDENDUM = `

STRUCTURED LESSON INSTRUCTIONS:
You are extracting from structured training content. This is high-quality, curated educational content with MORE tactical density than typical content.

Extract EVERY distinct tactic, framework, or actionable technique covered. DO NOT under-extract.

Look for: Named frameworks, scoring models, research techniques, prioritization criteria, signal detection methods, territory management strategies, account scoring approaches, rules of thumb, tools/workflows.

Each distinct technique is its OWN separate play.`;

const LESSON_ENUMERATE_SYSTEM = `You are an expert training content analyst. Create an exhaustive inventory of every distinct teachable concept.

For each concept return JSON with:
- "candidate_title": short descriptive title (3-10 words)
- "concept_type": one of "framework", "technique", "rule", "signal", "method", "model", "tool", "heuristic", "tier", "criteria"
- "source_hint": a short quote or paragraph reference (1-2 sentences)
- "section": which part of the lesson

Be EXHAUSTIVE. Include every distinct framework, scoring criteria, research technique, signal detection approach, decision rule, tool, tiering system, metric.

Return ONLY a JSON array. No markdown fences.`;

const LESSON_TRANSCRIPT_MARKER = '--- Video Transcript ---';
const DOC_CHUNK_SIZE = 8000;
const DOC_CHUNK_OVERLAP = 500;
const TRANSCRIPT_CHUNK_SIZE = 25000;
const TRANSCRIPT_CHUNK_OVERLAP = 1500;
const DOC_SINGLE_PASS_THRESHOLD = 12000;
const TRANSCRIPT_SINGLE_PASS_THRESHOLD = 30000;
const MAX_TOKENS = 16384;

function isTranscriptType(resourceType?: string): boolean {
  return ['transcript', 'podcast', 'audio', 'podcast_episode', 'video', 'recording'].includes(
    (resourceType || '').toLowerCase()
  );
}

function isStructuredLesson(content: string, title?: string, resourceType?: string): boolean {
  const markerIndex = content.indexOf(LESSON_TRANSCRIPT_MARKER);
  if (markerIndex > 500) return true;
  const hasCourseTitle = (title || '').includes('>');
  const isVideoType = ['video', 'lesson'].includes((resourceType || '').toLowerCase());
  if (hasCourseTitle && isVideoType && content.length >= 500) return true;
  return false;
}

function prepareLessonContent(content: string, title?: string): string {
  if (!title || !title.includes('>')) return content;
  const lessonName = title.split('>').pop()?.trim();
  if (!lessonName || lessonName.length < 3) return content;
  const idx = content.toLowerCase().indexOf(lessonName.toLowerCase());
  if (idx > 0 && idx < 2000) return content.slice(idx).trim();
  return content;
}

function chunkTranscriptBySections(content: string, maxChunk: number, overlap: number): string[] {
  const sections = content.split(/(?=^## )/m);
  const chunks: string[] = [];
  let current = '';
  for (const section of sections) {
    if (!section.trim()) continue;
    if (current.length + section.length > maxChunk && current.length > 2000) {
      chunks.push(current);
      current = current.slice(-overlap) + '\n\n' + section;
    } else {
      current += (current ? '\n\n' : '') + section;
    }
  }
  if (current.trim().length > 500) chunks.push(current);
  if (chunks.length <= 1 && content.length > maxChunk) return chunkByParagraphs(content, maxChunk, overlap);
  return chunks.length > 0 ? chunks : [content];
}

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
  if (current.trim().length > 200) chunks.push(current);
  return chunks;
}

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
  const doFetch = () => fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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

  let res = await doFetch();
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 3000));
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`AI error: ${res.status}`);
  return res.json();
}

function parseAiResponse(result: any): any[] {
  const raw = result?.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return []; }
    }
    return [];
  }
}

function isTruncatedResponse(result: any): boolean {
  const fr = result?.choices?.[0]?.finish_reason || result?.choices?.[0]?.finishReason || null;
  return fr === 'length' || fr === 'MAX_TOKENS';
}

async function extractFromChunk(apiKey: string, systemPrompt: string, userPrompt: string): Promise<any[]> {
  const result = await requestExtraction(apiKey, systemPrompt, userPrompt, MAX_TOKENS);
  let items = parseAiResponse(result);
  if (items.length > 0 && !isTruncatedResponse(result)) return items;
  const retryPrompt = `${userPrompt}\n\nIMPORTANT: Return exactly 2 tactical plays maximum. Keep every field complete but concise, and output valid JSON only.`;
  const retryResult = await requestExtraction(apiKey, systemPrompt, retryPrompt, MAX_TOKENS);
  const retryItems = parseAiResponse(retryResult);
  if (retryItems.length > 0) items = retryItems;
  return items;
}

// ══════════════════════════════════════════════════════
// DEDUPLICATION — cross-pass aware
// ══════════════════════════════════════════════════════

function normalize(s: string): string { return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
function wordSet(s: string): Set<string> { return new Set(normalize(s).split(/\s+/).filter(w => w.length > 2)); }

function deduplicateItems(items: any[], isLesson = false): any[] {
  const OVERLAP_THRESHOLD = isLesson ? 0.85 : 0.6;
  const result: any[] = [];
  for (const item of items) {
    const itemWords = wordSet(item.title || '');
    const itemSummaryWords = wordSet(item.tactic_summary || '');
    let isDupe = false;
    for (let i = 0; i < result.length; i++) {
      const existingWords = wordSet(result[i].title || '');
      const intersection = [...itemWords].filter(w => existingWords.has(w));
      const overlapRatio = intersection.length / Math.min(itemWords.size, existingWords.size);
      
      const existingSummaryWords = wordSet(result[i].tactic_summary || '');
      const summaryIntersection = [...itemSummaryWords].filter(w => existingSummaryWords.has(w));
      const summaryOverlap = itemSummaryWords.size > 0 && existingSummaryWords.size > 0
        ? summaryIntersection.length / Math.min(itemSummaryWords.size, existingSummaryWords.size) : 0;

      // Exact same tactic_summary → dedupe
      if (normalize(item.tactic_summary || '') === normalize(result[i].tactic_summary || '') && (item.tactic_summary || '').length > 20) {
        isDupe = true;
      }
      // Highly similar title + tactic_summary → dedupe
      else if (overlapRatio > 0.7 && summaryOverlap > 0.7) {
        isDupe = true;
      }
      // Title overlap threshold
      else if (overlapRatio > OVERLAP_THRESHOLD) {
        isDupe = true;
      }
      // Substring match (non-lesson only)
      else if (!isLesson && (normalize(item.title).includes(normalize(result[i].title)) || normalize(result[i].title).includes(normalize(item.title)))) {
        isDupe = true;
      }

      if (isDupe) {
        // Keep the richer version (merge preference: stronger title, better actionability)
        const existingRichness = (result[i].how_to_execute?.length || 0) + (result[i].when_to_use?.length || 0) + (result[i].source_excerpt?.length || 0);
        const newRichness = (item.how_to_execute?.length || 0) + (item.when_to_use?.length || 0) + (item.source_excerpt?.length || 0);
        if (newRichness > existingRichness) {
          result[i] = item;
        }
        break;
      }
    }
    if (!isDupe) result.push(item);
  }
  return result;
}

function validateItem(item: any, isTranscript: boolean, isLesson: boolean): boolean {
  const MIN_FIELD_LEN = 40;
  const HTML_PATTERN = /<[a-z][\s\S]*>/i;
  if (!item.title) return false;
  if (!item.tactic_summary || item.tactic_summary.length < 15) return false;
  const example = item.example_usage || item.example || '';

  if (isLesson) {
    if (!item.how_to_execute && !item.source_excerpt) return false;
    const allText = [item.title, item.tactic_summary, item.how_to_execute, example].join(' ');
    if (HTML_PATTERN.test(allText)) return false;
    if (!item.framework) item.framework = 'General';
    if (!item.who) item.who = 'Unknown';
    if (!item.source_location) item.source_location = 'Lesson content';
    return true;
  }

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

  if (isTranscript) {
    const verbLedPattern = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize|apply|deploy|establish|negotiate|prepare|structure|deliver|align|engage|trigger|introduce|propose|define|prioritize|execute|implement|develop|assess|evaluate|document|track|measure|monitor|adapt|adjust|escalate|de-escalate|simplify|clarify|articulate|illustrate|connect|link|uncover|reveal|expose|surface|extract|capture|name|label|restate|mirror|acknowledge|interrupt|pause|reset|redirect|flip|invert|plant|seed|earn|secure|protect|defend|block|pre-empt|anticipate|signal|flag|commit|lock|tie|bundle|unbundle|separate|isolate|stack|layer|combine|sequence|time|delay|accelerate|slow|speed|pace|control|manage|own|run|facilitate|orchestrate|coordinate|coach|mentor|advise|guide|steer|navigate|overcome)\b/i;
    if (!verbLedPattern.test(item.title.trim())) return false;
    if (item.tactic_summary.toLowerCase().startsWith(item.title.toLowerCase().slice(0, 25))) return false;
    if (item.how_to_execute.length < 80) return false;
  }
  return true;
}

function normalizeItem(item: any, title: string): any {
  return {
    ...item,
    tactic_summary: item.tactic_summary,
    example_usage: item.example_usage || item.example,
    why_it_matters: item.why_it_matters || item.why_this_works || item.micro_strategy,
    what_this_unlocks: item.what_this_unlocks || null,
    source_title: title,
  };
}

// ══════════════════════════════════════════════════════
// DEPTH SCORING
// ══════════════════════════════════════════════════════

function computeDepthBucket(kiCount: number, contentLength: number): string {
  if (kiCount === 0) return 'none';
  const kisPer1k = contentLength > 0 ? (kiCount * 1000) / contentLength : 0;
  if (kisPer1k < 0.75) return 'shallow';
  if (kisPer1k < 1.5) return 'moderate';
  return 'strong';
}

function computeUnderExtracted(kiCount: number, contentLength: number): boolean {
  const kisPer1k = contentLength > 0 ? (kiCount * 1000) / contentLength : 0;
  if (contentLength >= 5000 && kiCount <= 6) return true;
  if (contentLength >= 3000 && kiCount <= 4) return true;
  if (contentLength >= 1500 && kiCount <= 2) return true;
  if (kisPer1k < 1.0 && kiCount > 0) return true;
  return false;
}

// ══════════════════════════════════════════════════════
// MULTI-PASS EXTRACTION ENGINE
// ══════════════════════════════════════════════════════

interface MultiPassResult {
  items: any[];
  passMetrics: {
    core: number;
    hidden: number;
    framework: number;
  };
  mergedCount: number;
  extractionMode: string;
  passesRun: string[];
  depthBucket: string;
  underExtracted: boolean;
  kisPer1k: number;
  summary: string;
}

async function runMultiPassExtraction(
  apiKey: string,
  content: string,
  title: string,
  description: string | undefined,
  tags: string[],
  resourceType: string | undefined,
  isTranscript: boolean,
  deepMode: boolean,
): Promise<MultiPassResult> {
  const baseSystem = isTranscript ? BASE_SYSTEM_PROMPT + TRANSCRIPT_ADDENDUM : BASE_SYSTEM_PROMPT;
  const chunks = chunkContent(content, isTranscript);
  const passesRun: string[] = [];
  const passMetrics = { core: 0, hidden: 0, framework: 0 };
  let allCandidates: any[] = [];
  const contentLength = content.length;
  const isRich = contentLength >= 2500;

  // ── Helper: run one pass across all chunks ──
  const runPass = async (passName: string): Promise<any[]> => {
    const modifier = PASS_MODIFIERS[passName];
    const systemPrompt = `${baseSystem}\n\n${modifier}`;
    const passItems: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkLabel = chunks.length > 1 ? `Chunk ${i + 1} of ${chunks.length}` : '';
      const sectionHeadings = (chunks[i].match(/^## .+$/gm) || []).map((h: string) => h.replace('## ', '')).join(', ');
      
      const userPrompt = `Extract the maximum number of high-value, non-duplicative Knowledge Items from the following content.

Your goal is depth, not brevity.

Prioritize:
1. tactical execution guidance
2. reusable frameworks
3. mental models
4. discovery / objection / follow-up / qualification / demo / pipeline patterns
5. diagnostic questions
6. examples that reveal a generalizable principle
7. "why this works" insights that can improve later coaching or selling

Additional rules:
- Merge overlapping ideas into one stronger KI
- Split truly distinct tactics into separate KIs
- Prefer strong titles that sound like reusable tactics
- If the content includes a framework, process, checklist, or decision sequence, extract it as a first-class KI
- If the content includes examples, abstract the principle so it can be reused elsewhere
- If the content is rich and tactical, do NOT stop early

Source title: ${title}
Source type: ${resourceType || 'document'}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}
${chunkLabel ? `Position: ${chunkLabel}` : ''}
${sectionHeadings ? `Sections covered: ${sectionHeadings}` : ''}

Source content:
${chunks[i]}`;

      try {
        const items = await extractFromChunk(apiKey, systemPrompt, userPrompt);
        for (const item of items) {
          if (chunks.length > 1 && item.source_location) {
            item.source_location = `${chunkLabel} — ${item.source_location}`;
          }
          item._pass = passName;
        }
        passItems.push(...items);
      } catch (err) {
        console.error(`[extract-tactics] ${passName} ${chunkLabel} failed:`, err);
      }
    }
    return passItems;
  };

  // ── Pass 1: Core Tactics (always runs) ──
  console.log(`[extract-tactics] Pass 1 (core) starting | ${chunks.length} chunk(s) | ${contentLength} chars`);
  const coreItems = await runPass('core');
  passMetrics.core = coreItems.length;
  allCandidates.push(...coreItems);
  passesRun.push('core');
  console.log(`[extract-tactics] Pass 1 (core): ${coreItems.length} candidates`);

  // ── Determine if Pass 2+3 needed ──
  const pass1Deduped = deduplicateItems(allCandidates, false);
  const pass1Validated = pass1Deduped.filter(it => validateItem(it, isTranscript, false));
  const pass1Depth = computeDepthBucket(pass1Validated.length, contentLength);
  const pass1UnderExtracted = computeUnderExtracted(pass1Validated.length, contentLength);
  const shouldEscalate = deepMode || pass1UnderExtracted || pass1Depth === 'shallow' || (isRich && pass1Validated.length < 6);

  if (shouldEscalate) {
    // ── Pass 2: Hidden Insights ──
    console.log(`[extract-tactics] Pass 2 (hidden) starting | reason: ${deepMode ? 'deep_mode' : pass1UnderExtracted ? 'under_extracted' : 'shallow'}`);
    // Add 2s delay between passes to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
    const hiddenItems = await runPass('hidden');
    passMetrics.hidden = hiddenItems.length;
    allCandidates.push(...hiddenItems);
    passesRun.push('hidden');
    console.log(`[extract-tactics] Pass 2 (hidden): ${hiddenItems.length} candidates`);

    // ── Pass 3: Framework Synthesis ──
    console.log(`[extract-tactics] Pass 3 (framework) starting`);
    await new Promise(r => setTimeout(r, 2000));
    const frameworkItems = await runPass('framework');
    passMetrics.framework = frameworkItems.length;
    allCandidates.push(...frameworkItems);
    passesRun.push('framework');
    console.log(`[extract-tactics] Pass 3 (framework): ${frameworkItems.length} candidates`);
  }

  // ── Merge + dedupe across all passes ──
  const merged = deduplicateItems(allCandidates, false);
  const validated = merged
    .filter(it => validateItem(it, isTranscript, false))
    .map(it => normalizeItem(it, title));

  const kisPer1k = contentLength > 0 ? Math.round((validated.length * 1000 / contentLength) * 100) / 100 : 0;
  const depthBucket = computeDepthBucket(validated.length, contentLength);
  const underExtracted = computeUnderExtracted(validated.length, contentLength);
  const extractionMode = shouldEscalate ? 'deep' : 'standard';

  const summary = `${extractionMode} extraction: ${passesRun.join('+')} passes | ${allCandidates.length} raw → ${merged.length} merged → ${validated.length} validated | ${kisPer1k} KIs/1k | ${depthBucket}`;
  console.log(`[extract-tactics] FINAL: ${summary}`);

  return {
    items: validated,
    passMetrics,
    mergedCount: merged.length,
    extractionMode,
    passesRun,
    depthBucket,
    underExtracted,
    kisPer1k,
    summary,
  };
}

// ══════════════════════════════════════════════════════
// LESSON 2-STAGE PIPELINE (preserved, enhanced with metrics)
// ══════════════════════════════════════════════════════

async function extractLessonTwoStage(
  apiKey: string,
  content: string,
  title: string,
  description: string | undefined,
  tags: string[],
  resourceType: string | undefined,
): Promise<any> {
  const pipelineLog: any = { stage1_candidates: 0, stage2_raw: 0, stage2_validated: 0, recovery_found: 0, recovery_added: 0, final: 0 };
  console.log(`[extract-tactics] LESSON 2-STAGE mode | Content: ${content.length} chars`);

  // Stage 1: Enumerate
  const enumeratePrompt = `Analyze this structured training lesson and create an exhaustive inventory of every distinct teachable concept.

Title: ${title}
${description ? `Description: ${description}` : ''}

Content:
${content}

List EVERY distinct concept. If the lesson teaches 15 things, return 15 items.`;

  let candidates: any[] = [];
  try {
    const enumResult = await requestExtraction(apiKey, LESSON_ENUMERATE_SYSTEM, enumeratePrompt, 4096);
    candidates = parseAiResponse(enumResult);
    pipelineLog.stage1_candidates = candidates.length;
    console.log(`[extract-tactics] Stage 1: ${candidates.length} candidates`);
  } catch (err) { console.error('[extract-tactics] Stage 1 failed:', err); }

  // Stage 2: Full expansion
  const candidateList = candidates.length > 0
    ? candidates.map((c: any, i: number) => `${i + 1}. ${c.candidate_title || c.title || 'Untitled'} [${c.concept_type || 'technique'}] — ${c.source_hint || ''}`).join('\n')
    : '(No enumeration available)';

  const stage2System = BASE_SYSTEM_PROMPT + LESSON_ADDENDUM;
  const stage2Prompt = `Extract structured tactical plays from this training lesson.

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}

${candidates.length > 0 ? `The following ${candidates.length} concepts were identified. Produce a full KI for EACH:\n\n${candidateList}\n\n` : ''}
Content:
${content}

CRITICAL: One complete play per concept. Do not merge. Do not skip.`;

  let rawItems: any[] = [];
  try {
    const stage2Result = await requestExtraction(apiKey, stage2System, stage2Prompt, MAX_TOKENS);
    rawItems = parseAiResponse(stage2Result);

    if (isTruncatedResponse(stage2Result) && candidates.length > rawItems.length) {
      console.log(`[extract-tactics] Stage 2 truncated at ${rawItems.length}, retrying remaining`);
      const producedTitles = rawItems.map((it: any) => (it.title || '').toLowerCase());
      const missed = candidates.filter((c: any) => {
        const ct = (c.candidate_title || '').toLowerCase();
        return !producedTitles.some((pt: string) => pt.includes(ct.slice(0, 20)) || ct.includes(pt.slice(0, 20)));
      });
      if (missed.length > 0) {
        await new Promise(r => setTimeout(r, 2000));
        const missedList = missed.map((c: any, i: number) => `${i + 1}. ${c.candidate_title} [${c.concept_type}] — ${c.source_hint || ''}`).join('\n');
        const contResult = await requestExtraction(apiKey, stage2System, `Continue extracting. These ${missed.length} were NOT covered:\n\n${missedList}\n\nContent:\n${content}\n\nReturn ONLY JSON array.`, MAX_TOKENS);
        rawItems.push(...parseAiResponse(contResult));
      }
    }
    pipelineLog.stage2_raw = rawItems.length;
  } catch (err) { console.error('[extract-tactics] Stage 2 failed:', err); }

  const deduped = deduplicateItems(rawItems, true);
  const validated = deduped.filter(item => validateItem(item, false, true)).map(it => normalizeItem(it, title));
  pipelineLog.stage2_validated = validated.length;

  // Recovery pass for missed candidates
  if (candidates.length > 0 && validated.length < candidates.length) {
    const producedTitles = validated.map((v: any) => (v.title || '').toLowerCase());
    const missed = candidates.filter((c: any) => {
      const ct = (c.candidate_title || '').toLowerCase();
      return !producedTitles.some((pt: string) => {
        const ctWords = ct.split(/\s+/).filter((w: string) => w.length > 2);
        const overlap = ctWords.filter((w: string) => pt.includes(w));
        return overlap.length >= Math.min(3, ctWords.length * 0.5);
      });
    });
    pipelineLog.recovery_found = missed.length;
    if (missed.length > 0 && missed.length <= 10) {
      await new Promise(r => setTimeout(r, 2000));
      const missedList = missed.map((c: any, i: number) => `${i + 1}. ${c.candidate_title} [${c.concept_type}] — ${c.source_hint || ''}`).join('\n');
      try {
        const recoveryResult = await requestExtraction(apiKey, stage2System, `These ${missed.length} concepts were missed. Extract a full play for EACH:\n\n${missedList}\n\nTitle: ${title}\nContent:\n${content}\n\nReturn ONLY JSON array.`, MAX_TOKENS);
        const recoveryItems = parseAiResponse(recoveryResult).filter(it => validateItem(it, false, true)).map(it => normalizeItem(it, title));
        const combined = deduplicateItems([...validated, ...recoveryItems], true);
        pipelineLog.recovery_added = combined.length - validated.length;
        if (combined.length > validated.length) validated.push(...combined.slice(validated.length));
      } catch (err) { console.error('[extract-tactics] Recovery failed:', err); }
    }
  }

  pipelineLog.final = validated.length;
  const kisPer1k = content.length > 0 ? Math.round((validated.length * 1000 / content.length) * 100) / 100 : 0;
  console.log(`[extract-tactics] LESSON FINAL: ${validated.length} items | ${kisPer1k} KIs/1k`);

  return {
    items: validated,
    chunks_total: 1,
    chunks_processed: 1,
    chunks_failed: 0,
    lesson_pipeline: pipelineLog,
    extraction_metrics: {
      extraction_mode: 'standard',
      extraction_passes_run: ['lesson_enumerate', 'lesson_expand', 'lesson_recovery'],
      raw_candidate_counts: { enumerate: candidates.length, expand: rawItems.length, recovery: pipelineLog.recovery_added || 0 },
      merged_candidate_count: deduped.length,
      final_ki_count: validated.length,
      kis_per_1k_chars: kisPer1k,
      extraction_depth_bucket: computeDepthBucket(validated.length, content.length),
      under_extracted_flag: computeUnderExtracted(validated.length, content.length),
      last_extraction_summary: `lesson pipeline: ${candidates.length} enumerated → ${rawItems.length} expanded → ${validated.length} validated | ${kisPer1k} KIs/1k`,
    },
  };
}

// ══════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════

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

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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

    const { title, content, description, tags, resourceType, deepMode } = await req.json();

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

    // ── LESSON MODE ──
    if (isLesson) {
      const cleanedContent = prepareLessonContent(content, title);
      console.log(`[extract-tactics] LESSON: "${title}" | ${cleanedContent.length} chars`);
      const result = await extractLessonTwoStage(LOVABLE_API_KEY, cleanedContent, title, description, tags, resourceType);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── MULTI-PASS MODE (docs + transcripts) ──
    console.log(`[extract-tactics] ${isTranscript ? 'TRANSCRIPT' : 'DOCUMENT'} multi-pass | ${content.length} chars | deepMode=${!!deepMode}`);

    const result = await runMultiPassExtraction(
      LOVABLE_API_KEY, content, title, description, tags || [], resourceType, isTranscript, !!deepMode,
    );

    return new Response(JSON.stringify({
      items: result.items,
      chunks_total: chunkContent(content, isTranscript).length,
      chunks_processed: chunkContent(content, isTranscript).length,
      chunks_failed: 0,
      extraction_metrics: {
        extraction_mode: result.extractionMode,
        extraction_passes_run: result.passesRun,
        raw_candidate_counts: result.passMetrics,
        merged_candidate_count: result.mergedCount,
        final_ki_count: result.items.length,
        kis_per_1k_chars: result.kisPer1k,
        extraction_depth_bucket: result.depthBucket,
        under_extracted_flag: result.underExtracted,
        last_extraction_summary: result.summary,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('extract-tactics error:', error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
