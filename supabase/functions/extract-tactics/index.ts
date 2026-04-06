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

CRITICAL EXTRACTION PHILOSOPHY — EXPAND, DO NOT SUMMARIZE:
Do NOT just summarize or extract obvious points.
Your goal is to MAXIMIZE knowledge density by breaking ideas into multiple actionable insights.

For each concept in the source, you MUST:
1. Extract the explicit idea
2. Break it into components and generate SEPARATE KIs for each when valid:
   - CONDITIONS: when it applies (situational triggers, prerequisites)
   - MECHANISMS: why it works (psychology, leverage, timing)
   - FAILURE MODES: when it fails or backfires
   - VARIATIONS: how it changes by context (persona, deal size, stage)
   - IMPLICATIONS: what it enables downstream
3. Generate multiple KIs from a single concept when each represents a DISTINCT insight
4. Prioritize:
   - tactical insights with specific execution steps
   - decision frameworks and "if this then that" rules
   - hidden patterns behind examples
   - tradeoffs and judgment calls
   - edge cases and boundary conditions
5. Avoid duplication:
   - each KI must represent a DISTINCT insight
   - do NOT rephrase the same idea
6. If the content is narrative (e.g. interview, story, anecdote):
   - infer lessons from examples
   - convert stories into generalized, reusable insights
   - extract the underlying principle, not just the story

Do NOT extract fluff, generic statements, or obvious filler.
Do NOT output low-value sentence fragments.
Do NOT under-extract — if a concept has 3 distinct angles, produce 3 KIs.

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
- boundary conditions and edge cases
- failure modes and recovery patterns

Each KI must be useful later in a real sales workflow.

Prefer:
- "how to do it"
- "when to use it"
- "why it matters"
- "what this unlocks"
- "what good looks like"
- "what to avoid"
- "when this fails and why"
- "how this changes by context"

Avoid:
- vague motivational advice
- generic statements with no actionability
- duplicate points phrased differently
- content that only makes sense inside the original document without enough context

If the source is rich, extract MORE KIs. Do not artificially cap output.
Target output volume based on source richness:
- short but meaningful source: 4–8 KIs
- medium source: 8–14 KIs
- rich source: 14–22 KIs

Every KI must be:
- specific
- action-oriented
- reusable
- non-obvious
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

const PASS_MODIFIERS: Record<string, string> = {
  core: `Pass 1 — Core Tactics: Extract explicit tactical knowledge directly stated in the source.
Focus on clear tactics, frameworks, sequences, checklists, objection handling, discovery strategy, qualification logic, and execution guidance.
For each tactic, also consider: under what CONDITIONS does it apply? What FAILURE MODES exist? How does it VARY by deal size, persona, or stage?
Generate separate KIs for distinct conditions, failure modes, or variations when they are meaningfully different.`,

  hidden: `Pass 2 — Hidden Insights: Extract non-obvious insights that were likely missed in a first-pass extraction.

Look for:
- implied decision rules ("if X then Y" logic buried in examples)
- patterns behind examples (what made the example work?)
- nuanced "why this works" (psychology, timing, leverage)
- hidden constraints and prerequisites
- sequencing logic (order matters — why?)
- tradeoffs and judgment calls
- signals of good vs bad execution
- failure modes and recovery patterns
- edge cases and boundary conditions
- context-dependent variations (how does this change for enterprise vs SMB? For champions vs blockers?)

For narrative content: convert every anecdote into a generalized reusable principle.
Do not repeat items already captured in Pass 1.
Favor deeper interpretation over restating the source.`,

  framework: `Pass 3 — Framework Synthesis: Convert the source into reusable playbooks, mental models, and frameworks.

Look for:
- operating systems and repeatable sales motions
- diagnostic trees and decision matrices
- prep frameworks and call structures
- coaching models and execution sequences
- "if this, then that" guidance and branching logic
- classification systems (tiers, categories, archetypes)
- scoring models and prioritization criteria
- escalation and de-escalation patterns
- compound plays (sequencing multiple tactics)

If the source implies a framework but does not name it explicitly, synthesize it as a reusable KI.
Break complex frameworks into component KIs when each component is independently actionable.
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
const DOC_CHUNK_SIZE = 12000;
const DOC_CHUNK_OVERLAP = 800;
const TRANSCRIPT_CHUNK_SIZE = 25000;
const TRANSCRIPT_CHUNK_OVERLAP = 1500;
const DOC_SINGLE_PASS_THRESHOLD = 32000;
const TRANSCRIPT_SINGLE_PASS_THRESHOLD = 30000;
const MAX_TOKENS = 16384;
const MODEL_NAME = 'google/gemini-2.5-flash';

// ══════════════════════════════════════════════════════
// CONTENT CATEGORY — explicit, passed through entire pipeline
// ══════════════════════════════════════════════════════

type ContentCategory = 'lesson' | 'transcript' | 'document';

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

function classifyContentCategory(content: string, title?: string, resourceType?: string): ContentCategory {
  if (isStructuredLesson(content, title, resourceType)) return 'lesson';
  if (isTranscriptType(resourceType)) return 'transcript';
  return 'document';
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
      model: MODEL_NAME,
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
// DETERMINISTIC KI FINGERPRINTING — for duplicate protection
// ══════════════════════════════════════════════════════

function computeKiFingerprint(resourceId: string, title: string, tacticSummary: string): string {
  // Deterministic fingerprint: resource_id + normalized title + first 100 chars of summary
  const normTitle = (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 80);
  const normSummary = (tacticSummary || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 100);
  return `${resourceId}::${normTitle}::${normSummary}`;
}

// ══════════════════════════════════════════════════════
// DEDUPLICATION
// ══════════════════════════════════════════════════════

function normalize(s: string): string { return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
function wordSet(s: string): Set<string> { return new Set(normalize(s).split(/\s+/).filter(w => w.length > 2)); }

interface DedupeResult {
  kept: any[];
  mergedCount: number;
  details: { exact_summary: number; similar_title_summary: number; title_overlap: number; substring: number };
}

function deduplicateItems(items: any[], isLesson = false): DedupeResult {
  const OVERLAP_THRESHOLD = isLesson ? 0.85 : 0.75; // Relaxed from 0.6 to 0.75 to allow more distinct items
  const result: any[] = [];
  const details = { exact_summary: 0, similar_title_summary: 0, title_overlap: 0, substring: 0 };

  for (const item of items) {
    const itemWords = wordSet(item.title || '');
    const itemSummaryWords = wordSet(item.tactic_summary || '');
    let isDupe = false;
    let dupeReason = '';

    for (let i = 0; i < result.length; i++) {
      const existingWords = wordSet(result[i].title || '');
      const intersection = [...itemWords].filter(w => existingWords.has(w));
      const overlapRatio = Math.min(itemWords.size, existingWords.size) > 0
        ? intersection.length / Math.min(itemWords.size, existingWords.size) : 0;

      const existingSummaryWords = wordSet(result[i].tactic_summary || '');
      const summaryIntersection = [...itemSummaryWords].filter(w => existingSummaryWords.has(w));
      const summaryOverlap = itemSummaryWords.size > 0 && existingSummaryWords.size > 0
        ? summaryIntersection.length / Math.min(itemSummaryWords.size, existingSummaryWords.size) : 0;

      if (normalize(item.tactic_summary || '') === normalize(result[i].tactic_summary || '') && (item.tactic_summary || '').length > 20) {
        isDupe = true; dupeReason = 'exact_summary';
      } else if (overlapRatio > 0.8 && summaryOverlap > 0.8) {
        // Tightened from 0.7/0.7 — only merge when VERY similar on both title and summary
        isDupe = true; dupeReason = 'similar_title_summary';
      } else if (overlapRatio > OVERLAP_THRESHOLD && summaryOverlap > 0.6) {
        // Require summary overlap too for title-based dedup (previously title-only at 0.6)
        isDupe = true; dupeReason = 'title_overlap';
      }
      // Removed aggressive substring matching that was blocking related-but-distinct items

      if (isDupe) {
        const existingRichness = (result[i].how_to_execute?.length || 0) + (result[i].when_to_use?.length || 0) + (result[i].source_excerpt?.length || 0);
        const newRichness = (item.how_to_execute?.length || 0) + (item.when_to_use?.length || 0) + (item.source_excerpt?.length || 0);
        if (newRichness > existingRichness) result[i] = item;
        if (dupeReason) (details as any)[dupeReason]++;
        break;
      }
    }
    if (!isDupe) result.push(item);
  }
  return { kept: result, mergedCount: items.length - result.length, details };
}

// ══════════════════════════════════════════════════════
// VALIDATION — with structured rejection tracking
// ══════════════════════════════════════════════════════

interface ValidationResult {
  passed: boolean;
  rejectionReason: string | null;
}

function validateItem(item: any, isTranscript: boolean, isLesson: boolean): ValidationResult {
  const MIN_FIELD_LEN = 30; // Relaxed from 40 to allow more concise but valid items
  const HTML_PATTERN = /<[a-z][\s\S]*>/i;

  if (!item.title) return { passed: false, rejectionReason: 'missing_title' };
  if (!item.tactic_summary || item.tactic_summary.length < 15) return { passed: false, rejectionReason: 'short_tactic_summary' };

  const example = item.example_usage || item.example || '';

  if (isLesson) {
    if (!item.how_to_execute && !item.source_excerpt) return { passed: false, rejectionReason: 'missing_how_to_execute_and_excerpt' };
    const allText = [item.title, item.tactic_summary, item.how_to_execute, example].join(' ');
    if (HTML_PATTERN.test(allText)) return { passed: false, rejectionReason: 'html_artifacts' };
    if (!item.framework) item.framework = 'General';
    if (!item.who) item.who = 'Unknown';
    if (!item.source_location) item.source_location = 'Lesson content';
    return { passed: true, rejectionReason: null };
  }

  // Auto-fill missing metadata fields to prevent validation rejection on otherwise good items
  if (!item.framework || item.framework.trim() === '') item.framework = 'General';
  if (!item.who || item.who.trim() === '') item.who = 'Unknown';
  if (!item.source_location || item.source_location.trim() === '') item.source_location = 'Document content';

  if (!item.source_excerpt || item.source_excerpt.length < 15) return { passed: false, rejectionReason: 'missing_source_excerpt' };
  if (!item.when_to_use || item.when_to_use.length < 15) return { passed: false, rejectionReason: 'short_when_to_use' };
  if (!item.macro_situation || item.macro_situation.length < MIN_FIELD_LEN) return { passed: false, rejectionReason: 'short_macro_situation' };
  if (!item.micro_strategy || item.micro_strategy.length < MIN_FIELD_LEN) return { passed: false, rejectionReason: 'short_micro_strategy' };
  if (!item.how_to_execute || item.how_to_execute.length < MIN_FIELD_LEN) return { passed: false, rejectionReason: 'short_how_to_execute' };
  if (example.length < 20) return { passed: false, rejectionReason: 'short_example_usage' };

  const allText = [item.title, item.tactic_summary, item.macro_situation, item.how_to_execute, example].join(' ');
  if (HTML_PATTERN.test(allText)) return { passed: false, rejectionReason: 'html_artifacts' };

  if (isTranscript) {
    // Relaxed transcript validation: allow more verbs and don't require verb-led for rich items
    const verbLedPattern = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize|apply|deploy|establish|negotiate|prepare|structure|deliver|align|engage|trigger|introduce|propose|define|prioritize|execute|implement|develop|assess|evaluate|document|track|measure|monitor|adapt|adjust|escalate|de-escalate|simplify|clarify|articulate|illustrate|connect|link|uncover|reveal|expose|surface|extract|capture|name|label|restate|mirror|acknowledge|interrupt|pause|reset|redirect|flip|invert|plant|seed|earn|secure|protect|defend|block|pre-empt|anticipate|signal|flag|commit|lock|tie|bundle|unbundle|separate|isolate|stack|layer|combine|sequence|time|delay|accelerate|slow|speed|pace|control|manage|own|run|facilitate|orchestrate|coordinate|coach|mentor|advise|guide|steer|navigate|overcome|diagnose|discover|distinguish|recognize|convert|transform|transition|shift|adopt|abandon|replace|supplement|integrate|prioritize|understand|learn|study|research|analyze|plan|design|craft|compose|formulate|construct|organize|arrange|optimize|refine|improve|enhance|strengthen|expand|extend|maintain|sustain|retain|preserve|support|enable|empower|motivate|inspire|encourage|persuade|convince|influence|impact|differentiate|compete|outperform|outpace|surpass|exceed|maximize|minimize|reduce|eliminate|avoid|prevent|mitigate|resolve|fix|repair|recover|restore|rebuild|reinvent|innovate|disrupt|experiment|iterate|prototype|test|validate|verify|check|inspect|audit|review|critique|question|challenge|debate|argue|justify|explain|teach|train|educate|inform|brief|update|report|communicate|present|pitch|sell|promote|market|advertise|brand|package|position|target|segment|personalize|customize|tailor|adapt|modify|change|alter|revise|edit|rewrite|rework|rethink|reconsider|reassess|reevaluate|recalibrate|realign|reprioritize|reallocate|redistribute|restructure|reorganize|reposition|redirect|reroute|reschedule|renegotiate|rethink|reimagine)\b/i;
    if (!verbLedPattern.test(item.title.trim())) {
      // Only reject if the item is also short — longer items with good content should pass
      if ((item.tactic_summary || '').length < 60 && (item.how_to_execute || '').length < 80) {
        return { passed: false, rejectionReason: 'transcript_title_not_verb_led' };
      }
    }
    if (item.tactic_summary.toLowerCase().startsWith(item.title.toLowerCase().slice(0, 25))) return { passed: false, rejectionReason: 'summary_mirrors_title' };
    if (item.how_to_execute.length < 40) return { passed: false, rejectionReason: 'short_how_to_execute_transcript' };
  }

  return { passed: true, rejectionReason: null };
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
// DEPTH SCORING — content-type stratified
// ══════════════════════════════════════════════════════

interface DepthThresholds {
  shallowBelow: number;
  moderateBelow: number;
  underExtracted: (kiCount: number, contentLength: number) => boolean;
}

const DEPTH_THRESHOLDS: Record<ContentCategory, DepthThresholds> = {
  lesson: {
    shallowBelow: 1.0,
    moderateBelow: 2.0,
    underExtracted: (ki, cl) => {
      if (cl >= 5000 && ki <= 8) return true;
      if (cl >= 3000 && ki <= 5) return true;
      if (cl >= 1500 && ki <= 3) return true;
      return cl > 0 && (ki * 1000 / cl) < 1.0;
    },
  },
  transcript: {
    shallowBelow: 0.5,
    moderateBelow: 1.0,
    underExtracted: (ki, cl) => {
      if (cl >= 10000 && ki <= 4) return true;
      if (cl >= 5000 && ki <= 2) return true;
      return cl > 0 && (ki * 1000 / cl) < 0.5;
    },
  },
  document: {
    shallowBelow: 0.75,
    moderateBelow: 1.5,
    underExtracted: (ki, cl) => {
      if (cl >= 5000 && ki <= 6) return true;
      if (cl >= 3000 && ki <= 4) return true;
      if (cl >= 1500 && ki <= 2) return true;
      return cl > 0 && (ki * 1000 / cl) < 1.0;
    },
  },
};

function computeDepthBucket(kiCount: number, contentLength: number, category: ContentCategory): string {
  if (kiCount === 0) return 'none';
  const kisPer1k = contentLength > 0 ? (kiCount * 1000) / contentLength : 0;
  const t = DEPTH_THRESHOLDS[category] || DEPTH_THRESHOLDS.document;
  if (kisPer1k < t.shallowBelow) return 'shallow';
  if (kisPer1k < t.moderateBelow) return 'moderate';
  return 'strong';
}

function computeUnderExtracted(kiCount: number, contentLength: number, category: ContentCategory): boolean {
  const t = DEPTH_THRESHOLDS[category] || DEPTH_THRESHOLDS.document;
  return t.underExtracted(kiCount, contentLength);
}

// ══════════════════════════════════════════════════════
// MULTI-PASS EXTRACTION ENGINE
// ══════════════════════════════════════════════════════

interface MultiPassResult {
  items: any[];
  category: ContentCategory;
  rawCount: number;
  passMetrics: Record<string, number>;
  dedupeResult: DedupeResult;
  validatedCount: number;
  validationRejections: Record<string, number>;
  extractionMode: string;
  passesRun: string[];
  // Model-level metrics (based on validated items, before save)
  modelDepthBucket: string;
  modelUnderExtracted: boolean;
  modelKisPer1k: number;
  summary: string;
  chunksTotal: number;
  chunksProcessed: number;
  chunksFailed: number;
}

async function runMultiPassExtraction(
  apiKey: string,
  content: string,
  title: string,
  description: string | undefined,
  tags: string[],
  resourceType: string | undefined,
  category: ContentCategory,
  deepMode: boolean,
  existingKiContext: string = '',
): Promise<MultiPassResult> {
  const isTranscript = category === 'transcript';
  const baseSystem = isTranscript ? BASE_SYSTEM_PROMPT + TRANSCRIPT_ADDENDUM : BASE_SYSTEM_PROMPT;
  const chunks = chunkContent(content, isTranscript);
  const passesRun: string[] = [];
  const passMetrics: Record<string, number> = {};
  let allCandidates: any[] = [];
  const contentLength = content.length;
  const isRich = contentLength >= 2500;
  let chunksFailed = 0;

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
${existingKiContext}
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
        chunksFailed++;
      }
    }
    return passItems;
  };

  // Pass 1: Core Tactics (always)
  console.log(`[extract-tactics] Pass 1 (core) starting | ${chunks.length} chunk(s) | ${contentLength} chars`);
  const coreItems = await runPass('core');
  passMetrics.core = coreItems.length;
  allCandidates.push(...coreItems);
  passesRun.push('core');

  // Determine if escalation needed
  const pass1Deduped = deduplicateItems(allCandidates, false);
  const pass1Valid = pass1Deduped.kept.filter(it => validateItem(it, isTranscript, false).passed);
  const pass1Depth = computeDepthBucket(pass1Valid.length, contentLength, category);
  const pass1Under = computeUnderExtracted(pass1Valid.length, contentLength, category);
  const shouldEscalate = deepMode || pass1Under || pass1Depth === 'shallow' || (isRich && pass1Valid.length < 6);

  if (shouldEscalate) {
    await new Promise(r => setTimeout(r, 2000));
    const hiddenItems = await runPass('hidden');
    passMetrics.hidden = hiddenItems.length;
    allCandidates.push(...hiddenItems);
    passesRun.push('hidden');

    await new Promise(r => setTimeout(r, 2000));
    const frameworkItems = await runPass('framework');
    passMetrics.framework = frameworkItems.length;
    allCandidates.push(...frameworkItems);
    passesRun.push('framework');
  }

  // Dedupe
  const dedupeResult = deduplicateItems(allCandidates, false);

  // Validate with rejection tracking
  const validationRejections: Record<string, number> = {};
  const validated: any[] = [];
  for (const item of dedupeResult.kept) {
    const v = validateItem(item, isTranscript, false);
    if (v.passed) {
      validated.push(normalizeItem(item, title));
    } else if (v.rejectionReason) {
      validationRejections[v.rejectionReason] = (validationRejections[v.rejectionReason] || 0) + 1;
    }
  }

  const modelKisPer1k = contentLength > 0 ? Math.round((validated.length * 1000 / contentLength) * 100) / 100 : 0;
  const modelDepthBucket = computeDepthBucket(validated.length, contentLength, category);
  const modelUnderExtracted = computeUnderExtracted(validated.length, contentLength, category);
  const extractionMode = shouldEscalate ? 'deep' : 'standard';

  const summary = `${extractionMode}: ${passesRun.join('+')} | ${allCandidates.length} raw → ${dedupeResult.kept.length} deduped → ${validated.length} validated | ${modelKisPer1k} KIs/1k | ${modelDepthBucket}`;
  console.log(`[extract-tactics] FINAL: ${summary}`);

  return {
    items: validated,
    category,
    rawCount: allCandidates.length,
    passMetrics,
    dedupeResult,
    validatedCount: validated.length,
    validationRejections,
    extractionMode,
    passesRun,
    modelDepthBucket,
    modelUnderExtracted,
    modelKisPer1k,
    summary,
    chunksTotal: chunks.length,
    chunksProcessed: chunks.length - chunksFailed,
    chunksFailed,
  };
}

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
): Promise<MultiPassResult> {
  const pipelineLog: any = { stage1_candidates: 0, stage2_raw: 0, recovery_found: 0, recovery_added: 0 };
  const category: ContentCategory = 'lesson';
  const validationRejections: Record<string, number> = {};

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

  const dedupeResult = deduplicateItems(rawItems, true);
  const validated: any[] = [];
  for (const item of dedupeResult.kept) {
    const v = validateItem(item, false, true);
    if (v.passed) {
      validated.push(normalizeItem(item, title));
    } else if (v.rejectionReason) {
      validationRejections[v.rejectionReason] = (validationRejections[v.rejectionReason] || 0) + 1;
    }
  }

  // Recovery pass — deterministic merge (sort by title before combining)
  let recoveryAdded = 0;
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
        const recoveryRaw = parseAiResponse(recoveryResult);
        
        // Count recovery validation rejections into the same tracker
        const recoveryValidated: any[] = [];
        for (const it of recoveryRaw) {
          const v = validateItem(it, false, true);
          if (v.passed) {
            recoveryValidated.push(normalizeItem(it, title));
          } else if (v.rejectionReason) {
            validationRejections[v.rejectionReason] = (validationRejections[v.rejectionReason] || 0) + 1;
          }
        }

        // Deterministic merge: combine all, sort by title, then dedupe
        const combined = [...validated, ...recoveryValidated].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        const finalDeduped = deduplicateItems(combined, true);
        recoveryAdded = finalDeduped.kept.length - validated.length;
        // Replace validated with deterministic result
        validated.length = 0;
        validated.push(...finalDeduped.kept);
      } catch (err) { console.error('[extract-tactics] Recovery failed:', err); }
    }
  }
  pipelineLog.recovery_added = recoveryAdded;

  const modelKisPer1k = content.length > 0 ? Math.round((validated.length * 1000 / content.length) * 100) / 100 : 0;
  const modelDepthBucket = computeDepthBucket(validated.length, content.length, category);
  const modelUnderExtracted = computeUnderExtracted(validated.length, content.length, category);

  const summary = `lesson: ${candidates.length} enumerated → ${rawItems.length} expanded → ${dedupeResult.kept.length} deduped → ${validated.length} validated | +${recoveryAdded} recovery | ${modelKisPer1k} KIs/1k | ${modelDepthBucket}`;

  return {
    items: validated,
    category,
    rawCount: rawItems.length,
    passMetrics: { enumerate: candidates.length, expand: rawItems.length, recovery: recoveryAdded },
    dedupeResult,
    validatedCount: validated.length,
    validationRejections,
    extractionMode: 'standard',
    passesRun: ['lesson_enumerate', 'lesson_expand', 'lesson_recovery'],
    modelDepthBucket,
    modelUnderExtracted,
    modelKisPer1k,
    summary,
    chunksTotal: 1,
    chunksProcessed: 1,
    chunksFailed: 0,
  };
}

// ══════════════════════════════════════════════════════
// SERVER-SIDE KI SAVE + RUN RECORD + RESOURCE UPDATE
// ══════════════════════════════════════════════════════

interface PersistenceResult {
  runId: string;
  savedCount: number;
  activeCount: number;
  status: 'completed' | 'partial' | 'failed';
  error: string | null;
  duplicatesSkipped: number;
  currentResourceKiCount: number;
  currentKisPer1k: number;
}

async function serverSidePersist(
  supabaseAdmin: any,
  resourceId: string,
  userId: string,
  result: MultiPassResult,
  contentLength: number,
  startedAt: number,
  skipResourceSnapshotUpdate = false,
): Promise<PersistenceResult> {
  const runId = crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const category = result.category;
  console.log(`[extract-tactics] PERSIST START: resource=${resourceId} | ${result.validatedCount} validated items | ${contentLength} chars`);

  // ── Step 1: Fetch existing KIs for this resource to check for duplicates ──
  const { data: existingKIs } = await supabaseAdmin
    .from('knowledge_items')
    .select('id, title, tactic_summary, user_edited')
    .eq('source_resource_id', resourceId)
    .eq('user_id', userId);

  const existingFingerprints = new Set<string>();
  const userEditedIds = new Set<string>();
  for (const ki of (existingKIs || [])) {
    existingFingerprints.add(computeKiFingerprint(resourceId, ki.title, ki.tactic_summary));
    if (ki.user_edited) userEditedIds.add(ki.id);
  }

  // ── Step 2: Filter out duplicates, build KI rows ──
  let duplicatesSkipped = 0;
  const kiRows: any[] = [];
  
  for (const item of result.items) {
    const fp = computeKiFingerprint(resourceId, item.title || '', item.tactic_summary || '');
    if (existingFingerprints.has(fp)) {
      duplicatesSkipped++;
      continue;
    }
    existingFingerprints.add(fp); // prevent intra-batch duplicates too

    kiRows.push({
      id: crypto.randomUUID(),
      user_id: userId,
      source_resource_id: resourceId,
      source_doctrine_id: null,
      ki_fingerprint: fp,
      title: item.title || 'Untitled',
      knowledge_type: item.knowledge_type || 'skill',
      chapter: item.chapter || 'messaging',
      sub_chapter: item.sub_chapter || null,
      competitor_name: item.competitor_name || null,
      product_area: item.product_area || null,
      applies_to_contexts: item.applies_to_contexts || ['dave', 'playbooks'],
      tactic_summary: item.tactic_summary || '',
      why_it_matters: item.why_it_matters || null,
      when_to_use: item.when_to_use || null,
      when_not_to_use: item.when_not_to_use || null,
      example_usage: item.example_usage || null,
      macro_situation: item.macro_situation || null,
      micro_strategy: item.micro_strategy || null,
      how_to_execute: item.how_to_execute || null,
      what_this_unlocks: item.what_this_unlocks || null,
      source_excerpt: item.source_excerpt || null,
      source_title: item.source_title || null,
      source_location: item.source_location || null,
      confidence_score: typeof item.confidence_score === 'number' ? item.confidence_score : 0.7,
      status: 'extracted',
      active: false,
      user_edited: false,
      tags: Array.isArray(item.tags) ? item.tags : [],
      who: item.who || 'Unknown',
      framework: item.framework || 'General',
      review_status: 'pending',
      source_heading: item.source_heading || null,
      source_segment_index: item.source_segment_index || null,
      source_char_range: item.source_char_range || null,
      challenger_type: item.challenger_type || null,
      activation_metadata: item.activation_metadata || null,
      extraction_method: 'llm',
    });
  }

  let savedCount = 0;
  let activeCount = 0;
  let status: 'completed' | 'partial' | 'failed' = 'completed';
  let error: string | null = null;

  console.log(`[extract-tactics] PERSIST: ${kiRows.length} rows to save, ${duplicatesSkipped} pre-filtered as dupes`);

  try {
    if (kiRows.length === 0) {
      status = duplicatesSkipped > 0 ? 'completed' : (result.validatedCount > 0 ? 'failed' : 'completed');
      console.log(`[extract-tactics] PERSIST: 0 rows to save (${duplicatesSkipped} dupes skipped)`);
    } else {
      // Save KIs in batches of 50 — DB unique index on (user_id, ki_fingerprint) is the final guard
      for (let i = 0; i < kiRows.length; i += 50) {
        const batch = kiRows.slice(i, i + 50);
        const { error: insertErr, data: inserted } = await supabaseAdmin
          .from('knowledge_items')
          .insert(batch)
          .select('id');
        if (insertErr) {
          // Check if it's a unique constraint violation (DB-level duplicate catch)
          if (insertErr.code === '23505' && insertErr.message?.includes('fingerprint')) {
            console.log(`[extract-tactics] DB-level duplicate caught, falling back to one-by-one insert`);
            // Insert one-by-one, skip DB-level duplicates
            for (const row of batch) {
              const { error: singleErr, data: singleInserted } = await supabaseAdmin
                .from('knowledge_items')
                .insert(row)
                .select('id');
              if (singleErr) {
                if (singleErr.code === '23505') { duplicatesSkipped++; continue; }
                console.error(`[extract-tactics] Single KI save error:`, singleErr);
              } else {
                savedCount += singleInserted?.length ?? 1;
              }
            }
          } else {
            console.error(`[extract-tactics] KI save batch error:`, insertErr);
            error = insertErr.message;
            status = savedCount > 0 ? 'partial' : 'failed';
            break;
          }
        } else {
          savedCount += inserted?.length ?? batch.length;
          console.log(`[extract-tactics] PERSIST: batch saved ${inserted?.length ?? batch.length} KIs (total so far: ${savedCount})`);
        }
      }
    }

    // Activate high-quality items
    if (savedCount > 0) {
      const ACTIVATION_THRESHOLD = 0.6;
      const activatableIds = kiRows
        .filter(ki => ki.confidence_score >= ACTIVATION_THRESHOLD &&
          ki.tactic_summary.length >= 80 &&
          (ki.how_to_execute?.length ?? 0) >= 80)
        .map(ki => ki.id);

      if (activatableIds.length > 0) {
        const { error: activateErr } = await supabaseAdmin
          .from('knowledge_items')
          .update({ active: true, status: 'active' })
          .in('id', activatableIds);
        if (!activateErr) activeCount = activatableIds.length;
      }
    }

    if (kiRows.length > 0 && savedCount === 0) {
      status = 'failed';
      error = error || 'All KI saves failed';
    } else if (kiRows.length > 0 && savedCount < kiRows.length) {
      status = 'partial';
    }
  } catch (err: any) {
    status = 'failed';
    error = err.message;
  }

  // ── Compute CURRENT RESOURCE totals (not just this run) ──
  const { count: currentResourceKiCount } = await supabaseAdmin
    .from('knowledge_items')
    .select('*', { count: 'exact', head: true })
    .eq('source_resource_id', resourceId)
    .eq('user_id', userId);
  
  const totalKIs = currentResourceKiCount ?? 0;
  const currentKisPer1k = contentLength > 0 ? Math.round((totalKIs * 1000 / contentLength) * 100) / 100 : 0;
  const currentDepthBucket = computeDepthBucket(totalKIs, contentLength, category);
  const currentUnderExtracted = computeUnderExtracted(totalKIs, contentLength, category);

  // Run-level metrics (what THIS run produced)
  const runSavedKisPer1k = contentLength > 0 ? Math.round((savedCount * 1000 / contentLength) * 100) / 100 : 0;

  const finalSummary = `${result.extractionMode}: ${result.passesRun.join('+')} | ${result.rawCount} raw → ${result.dedupeResult.kept.length} deduped → ${result.validatedCount} validated → ${savedCount} saved (${duplicatesSkipped} dupes skipped) | resource total: ${totalKIs} KIs, ${currentKisPer1k} KIs/1k | ${currentDepthBucket}`;
  console.log(`[extract-tactics] PERSIST COMPLETE: ${finalSummary}`);

  // Create extraction_run record
  try {
    await supabaseAdmin.from('extraction_runs').insert({
      id: runId,
      resource_id: resourceId,
      user_id: userId,
      started_at: new Date(startedAt).toISOString(),
      completed_at: completedAt,
      duration_ms: durationMs,
      status,
      extraction_method: 'llm',
      extraction_mode: result.extractionMode,
      model: MODEL_NAME,
      passes_run: result.passesRun,
      chunks_total: result.chunksTotal,
      chunks_processed: result.chunksProcessed,
      chunks_failed: result.chunksFailed,
      raw_candidate_counts: result.passMetrics,
      merged_candidate_count: result.dedupeResult.kept.length,
      validated_candidate_count: result.validatedCount,
      saved_candidate_count: savedCount,
      kis_per_1k_chars: runSavedKisPer1k,
      extraction_depth_bucket: currentDepthBucket,
      under_extracted_flag: currentUnderExtracted,
      validation_rejection_counts: result.validationRejections,
      dedupe_merge_counts: result.dedupeResult.details,
      error_message: error,
      summary: finalSummary,
    });
  } catch (runErr) {
    console.error('[extract-tactics] Failed to create extraction_run:', runErr);
  }

  // ── Update resource snapshot ──
  if (!skipResourceSnapshotUpdate) {
    try {
      let enrichmentStatusUpdate: string | undefined;
      if (status === 'completed' && savedCount > 0) {
        enrichmentStatusUpdate = 'deep_enriched';
      } else if (status === 'partial' && savedCount > 0) {
        enrichmentStatusUpdate = 'enriched';
      }

      let jobStatus: string;
      if (status === 'completed') jobStatus = 'succeeded';
      else if (status === 'partial') jobStatus = 'partial';
      else jobStatus = 'failed';

      const resourceUpdate: Record<string, any> = {
        // Last run metrics
        last_extraction_run_id: runId,
        last_extraction_run_status: status,
        last_extraction_returned_ki_count: result.rawCount,
        last_extraction_deduped_ki_count: result.dedupeResult.kept.length,
        last_extraction_validated_ki_count: result.validatedCount,
        last_extraction_saved_ki_count: savedCount,
        last_extraction_error: error,
        last_extraction_started_at: new Date(startedAt).toISOString(),
        last_extraction_completed_at: completedAt,
        last_extraction_duration_ms: durationMs,
        last_extraction_model: MODEL_NAME,
        // Current resource coverage (total truth)
        current_resource_ki_count: totalKIs,
        current_resource_kis_per_1k: currentKisPer1k,
        // Depth and mode
        extraction_mode: result.extractionMode,
        extraction_passes_run: result.passesRun,
        kis_per_1k_chars: currentKisPer1k,
        extraction_depth_bucket: currentDepthBucket,
        under_extracted_flag: currentUnderExtracted,
        last_extraction_summary: finalSummary,
        extraction_method: 'llm',
        active_job_status: jobStatus,
      };
      if (enrichmentStatusUpdate) {
        resourceUpdate.enrichment_status = enrichmentStatusUpdate;
      }

      await supabaseAdmin.from('resources').update(resourceUpdate).eq('id', resourceId);
    } catch (resErr) {
      console.error('[extract-tactics] Failed to update resource:', resErr);
    }
  }

  return { runId, savedCount, activeCount, status, error, duplicatesSkipped, currentResourceKiCount: totalKIs, currentKisPer1k };
}

// ══════════════════════════════════════════════════════
// DB-AUTHORITATIVE RESOURCE SNAPSHOT RECONCILIATION
// Used at end of every job-mode invocation to ensure
// resource fields reflect durable truth.
// ══════════════════════════════════════════════════════

async function reconcileResourceSnapshot(
  supabaseAdmin: any,
  resourceId: string,
  userId: string,
  fullLength: number,
  totalBatches: number,
  category: ContentCategory,
  allComplete: boolean,
  stoppedByWatchdog = false,
  lastError: string | null = null,
): Promise<void> {
  console.log(`[SNAPSHOT RECONCILE] start | resource=${resourceId} | allComplete=${allComplete}`);

  // Count actual KIs from knowledge_items table
  const { count: finalKiCount } = await supabaseAdmin
    .from('knowledge_items')
    .select('*', { count: 'exact', head: true })
    .eq('source_resource_id', resourceId)
    .eq('user_id', userId);
  const finalTotal = finalKiCount ?? 0;
  const finalKisPer1k = fullLength > 0 ? Math.round((finalTotal * 1000 / fullLength) * 100) / 100 : 0;

  // Count actual extraction_runs
  const { count: totalRunCount } = await supabaseAdmin
    .from('extraction_runs')
    .select('*', { count: 'exact', head: true })
    .eq('resource_id', resourceId);

  // Count completed batches from extraction_batches
  const { count: completedBatchCount } = await supabaseAdmin
    .from('extraction_batches')
    .select('*', { count: 'exact', head: true })
    .eq('resource_id', resourceId)
    .eq('status', 'completed');
  const actualCompleted = completedBatchCount ?? 0;

  // Find next incomplete batch
  const { data: incompleteBatches } = await supabaseAdmin
    .from('extraction_batches')
    .select('batch_index')
    .eq('resource_id', resourceId)
    .neq('status', 'completed')
    .order('batch_index', { ascending: true })
    .limit(1);
  const nextIncompleteBatch = incompleteBatches?.[0]?.batch_index;

  const depthBucket = computeDepthBucket(finalTotal, fullLength, category);
  const underExtracted = computeUnderExtracted(finalTotal, fullLength, category);

  const update: Record<string, any> = {
    active_job_updated_at: new Date().toISOString(),
    current_resource_ki_count: finalTotal,
    current_resource_kis_per_1k: finalKisPer1k,
    kis_per_1k_chars: finalKisPer1k,
    extraction_depth_bucket: depthBucket,
    under_extracted_flag: underExtracted,
    extraction_attempt_count: totalRunCount ?? 0,
    extraction_batches_completed: actualCompleted,
    extraction_batch_total: totalBatches,
  };

  if (allComplete) {
    update.active_job_status = 'succeeded';
    update.active_job_finished_at = new Date().toISOString();
    update.extraction_is_resumable = false;
    update.extraction_batch_status = 'completed';
    update.last_extraction_run_status = 'completed';
    update.last_extraction_summary = `Job mode complete: ${totalBatches} batches, ${finalTotal} KIs, ${finalKisPer1k} KIs/1k`;
  } else {
    // Still incomplete — mark as partial/resumable but NOT running
    // (running state is only for active processing within an invocation)
    update.active_job_status = stoppedByWatchdog ? 'running' : 'partial'; // keep running if continuation expected
    update.extraction_is_resumable = true;
    update.extraction_batch_status = nextIncompleteBatch != null
      ? `resume_from_batch_${nextIncompleteBatch + 1}_of_${totalBatches}`
      : `partial_${actualCompleted}_of_${totalBatches}`;
    update.last_extraction_run_status = 'partial_complete_resumable';
    update.last_extraction_summary = `Job mode partial: ${actualCompleted}/${totalBatches} batches, ${finalTotal} KIs. ${stoppedByWatchdog ? 'Watchdog stopped — continuation dispatched.' : `Error: ${lastError || 'unknown'}`}`;
  }

  await supabaseAdmin.from('resources').update(update).eq('id', resourceId);
  console.log(`[SNAPSHOT RECONCILE] done | KIs=${finalTotal} | KIs/1k=${finalKisPer1k} | runs=${totalRunCount} | batches=${actualCompleted}/${totalBatches} | status=${update.active_job_status}`);
}

// ══════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Auth check
    const batchKey = req.headers.get('x-batch-key');
    const isServiceRole = batchKey != null && batchKey === serviceRoleKey;
    let userId: string | null = null;

    if (isServiceRole) {
      // Service role — userId must come from body
    } else {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    }

    const body = await req.json();
    let { title, content, description, tags, resourceType, deepMode, resourceId, userId: bodyUserId, persist,
      // Chunked extraction params
      contentSliceStart, contentSliceEnd, batchIndex, batchTotal, skipPersistResourceUpdate,
      // Job mode: server-side multi-batch orchestration
      jobMode,
      // Continuation token: set by self-invoke to bypass idempotency guard
      isContinuation,
    } = body;

    // Resolve userId
    if (!userId) userId = bodyUserId;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── AUTO-FETCH: if resourceId provided but no content, fetch from DB ──
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    let fullContentLength = 0; // track total resource length for density calc
    if (resourceId && (!content || content.length < 100)) {
      console.log(`[extract-tactics] No content in body, fetching resource ${resourceId} from DB`);
      const { data: resource, error: fetchErr } = await supabaseAdmin
        .from('resources')
        .select('title, content, description, tags, resource_type, content_length')
        .eq('id', resourceId)
        .single();

      if (fetchErr || !resource) {
        console.error('[extract-tactics] Failed to fetch resource:', fetchErr);
        return new Response(JSON.stringify({ error: 'Resource not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      title = title || resource.title;
      content = resource.content;
      fullContentLength = (content || '').length;
      description = description || resource.description;
      tags = tags || resource.tags;
      resourceType = resourceType || resource.resource_type;
      console.log(`[extract-tactics] Fetched resource: "${title}" | ${fullContentLength} chars`);

      // ── CONTENT SLICING for chunked extraction ──
      if (typeof contentSliceStart === 'number' && typeof contentSliceEnd === 'number' && content) {
        content = content.slice(contentSliceStart, contentSliceEnd);
        console.log(`[extract-tactics] BATCH ${batchIndex ?? '?'}/${batchTotal ?? '?'}: sliced chars ${contentSliceStart}-${contentSliceEnd} (${content.length} chars)`);
      }
    } else {
      fullContentLength = (content || '').length;
    }

    if (!content || content.length < 100) {
      return new Response(JSON.stringify({
        items: [],
        chunks_total: 0,
        chunks_processed: 0,
        chunks_failed: 0,
        model_metrics: { raw_count: 0, deduped_count: 0, validated_count: 0 },
        saved_metrics: null,
        persistence: null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    // ══════════════════════════════════════════════════════
    // JOB MODE — server-side multi-batch orchestration
    // Processes ALL remaining batches autonomously.
    // Includes: heartbeat, stale-batch reconciliation,
    // idempotency guard (with continuation bypass),
    // self-invoke continuation via service role,
    // and DB-authoritative snapshot reconciliation.
    // ══════════════════════════════════════════════════════
    if (jobMode && resourceId) {
      console.log(`[JOB MODE] start | resource=${resourceId} | isContinuation=${!!isContinuation}`);
      const JOB_WATCHDOG_MS = 4.5 * 60 * 1000; // 4.5 min cap
      const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min = stale
      const jobStart = Date.now();

      // ── IDEMPOTENCY GUARD (skipped for self-invoke continuations) ──
      if (!isContinuation) {
        const { data: currentResource } = await supabaseAdmin
          .from('resources')
          .select('active_job_status, active_job_updated_at, active_job_started_at, title, extraction_batches_completed, extraction_batch_total')
          .eq('id', resourceId)
          .single();

        if (currentResource?.active_job_status === 'running') {
          const lastUpdate = currentResource.active_job_updated_at
            ? new Date(currentResource.active_job_updated_at).getTime()
            : currentResource.active_job_started_at
            ? new Date(currentResource.active_job_started_at).getTime()
            : 0;
          const staleness = Date.now() - lastUpdate;

          if (staleness < STALE_THRESHOLD_MS) {
            console.log(`[IDEMPOTENCY] REJECT: resource=${resourceId} already running (${Math.round(staleness / 1000)}s ago)`);
            return new Response(JSON.stringify({
              status: 'already_running',
              resourceId,
              message: 'Extraction already in progress',
              stalenessMs: staleness,
              completedBatches: currentResource.extraction_batches_completed,
              totalBatches: currentResource.extraction_batch_total,
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          } else {
            console.log(`[IDEMPOTENCY] stale running reconciled | resource=${resourceId} | stale for ${Math.round(staleness / 1000)}s — clearing and continuing`);
          }
        }
      } else {
        console.log(`[JOB MODE] continuation picked up | resource=${resourceId}`);
      }

      // ── Heartbeat helper ──
      const updateHeartbeat = async (statusNote: string) => {
        await supabaseAdmin.from('resources').update({
          active_job_updated_at: new Date().toISOString(),
          extraction_batch_status: statusNote,
        }).eq('id', resourceId);
      };

      // Fetch full content
      const fullContent = content;
      const fullLength = fullContentLength || fullContent.length;
      const category = classifyContentCategory(fullContent, title, resourceType);

      // ── STALE BATCH RECONCILIATION ──
      const { data: staleRunningBatches } = await supabaseAdmin
        .from('extraction_batches')
        .select('batch_index, started_at')
        .eq('resource_id', resourceId)
        .eq('status', 'running');

      if (staleRunningBatches && staleRunningBatches.length > 0) {
        for (const staleBatch of staleRunningBatches) {
          const batchAge = Date.now() - new Date(staleBatch.started_at || 0).getTime();
          if (batchAge > STALE_THRESHOLD_MS) {
            console.log(`[JOB MODE] stale running reconciled | batch ${staleBatch.batch_index} stuck for ${Math.round(batchAge / 1000)}s — marking pending`);
            await supabaseAdmin.from('extraction_batches').update({
              status: 'pending',
              error: `Stale lock cleared after ${Math.round(batchAge / 1000)}s`,
            }).eq('resource_id', resourceId).eq('batch_index', staleBatch.batch_index);
          }
        }
      }

      // Get batch ledger from DB
      const { data: ledgerRows } = await supabaseAdmin
        .from('extraction_batches')
        .select('*')
        .eq('resource_id', resourceId)
        .order('batch_index', { ascending: true });

      // Compute semantic slices
      let slices: { start: number; end: number; semanticStartMarker: string; semanticEndMarker: string }[] = [];
      let ledgerBatchTotal = 0;

      if (ledgerRows && ledgerRows.length > 0) {
        for (const b of ledgerRows) {
          slices.push({
            start: b.char_start,
            end: b.char_end,
            semanticStartMarker: b.semantic_start_marker || `(batch ${b.batch_index + 1} start)`,
            semanticEndMarker: b.semantic_end_marker || `(batch ${b.batch_index + 1} end)`,
          });
        }
        ledgerBatchTotal = Math.max(...ledgerRows.map((b: any) => b.batch_total || b.batch_index + 1));
        if (slices.length < ledgerBatchTotal) {
          let pos = slices.length > 0 ? slices[slices.length - 1].end : 0;
          for (let i = slices.length; i < ledgerBatchTotal && pos < fullLength; i++) {
            const chunkSize = Math.ceil((fullLength - pos) / (ledgerBatchTotal - i));
            slices.push({
              start: pos,
              end: Math.min(pos + chunkSize, fullLength),
              semanticStartMarker: `(batch ${i + 1} start)`,
              semanticEndMarker: `(batch ${i + 1} end)`,
            });
            pos += chunkSize;
          }
        }
      } else {
        const isTranscript = category === 'transcript';
        const chunks = chunkContent(fullContent, isTranscript);
        let pos = 0;
        for (let i = 0; i < chunks.length; i++) {
          const chunkLen = chunks[i].length;
          const startIdx = fullContent.indexOf(chunks[i].slice(0, 100), Math.max(0, pos - 200));
          const actualStart = startIdx >= 0 ? startIdx : pos;
          const actualEnd = Math.min(actualStart + chunkLen, fullLength);
          slices.push({
            start: actualStart,
            end: actualEnd,
            semanticStartMarker: `(batch ${i + 1} start)`,
            semanticEndMarker: `(batch ${i + 1} end)`,
          });
          pos = actualEnd;
        }
        ledgerBatchTotal = slices.length;
      }

      const totalBatches = Math.max(ledgerBatchTotal, slices.length);
      const completedSet = new Set(
        (ledgerRows || []).filter((b: any) => b.status === 'completed').map((b: any) => b.batch_index)
      );

      // If all batches already done, reconcile and return
      if (completedSet.size >= totalBatches) {
        console.log(`[JOB MODE] All ${totalBatches} batches already complete — reconciling snapshot`);
        await reconcileResourceSnapshot(supabaseAdmin, resourceId, userId!, fullLength, totalBatches, category, true);
        return new Response(JSON.stringify({
          jobMode: true, allComplete: true, batchesProcessedThisRun: 0, totalBatches,
          completedBatches: totalBatches, totalSaved: 0, stoppedByWatchdog: false, error: null,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Mark resource as running with heartbeat
      await supabaseAdmin.from('resources').update({
        active_job_status: 'running',
        active_job_started_at: isContinuation ? undefined : new Date().toISOString(),
        active_job_updated_at: new Date().toISOString(),
        extraction_batch_status: `job_mode_running`,
        extraction_is_resumable: true,
        extraction_batch_total: totalBatches,
      }).eq('id', resourceId);

      let batchesProcessedThisJob = 0;
      let totalSaved = 0;
      let lastError: string | null = null;
      let consecutiveFailures = 0;
      let stoppedByWatchdog = false;

      for (let batchIdx = 0; batchIdx < slices.length; batchIdx++) {
        if (completedSet.has(batchIdx)) {
          console.log(`[JOB MODE] Skipping batch ${batchIdx + 1}/${totalBatches} — already completed`);
          continue;
        }

        // Watchdog: check time budget BEFORE starting batch
        const elapsed = Date.now() - jobStart;
        if (elapsed > JOB_WATCHDOG_MS) {
          console.log(`[JOB MODE] watchdog stop | ${batchesProcessedThisJob} batches in ${Math.round(elapsed / 1000)}s — will self-invoke`);
          stoppedByWatchdog = true;
          break;
        }

        const slice = slices[batchIdx];
        const batchContent = fullContent.slice(slice.start, slice.end);
        if (batchContent.length < 50) {
          console.log(`[JOB MODE] Skipping batch ${batchIdx + 1} — content too short (${batchContent.length} chars)`);
          completedSet.add(batchIdx);
          continue;
        }

        console.log(`[JOB MODE] batch started | ${batchIdx + 1}/${totalBatches} | chars ${slice.start}-${slice.end} (${batchContent.length} chars) | elapsed=${Math.round(elapsed / 1000)}s`);

        // Mark batch as running + heartbeat
        await supabaseAdmin.from('extraction_batches').upsert({
          resource_id: resourceId, user_id: userId,
          batch_index: batchIdx, batch_total: totalBatches,
          char_start: slice.start, char_end: slice.end,
          semantic_start_marker: slice.semanticStartMarker,
          semantic_end_marker: slice.semanticEndMarker,
          status: 'running', started_at: new Date().toISOString(),
        }, { onConflict: 'resource_id,batch_index' });

        await updateHeartbeat(`running_batch_${batchIdx + 1}_of_${totalBatches}`);

        try {
          // Refresh existing KI context
          let batchExistingKiContext = '';
          const { data: existingKIs } = await supabaseAdmin
            .from('knowledge_items')
            .select('title')
            .eq('source_resource_id', resourceId)
            .eq('user_id', userId)
            .limit(150);
          if (existingKIs && existingKIs.length > 0) {
            batchExistingKiContext = `\n\nALREADY EXTRACTED (${existingKIs.length} KIs — do NOT repeat):\n` +
              existingKIs.map((ki: any, i: number) => `${i + 1}. ${ki.title}`).join('\n') + '\n';
          }

          const batchResult = await runMultiPassExtraction(
            LOVABLE_API_KEY, batchContent, title, description, tags || [],
            resourceType, category, false, batchExistingKiContext,
          );

          const batchPersist = await serverSidePersist(
            supabaseAdmin, resourceId, userId!, batchResult,
            fullLength, Date.now(), true,
          );

          // Update batch ledger
          await supabaseAdmin.from('extraction_batches').upsert({
            resource_id: resourceId, user_id: userId,
            extraction_run_id: batchPersist.runId,
            batch_index: batchIdx, batch_total: totalBatches,
            char_start: slice.start, char_end: slice.end,
            semantic_start_marker: slice.semanticStartMarker,
            semantic_end_marker: slice.semanticEndMarker,
            status: batchPersist.status === 'completed' ? 'completed' : 'failed',
            raw_count: batchResult.rawCount,
            validated_count: batchResult.validatedCount,
            saved_count: batchPersist.savedCount,
            duplicates_skipped: batchPersist.duplicatesSkipped,
            cumulative_resource_ki_count: batchPersist.currentResourceKiCount,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            error: batchPersist.error,
          }, { onConflict: 'resource_id,batch_index' });

          completedSet.add(batchIdx);
          batchesProcessedThisJob++;
          totalSaved += batchPersist.savedCount;
          consecutiveFailures = 0;

          // Heartbeat + progress
          await supabaseAdmin.from('resources').update({
            active_job_updated_at: new Date().toISOString(),
            extraction_batches_completed: completedSet.size,
            current_resource_ki_count: batchPersist.currentResourceKiCount,
            current_resource_kis_per_1k: batchPersist.currentKisPer1k,
            kis_per_1k_chars: batchPersist.currentKisPer1k,
            extraction_depth_bucket: computeDepthBucket(batchPersist.currentResourceKiCount, fullLength, category),
            under_extracted_flag: computeUnderExtracted(batchPersist.currentResourceKiCount, fullLength, category),
            extraction_batch_status: `completed_batch_${batchIdx + 1}_of_${totalBatches}`,
          }).eq('id', resourceId);

          console.log(`[JOB MODE] batch completed | ${batchIdx + 1}/${totalBatches} | saved=${batchPersist.savedCount} total=${batchPersist.currentResourceKiCount}`);

          if (batchIdx < slices.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (err: any) {
          lastError = err.message;
          consecutiveFailures++;
          console.error(`[JOB MODE] batch failure | ${batchIdx + 1}/${totalBatches} | error=${err.message}`);

          await supabaseAdmin.from('extraction_batches').upsert({
            resource_id: resourceId, user_id: userId,
            batch_index: batchIdx, batch_total: totalBatches,
            char_start: slice.start, char_end: slice.end,
            status: 'failed', error: err.message,
            completed_at: new Date().toISOString(),
          }, { onConflict: 'resource_id,batch_index' });

          if (consecutiveFailures >= 2) {
            console.log(`[JOB MODE] Stopping: 2 consecutive failures`);
            break;
          }
        }
      }

      // ── FINAL SNAPSHOT RECONCILIATION (DB-authoritative) ──
      const allComplete = completedSet.size >= totalBatches;
      await reconcileResourceSnapshot(supabaseAdmin, resourceId, userId!, fullLength, totalBatches, category, allComplete, stoppedByWatchdog, lastError);

      console.log(`[JOB MODE] DONE: ${completedSet.size}/${totalBatches} batches, ${batchesProcessedThisJob} processed this run, ${totalSaved} saved, allComplete=${allComplete}`);

      // ── SELF-INVOKE CONTINUATION (if not all complete) ──
      if (!allComplete && !consecutiveFailures) {
        // Use service role key for self-invoke (user JWT may expire during long runs)
        console.log(`[JOB MODE] self-invoke: ${totalBatches - completedSet.size} batches remaining`);
        try {
          const selfUrl = `${supabaseUrl}/functions/v1/extract-tactics`;
          const selfResp = await fetch(selfUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
              'x-batch-key': serviceRoleKey,
            },
            body: JSON.stringify({
              resourceId,
              userId,
              deepMode: true,
              persist: true,
              jobMode: true,
              isContinuation: true,
            }),
          });
          const selfBody = await selfResp.text();
          console.log(`[JOB MODE] self-invoke ${selfResp.ok ? 'success' : 'failure'} | status=${selfResp.status} | body=${selfBody.slice(0, 200)}`);
        } catch (e: any) {
          console.error(`[JOB MODE] self-invoke failure: ${e.message}`);
          // Mark resource as resumable since continuation failed
          await supabaseAdmin.from('resources').update({
            active_job_status: 'partial',
            extraction_is_resumable: true,
            last_extraction_summary: `Partial: ${completedSet.size}/${totalBatches} batches. Self-invoke failed: ${e.message}`,
          }).eq('id', resourceId);
        }
      } else if (!allComplete && consecutiveFailures >= 2) {
        console.log(`[JOB MODE] NOT self-invoking: stopped due to ${consecutiveFailures} consecutive failures`);
      }

      // Read back final state for response
      const { data: finalRes } = await supabaseAdmin
        .from('resources')
        .select('current_resource_ki_count, current_resource_kis_per_1k')
        .eq('id', resourceId)
        .single();

      return new Response(JSON.stringify({
        jobMode: true,
        allComplete,
        batchesProcessedThisRun: batchesProcessedThisJob,
        totalBatches,
        completedBatches: completedSet.size,
        totalSaved,
        currentResourceKiCount: finalRes?.current_resource_ki_count ?? 0,
        currentKisPer1k: finalRes?.current_resource_kis_per_1k ?? 0,
        stoppedByWatchdog,
        error: lastError,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ══════════════════════════════════════════════════════
    // STANDARD MODE — single batch/extraction (existing behavior)
    // ══════════════════════════════════════════════════════

    // ── EXISTING KI AWARENESS: tell the model what already exists for this resource ──
    let existingKiContext = '';
    if (deepMode && resourceId) {
      const { data: existingKIs } = await supabaseAdmin
        .from('knowledge_items')
        .select('title, tactic_summary')
        .eq('source_resource_id', resourceId)
        .eq('user_id', userId)
        .limit(100);
      if (existingKIs && existingKIs.length > 0) {
        existingKiContext = `\n\nALREADY EXTRACTED (${existingKIs.length} KIs exist for this resource — do NOT repeat these, find NEW insights):\n` +
          existingKIs.map((ki: any, i: number) => `${i + 1}. ${ki.title}`).join('\n') +
          '\n\nFocus on concepts, frameworks, tactics, and insights NOT covered above. Go deeper into sections that were under-explored.\n';
      }
    }

    // Classify content category once, pass through entire pipeline
    const category = classifyContentCategory(content, title, resourceType);

    // For batch slices: force single-pass core-only to stay within edge function timeout
    const isBatchSlice = typeof contentSliceStart === 'number' && typeof contentSliceEnd === 'number';
    const effectiveDeepMode = isBatchSlice ? false : !!deepMode;

    let result: MultiPassResult;

    if (category === 'lesson' && !isBatchSlice) {
      const cleanedContent = prepareLessonContent(content, title);
      console.log(`[extract-tactics] LESSON: "${title}" | ${cleanedContent.length} chars`);
      result = await extractLessonTwoStage(LOVABLE_API_KEY, cleanedContent, title, description, tags, resourceType);
    } else {
      const isTranscript = category === 'transcript';
      console.log(`[extract-tactics] ${isTranscript ? 'TRANSCRIPT' : 'DOCUMENT'} ${isBatchSlice ? 'BATCH-SLICE single-pass' : 'multi-pass'} | ${content.length} chars | deepMode=${effectiveDeepMode} | existingKIs=${existingKiContext ? 'yes' : 'no'}`);
      result = await runMultiPassExtraction(LOVABLE_API_KEY, content, title, description, tags || [], resourceType, category, effectiveDeepMode, existingKiContext);
    }

    // Server-side persistence when resourceId is provided
    const shouldPersist = persist !== false && resourceId;
    let persistResult: PersistenceResult | null = null;

    // isBatchSlice already declared above

    if (shouldPersist) {
      if (batchIndex != null && batchTotal != null) {
        const semanticStartMarker = body.semanticStartMarker || `char ${contentSliceStart}`;
        const semanticEndMarker = body.semanticEndMarker || `char ${contentSliceEnd}`;
        await supabaseAdmin.from('extraction_batches').upsert({
          resource_id: resourceId,
          user_id: userId,
          extraction_run_id: null,
          batch_index: batchIndex,
          batch_total: batchTotal,
          char_start: contentSliceStart ?? 0,
          char_end: contentSliceEnd ?? 0,
          semantic_start_marker: semanticStartMarker,
          semantic_end_marker: semanticEndMarker,
          status: 'running',
          started_at: new Date(startedAt).toISOString(),
          completed_at: null,
          error: null,
        }, { onConflict: 'resource_id,batch_index' });

        await supabaseAdmin.from('resources').update({
          extraction_batch_total: batchTotal,
          extraction_batch_status: `running_batch_${batchIndex + 1}_of_${batchTotal}`,
          extraction_is_resumable: true,
          active_job_status: 'running',
        }).eq('id', resourceId);
      }

      persistResult = await serverSidePersist(
        supabaseAdmin, resourceId, userId, result, fullContentLength || content.length, startedAt, isBatchSlice,
      );

      // For chunked extraction: persist batch ledger + update resource progress
      if (batchIndex != null && batchTotal != null) {
        try {
          // Persist batch record to extraction_batches table
          const semanticStartMarker = body.semanticStartMarker || `char ${contentSliceStart}`;
          const semanticEndMarker = body.semanticEndMarker || `char ${contentSliceEnd}`;
          await supabaseAdmin.from('extraction_batches').upsert({
            resource_id: resourceId,
            user_id: userId,
            extraction_run_id: persistResult?.runId || null,
            batch_index: batchIndex,
            batch_total: batchTotal,
            char_start: contentSliceStart ?? 0,
            char_end: contentSliceEnd ?? 0,
            semantic_start_marker: semanticStartMarker,
            semantic_end_marker: semanticEndMarker,
            status: persistResult?.status === 'completed' ? 'completed' : 'failed',
            raw_count: result.rawCount,
            validated_count: result.validatedCount,
            saved_count: persistResult?.savedCount ?? 0,
            duplicates_skipped: persistResult?.duplicatesSkipped ?? 0,
            cumulative_resource_ki_count: persistResult?.currentResourceKiCount ?? 0,
            started_at: new Date(startedAt).toISOString(),
            completed_at: new Date().toISOString(),
            error: persistResult?.error || null,
          }, { onConflict: 'resource_id,batch_index' });

          const { data: persistedBatches } = await supabaseAdmin
            .from('extraction_batches')
            .select('batch_index, batch_total, status, started_at')
            .eq('resource_id', resourceId)
            .order('batch_index', { ascending: true });

          const completedCount = (persistedBatches || []).filter((batch: any) => batch.status === 'completed').length;
          const nextBatchIndex = (() => {
            for (let index = 0; index < batchTotal; index++) {
              if (!(persistedBatches || []).some((batch: any) => batch.batch_index === index && batch.status === 'completed')) {
                return index;
              }
            }
            return null;
          })();
          const hasIncompleteBatches = completedCount < batchTotal;
          const lastBatchStatus = hasIncompleteBatches
            ? `resume_from_batch_${(nextBatchIndex ?? completedCount) + 1}_of_${batchTotal}`
            : 'completed';

          const runStatus = hasIncompleteBatches
            ? 'partial_complete_resumable'
            : (persistResult?.status === 'completed' ? 'completed' : persistResult?.status || 'failed');

          const resourceUpdate: Record<string, any> = {
            last_extraction_run_id: persistResult?.runId || null,
            last_extraction_run_status: runStatus,
            last_extraction_returned_ki_count: result.rawCount,
            last_extraction_deduped_ki_count: result.dedupeResult.kept.length,
            last_extraction_validated_ki_count: result.validatedCount,
            last_extraction_saved_ki_count: persistResult?.savedCount ?? 0,
            last_extraction_error: persistResult?.error || null,
            last_extraction_started_at: new Date(startedAt).toISOString(),
            last_extraction_completed_at: new Date().toISOString(),
            last_extraction_duration_ms: Date.now() - startedAt,
            last_extraction_model: MODEL_NAME,
            current_resource_ki_count: persistResult?.currentResourceKiCount ?? 0,
            current_resource_kis_per_1k: persistResult?.currentKisPer1k ?? 0,
            kis_per_1k_chars: persistResult?.currentKisPer1k ?? 0,
            extraction_mode: result.extractionMode,
            extraction_passes_run: result.passesRun,
            extraction_depth_bucket: computeDepthBucket(persistResult?.currentResourceKiCount ?? 0, fullContentLength || content.length, category),
            under_extracted_flag: computeUnderExtracted(persistResult?.currentResourceKiCount ?? 0, fullContentLength || content.length, category),
            last_extraction_summary: hasIncompleteBatches
              ? `Partial resumable batch progress: ${completedCount}/${batchTotal} complete. Next batch ${((nextBatchIndex ?? completedCount) + 1)}.`
              : result.summary,
            extraction_method: 'llm',
            extraction_batches_completed: completedCount,
            extraction_batch_total: batchTotal,
            extraction_batch_status: lastBatchStatus,
            extraction_is_resumable: hasIncompleteBatches,
            active_job_status: hasIncompleteBatches ? 'partial' : (persistResult?.status === 'failed' ? 'failed' : 'succeeded'),
          };

          // Update resource-level batch progress
          await supabaseAdmin.from('resources').update(resourceUpdate).eq('id', resourceId);
          console.log(`[extract-tactics] Batch ${batchIndex + 1}/${batchTotal} progress + ledger saved`);
        } catch (e) {
          console.error('[extract-tactics] Failed to update batch progress:', e);
        }
      }
    }

    // ── Build response with CLEAR separation of model vs saved metrics ──
    const responsePayload = {
      items: result.items,
      chunks_total: result.chunksTotal,
      chunks_processed: result.chunksProcessed,
      chunks_failed: result.chunksFailed,
      content_category: category,
      // Model/extraction-level metrics (what the AI produced, before save)
      model_metrics: {
        extraction_mode: result.extractionMode,
        extraction_passes_run: result.passesRun,
        raw_candidate_counts: result.passMetrics,
        raw_count: result.rawCount,
        deduped_count: result.dedupeResult.kept.length,
        validated_count: result.validatedCount,
        model_kis_per_1k: result.modelKisPer1k,
        model_depth_bucket: result.modelDepthBucket,
        model_under_extracted: result.modelUnderExtracted,
        validation_rejection_counts: result.validationRejections,
        dedupe_merge_counts: result.dedupeResult.details,
        model: MODEL_NAME,
        summary: result.summary,
      },
      // Saved/persisted metrics (what actually landed in the DB)
      saved_metrics: persistResult ? {
        last_run_saved_count: persistResult.savedCount,
        last_run_active_count: persistResult.activeCount,
        last_run_duplicates_skipped: persistResult.duplicatesSkipped,
        last_run_saved_kis_per_1k: result.items.length > 0 && content.length > 0
          ? Math.round((persistResult.savedCount * 1000 / content.length) * 100) / 100
          : 0,
        current_resource_ki_count: persistResult.currentResourceKiCount,
        current_resource_kis_per_1k: persistResult.currentKisPer1k,
      } : null,
      // Server persistence proof
      persistence: persistResult ? {
        run_id: persistResult.runId,
        saved_count: persistResult.savedCount,
        active_count: persistResult.activeCount,
        duplicates_skipped: persistResult.duplicatesSkipped,
        current_resource_ki_count: persistResult.currentResourceKiCount,
        status: persistResult.status,
        error: persistResult.error,
      } : null,
    };

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('extract-tactics error:', error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
