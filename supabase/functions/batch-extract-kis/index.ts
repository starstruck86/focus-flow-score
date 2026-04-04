/**
 * batch-extract-kis — single-resource KI extraction endpoint.
 *
 * ARCHITECTURE NOTE: Lesson extraction runs INLINE in this function.
 * It does NOT chain to the `extract-tactics` edge function because:
 *   1. Chained edge-function calls caused timeout cascades (each has its own wall-clock limit).
 *   2. Lessons need different prompting (2-stage enumerate→expand), relaxed validation
 *      (no verb-led titles, shorter field requirements), and conservative dedup (0.75 threshold).
 *   3. Keeping lesson logic inline gives full control over timing and avoids double-hop latency.
 *
 * Non-lesson content uses a direct AI call (callAIDirect) — also inline, no chaining.
 *
 * Benchmark: Account Scoring lesson (14,729 chars) → ~35 candidates → ~36 raw → ~32 KIs inserted.
 * If this drops materially below ~30, treat as a regression.
 *
 * RETRY ORCHESTRATION:
 *   Attempt 1: Standard extraction
 *   Attempt 2: Re-chunk with smaller segments + different boundaries
 *   Attempt 3: Alternate prompt strategy (more structured/explicit)
 *   Attempt 4: Fallback — generate summary first, extract KIs from summary
 *   After max attempts: marked 'extraction_requires_review', not terminal 'failed'
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

const LESSON_TRANSCRIPT_MARKER = '--- Video Transcript ---';
const VALID_CHAPTERS = new Set([
  'cold_calling', 'discovery', 'objection_handling', 'negotiation', 'competitors',
  'personas', 'messaging', 'closing', 'stakeholder_navigation', 'expansion', 'demo', 'follow_up',
]);
const VALID_TYPES = new Set(['skill', 'product', 'competitive']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ═══════════════════════════════════════════
// Failure Classification
// ═══════════════════════════════════════════

type ExtractionFailureType =
  | 'transient_error'        // timeout, network, model hiccup
  | 'under_floor_invariant'  // KI count below threshold
  | 'segmentation_failure'   // bad chunking / parsing
  | 'model_failure'          // empty or malformed response
  | 'structural_failure';    // bad content / ingestion issue

function classifyFailure(
  error: any, kiCount: number, minFloor: number, rawItemCount: number,
  validatedCount?: number
): ExtractionFailureType {
  const msg = (error?.message || error || '').toString().toLowerCase();

  // Network/timeout/rate-limit → transient
  if (msg.includes('timeout') || msg.includes('429') || msg.includes('503') || msg.includes('network') || msg.includes('econnrefused')) {
    return 'transient_error';
  }

  // Content too short or structurally broken
  if (msg.includes('content too short') || msg.includes('no content')) {
    return 'structural_failure';
  }

  // Segmentation failure: AI produced items but validation/dedup killed most of them
  // This indicates the AI's chunking/structuring was poor, not that the content is bad
  if (rawItemCount >= 5 && typeof validatedCount === 'number') {
    const validationDropout = 1 - (validatedCount / rawItemCount);
    if (validationDropout > 0.7) {
      return 'segmentation_failure';
    }
  }

  // Got items but below floor → under_floor
  if (kiCount > 0 && kiCount < minFloor) {
    return 'under_floor_invariant';
  }

  // AI returned nothing or unparseable → model_failure
  if (rawItemCount === 0 && !msg) {
    return 'model_failure';
  }

  // AI error message suggests bad response
  if (msg.includes('ai error') || msg.includes('ai returned') || msg.includes('parse')) {
    return 'model_failure';
  }

  // Default: transient (optimistic — allows retry)
  return 'transient_error';
}

// ═══════════════════════════════════════════
// Auto-retry: fire-and-forget self-invocation
// ═══════════════════════════════════════════

async function scheduleRetry(supabaseUrl: string, serviceRoleKey: string, resourceId: string, delayMs = 2000) {
  // Brief delay to avoid hammering the AI gateway
  await new Promise(r => setTimeout(r, delayMs));

  const url = `${supabaseUrl}/functions/v1/batch-extract-kis`;
  console.log(`[extract-retry] 🔁 Auto-retrying "${resourceId}" via self-invocation`);

  try {
    // Fire-and-forget — we don't await the full response
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ resourceId }),
    }).catch(err => {
      console.error(`[extract-retry] Auto-retry fetch failed for "${resourceId}": ${err?.message}`);
    });
  } catch (err: any) {
    console.error(`[extract-retry] Failed to schedule retry for "${resourceId}": ${err?.message}`);
  }
}

// Strategy selection based on attempt number and failure type
type ExtractionStrategy = 'standard' | 'rechunk' | 'structured_prompt' | 'summary_first';

function selectStrategy(attemptNumber: number, lastFailureType?: ExtractionFailureType): ExtractionStrategy {
  if (attemptNumber <= 1) return 'standard';

  // Failure-aware strategy selection
  if (lastFailureType === 'under_floor_invariant') {
    // Under-floor → try more structured prompt, then summary
    return attemptNumber === 2 ? 'structured_prompt' : attemptNumber === 3 ? 'rechunk' : 'summary_first';
  }
  if (lastFailureType === 'segmentation_failure') {
    return 'rechunk';
  }
  if (lastFailureType === 'model_failure') {
    return attemptNumber === 2 ? 'structured_prompt' : 'summary_first';
  }

  // Default escalation: standard → rechunk → structured_prompt → summary_first
  if (attemptNumber === 2) return 'rechunk';
  if (attemptNumber === 3) return 'structured_prompt';
  return 'summary_first';
}

// ═══════════════════════════════════════════
// Extraction Telemetry
// ═══════════════════════════════════════════

interface ExtractionTelemetry {
  resource_id: string;
  title: string;
  content_length: number;
  is_structured_lesson: boolean;
  ki_count: number;
  min_ki_floor: number;
  attempt_number: number;
  extractor_strategy: ExtractionStrategy;
  failure_reason: ExtractionFailureType | null;
  duration_ms: number;
  routing_basis: string;
}

function logTelemetry(t: ExtractionTelemetry) {
  console.log(`[extract-telemetry] ${JSON.stringify(t)}`);
}

// ═══════════════════════════════════════════
// Prompts
// ═══════════════════════════════════════════

const BASE_SYSTEM_PROMPT = `You are an elite sales execution coach. Extract TACTICAL PLAYS from content.

A Knowledge Item is a PLAY — a structured, situational, reusable tactical entry that tells a rep exactly when, why, and how to execute.

EVERY knowledge item MUST include ALL of these fields:
1. "title" — action title (e.g. "Reframe the budget objection using cost-of-inaction")
2. "framework" — methodology. REQUIRED.
3. "who" — thought leader or author. REQUIRED.
4. "source_excerpt" — EXACT quote from content. Min 2 sentences. REQUIRED.
5. "source_location" — where in content this was found. REQUIRED.
6. "macro_situation" — WHEN does this play apply? 2-4 sentences.
7. "micro_strategy" — WHAT are you doing? 2-3 sentences.
8. "why_it_matters" — WHY does this work? 2-3 sentences.
9. "how_to_execute" — HOW step by step. 3-5 concrete steps.
10. "what_this_unlocks" — OUTCOME. 2-3 sentences.
11. "when_to_use" — trigger conditions (2-3 sentences)
12. "when_not_to_use" — boundaries (2-3 sentences)
13. "example_usage" — realistic talk track. Min 3-4 sentences.
14. "tactic_summary" — concise 2-3 sentence summary
15. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
16. "knowledge_type" — skill|product|competitive

Return ONLY a JSON array. Quality over quantity, but do not under-extract.`;

const LESSON_EXPAND_ADDENDUM = `

STRUCTURED LESSON INSTRUCTIONS:
Extract EVERY distinct tactic, framework, or actionable technique. Each concept is its OWN play.
Titles may describe the concept naturally — they do NOT need to start with a verb.
Look for named frameworks, scoring models, research techniques, prioritization criteria, signal detection methods, rules of thumb, tiering systems, and specific tools or workflows.`;

const LESSON_ENUMERATE_SYSTEM = `You are an expert training content analyst. Create an exhaustive inventory of every distinct teachable concept in this lesson.

For each concept, return a JSON object with:
- "candidate_title": short descriptive title (3-10 words)
- "concept_type": one of "framework", "technique", "rule", "signal", "method", "model", "tool", "heuristic", "tier", "criteria"
- "source_hint": a short quote or reference from the content (1-2 sentences)
- "section": which part of the lesson

Be EXHAUSTIVE. List every distinct framework, scoring criteria, research technique, signal, decision rule, tiering system, metric, or heuristic. Return ONLY a JSON array.`;

// Structured prompt variant (Attempt 3) — more explicit, step-by-step
const STRUCTURED_PROMPT_ADDENDUM = `

CRITICAL: You MUST extract at least one play for every major section or concept in the content.
Scan the content section by section. For each heading or distinct topic, produce AT LEAST one play.
If you find fewer than 5 plays, re-read the content and look for:
- Named frameworks or models
- Step-by-step processes
- Rules of thumb or heuristics
- Decision criteria or scoring methods
- Specific techniques with examples
Do NOT merge multiple concepts into one play. Each distinct idea = one play.`;

// Summary-first prompt (Attempt 4 fallback)
const SUMMARY_EXTRACTION_SYSTEM = `You are an expert content analyst. First, create a structured summary of this content organized by topic/concept. Then, for each topic, extract a tactical play.

For EACH distinct concept or technique in the content, return a JSON object with all required fields.
Be thorough — extract EVERY teachable concept, not just the main ones.

Return ONLY a JSON array.`;

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

interface ExtractionLog {
  resourceId: string;
  title: string;
  contentLength: number;
  rawItemCount: number;
  normalizedCount: number;
  validatedCount: number;
  dedupedCount: number;
  insertedCount: number;
  rejections: { title: string; reasons: string[] }[];
  rawAiResponse: string | null;
  preservedUserEdited: number;
  outcome: string;
  error?: string;
  lessonPipeline?: any;
  attemptNumber?: number;
  strategy?: string;
  failureType?: string;
}

// ═══════════════════════════════════════════
// Utility helpers (all ABOVE Deno.serve)
// ═══════════════════════════════════════════

function respond(data: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isTranscriptType(resourceType?: string): boolean {
  return ['transcript', 'podcast', 'audio', 'podcast_episode', 'video', 'recording'].includes(
    (resourceType || '').toLowerCase(),
  );
}

function isStructuredLesson(content: string, title?: string, resourceType?: string): boolean {
  // Has transcript marker at expected position
  const markerIndex = content.indexOf(LESSON_TRANSCRIPT_MARKER);
  if (markerIndex > 500) return true;
  // Course lesson pattern: "Course Name > Lesson Name" with video type
  if (title && / > /.test(title) && (resourceType || '').toLowerCase() === 'video') return true;
  return false;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018').replace(/&rsquo;/g, '\u2019')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ═══════════════════════════════════════════
// AI gateway helpers
// ═══════════════════════════════════════════

async function aiRequest(apiKey: string, system: string, user: string, maxTokens = 16384, temperature = 0.2): Promise<any> {
  const body = JSON.stringify({
    model: 'google/gemini-2.5-flash',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
  });
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST', headers, body,
  });
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 3000));
    const retry = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST', headers, body,
    });
    if (!retry.ok) throw new Error(`AI error after retry: ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`AI returned ${res.status}`);
  return res.json();
}

function parseAiJson(result: any): any[] {
  const raw = result?.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const s = cleaned.indexOf('['), e = cleaned.lastIndexOf(']');
  if (s !== -1 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { /* fall through */ } }
  return [];
}

// ═══════════════════════════════════════════
// Non-lesson AI extraction (direct call) — strategy-aware
// ═══════════════════════════════════════════

async function callAIDirect(apiKey: string, content: string, title: string, tags: string[], _resourceType?: string, strategy: ExtractionStrategy = 'standard'): Promise<{ items: any[]; rawContent: string }> {
  let systemPrompt = BASE_SYSTEM_PROMPT;
  let temperature = 0.2;

  if (strategy === 'structured_prompt') {
    systemPrompt = BASE_SYSTEM_PROMPT + STRUCTURED_PROMPT_ADDENDUM;
    temperature = 0.15;
  } else if (strategy === 'summary_first') {
    systemPrompt = SUMMARY_EXTRACTION_SYSTEM;
    temperature = 0.25;
  }

  let processedContent = content;
  if (strategy === 'rechunk') {
    // Re-chunk: split into smaller overlapping sections
    processedContent = rechunkContent(content);
  }

  const userPrompt = `Extract tactical plays from this content:\n\nTitle: ${title}\nTags: ${(tags || []).join(', ') || 'none'}\n\nContent:\n${processedContent}\n\nReturn ONLY a JSON array of plays.`;
  const result = await aiRequest(apiKey, systemPrompt, userPrompt, 16384, temperature);
  return { items: parseAiJson(result), rawContent: result?.choices?.[0]?.message?.content || '' };
}

// Re-chunk content with different boundaries for retry
function rechunkContent(content: string): string {
  // Split by double newlines (paragraphs), then regroup into smaller chunks with overlap
  const paragraphs = content.split(/\n{2,}/);
  if (paragraphs.length <= 3) return content; // Too few paragraphs to rechunk

  // Add section markers for better AI parsing
  const sections: string[] = [];
  const chunkSize = Math.ceil(paragraphs.length / 4);
  for (let i = 0; i < paragraphs.length; i += chunkSize) {
    const sectionNum = Math.floor(i / chunkSize) + 1;
    const chunk = paragraphs.slice(i, i + chunkSize + 1).join('\n\n'); // +1 for overlap
    sections.push(`=== SECTION ${sectionNum} ===\n${chunk}`);
  }
  return sections.join('\n\n');
}

// ═══════════════════════════════════════════
// LESSON 2-STAGE PIPELINE (inline — never chains to extract-tactics)
// ═══════════════════════════════════════════

async function extractLessonDirect(
  apiKey: string, content: string, title: string, description: string | null, tags: string[],
  strategy: ExtractionStrategy = 'standard'
): Promise<{ items: any[]; pipelineLog: any }> {
  const pLog: any = {
    contentLength: content.length, stage1: 0, stage2Raw: 0, stage2Validated: 0,
    recoveryFound: 0, recoveryAdded: 0, dedupedFinal: 0,
    validationRejects: {} as Record<string, number>,
    initial_stage2_raw_count: 0, recovery_triggered: false,
    recovery_missing_candidate_count: 0, recovery_raw_count: 0, post_recovery_raw_count: 0,
    strategy,
  };

  console.log(`[lesson-pipeline] START | "${title}" | ${content.length} chars | strategy=${strategy}`);

  // Summary-first strategy: generate summary, then extract from it
  if (strategy === 'summary_first') {
    const summaryPrompt = `Create a detailed structured summary of this training lesson, organized by concept/topic:\n\nTitle: ${title}\n${description ? `Description: ${description}` : ''}\n\nContent:\n${content}\n\nThen extract a tactical play for EACH concept. Return ONLY a JSON array.`;
    try {
      const result = await aiRequest(apiKey, SUMMARY_EXTRACTION_SYSTEM, summaryPrompt, 24576, 0.25);
      const items = parseAiJson(result);
      pLog.stage2Raw = items.length;
      console.log(`[lesson-pipeline] Summary-first: ${items.length} items`);
      return { items, pipelineLog: pLog };
    } catch (err: any) {
      console.error(`[lesson-pipeline] Summary-first FAILED: ${err?.message}`);
      return { items: [], pipelineLog: pLog };
    }
  }

  let processedContent = content;
  if (strategy === 'rechunk') {
    processedContent = rechunkContent(content);
  }

  // Short lessons skip recovery (only 2 AI calls instead of 3) to avoid edge function timeout
  const isShortLesson = processedContent.length < 8000;

  // Determine system prompt based on strategy
  const expandSystem = strategy === 'structured_prompt'
    ? BASE_SYSTEM_PROMPT + LESSON_EXPAND_ADDENDUM + STRUCTURED_PROMPT_ADDENDUM
    : BASE_SYSTEM_PROMPT + LESSON_EXPAND_ADDENDUM;
  const expandTemp = strategy === 'structured_prompt' ? 0.15 : 0.2;

  // ── Stage 1: Exhaustive enumeration ──
  const enumPrompt = `Analyze this structured training lesson and create an exhaustive inventory of every distinct teachable concept, technique, framework, rule, signal, method, or heuristic.

Title: ${title}
${description ? `Description: ${description}` : ''}

Content:
${processedContent}

List EVERY distinct concept. If the lesson teaches 15 things, return 15 items. Do NOT merge related concepts — each gets its own entry.`;

  let candidates: any[] = [];
  try {
    candidates = parseAiJson(await aiRequest(apiKey, LESSON_ENUMERATE_SYSTEM, enumPrompt, 4096));
    pLog.stage1 = candidates.length;
    console.log(`[lesson-pipeline] Stage 1: ${candidates.length} candidates enumerated`);
  } catch (err: any) {
    console.error('[lesson-pipeline] Stage 1 FAILED:', err?.message);
  }

  // ── Stage 2: Single-pass full KI expansion with candidate guidance ──
  let rawItems: any[] = [];
  const cappedCandidates = candidates.slice(0, 18);

  const candidateList = cappedCandidates.length > 0
    ? cappedCandidates.map((c: any, i: number) => `${i + 1}. ${c.candidate_title || 'Untitled'} [${c.concept_type || 'technique'}]`).join('\n')
    : '';

  const expandPrompt = `Extract tactical plays from this training lesson.

Title: ${title}
Tags: ${(tags || []).join(', ')}
${candidateList ? `\nThe following ${cappedCandidates.length} concepts were identified. Extract a play for EACH one:\n${candidateList}\n` : ''}
Content:
${processedContent}

Return ONLY a JSON array. Each play needs: title, framework, who, source_excerpt, source_location, tactic_summary, how_to_execute, when_to_use, when_not_to_use, example_usage, macro_situation, micro_strategy, why_it_matters, what_this_unlocks, chapter, knowledge_type. Be concise per field but extract ALL plays.`;

  try {
    rawItems = parseAiJson(await aiRequest(apiKey, expandSystem, expandPrompt, 16384, expandTemp));
    pLog.stage2Raw = rawItems.length;
    console.log(`[lesson-pipeline] Stage 2: ${rawItems.length} raw items from single pass`);
  } catch (err: any) {
    console.error('[lesson-pipeline] Stage 2 FAILED:', err?.message);
    // Fallback: try without candidate list
    try {
      const fallbackPrompt = `Extract every tactical play from this training lesson.\n\nTitle: ${title}\nTags: ${(tags || []).join(', ')}\n\nContent:\n${processedContent}\n\nReturn ONLY a JSON array. Keep each play concise.`;
      rawItems = parseAiJson(await aiRequest(apiKey, expandSystem, fallbackPrompt, 24576, expandTemp));
      pLog.stage2Raw = rawItems.length;
      console.log(`[lesson-pipeline] Stage 2 fallback: ${rawItems.length} items`);
    } catch (err2: any) {
      console.error('[lesson-pipeline] Stage 2 fallback FAILED:', err2?.message);
    }
  }

  pLog.initial_stage2_raw_count = rawItems.length;

  // ── Stage 2 Recovery: only for long content where expansion significantly underperformed ──
  const coverageRatio = candidates.length > 0 ? rawItems.length / candidates.length : 1;
  const shouldRecover = !isShortLesson && candidates.length >= 20 && coverageRatio < 0.6 && rawItems.length >= 3;

  if (shouldRecover) {
    console.log(`[lesson-pipeline] Stage 2 RECOVERY triggered | coverage=${(coverageRatio * 100).toFixed(0)}% (${rawItems.length}/${candidates.length})`);
    pLog.recovery_triggered = true;

    const expandedTitlesLower = rawItems.map((item: any) => normalizeFingerprint(item.title || ''));
    const missingCandidates = candidates.filter((c: any) => {
      const cFp = normalizeFingerprint(c.candidate_title || '');
      if (!cFp) return false;
      return !expandedTitlesLower.some((eFp: string) => {
        const cWords = new Set(cFp.split(/\s+/).filter((w: string) => w.length > 2));
        const eWords = new Set(eFp.split(/\s+/).filter((w: string) => w.length > 2));
        if (cWords.size === 0) return true;
        const overlap = [...cWords].filter((w: string) => eWords.has(w)).length;
        return overlap / cWords.size > 0.5;
      });
    });

    pLog.recovery_missing_candidate_count = missingCandidates.length;
    console.log(`[lesson-pipeline] Recovery: ${missingCandidates.length} missing candidates identified`);

    if (missingCandidates.length > 0) {
      const missingList = missingCandidates
        .map((c: any, i: number) => `${i + 1}. ${c.candidate_title || 'Untitled'} [${c.concept_type || 'technique'}]${c.source_hint ? ' — ' + c.source_hint : ''}`)
        .join('\n');

      const recoveryPrompt = `Extract tactical plays for these SPECIFIC concepts from the lesson below. Each concept MUST become its own play.

CONCEPTS TO EXTRACT (${missingCandidates.length} items):
${missingList}

Title: ${title}
Content:
${processedContent}

Return ONLY a JSON array. Each play needs: title, tactic_summary, how_to_execute, when_to_use, source_excerpt, chapter, knowledge_type. Keep concise.`;

      try {
        const recoveryItems = parseAiJson(await aiRequest(apiKey, BASE_SYSTEM_PROMPT + LESSON_EXPAND_ADDENDUM, recoveryPrompt, 16384));
        pLog.recovery_raw_count = recoveryItems.length;
        console.log(`[lesson-pipeline] Recovery pass: ${recoveryItems.length} items recovered`);
        rawItems = [...rawItems, ...recoveryItems];
      } catch (err: any) {
        console.error('[lesson-pipeline] Recovery pass FAILED:', err?.message);
        pLog.recovery_raw_count = 0;
      }
    }
  } else {
    console.log(`[lesson-pipeline] No recovery needed | coverage=${(coverageRatio * 100).toFixed(0)}% (${rawItems.length}/${candidates.length})`);
  }

  pLog.post_recovery_raw_count = rawItems.length;
  pLog.stage2Raw = rawItems.length;
  const recoveryLift = rawItems.length - pLog.initial_stage2_raw_count;
  pLog.recovery_lift = recoveryLift;
  pLog.recovery_effective = recoveryLift > 0;
  pLog.recovery_material = recoveryLift >= 5;
  console.log(`[lesson-pipeline] Stage 2 total: ${rawItems.length} raw items (initial=${pLog.initial_stage2_raw_count}, recovery=${pLog.recovery_raw_count || 0}, lift=${recoveryLift}, effective=${recoveryLift > 0}, material=${recoveryLift >= 5})`);

  return { items: rawItems, pipelineLog: pLog };
}

// ═══════════════════════════════════════════
// Challenger classification (deterministic heuristic)
// ═══════════════════════════════════════════

const TAKE_CONTROL_SIGNALS = /\b(close.?the|commit.?to|lock.?in|secure.?the|push.?for|drive.?urgency|accelerate.?the|create.?urgency|deadline|status.?quo|constructive.?tension|challenge.?the.?buyer|confront|insist.?on|demand.?a|next.?step|action.?item|contract|sign.?off|get.?agreement|cost.?of.?inaction|force.?a.?decision|overcome.?inertia)\b/i;
const TAILOR_SIGNALS = /\b(persona|stakeholder|role-specific|industry.?specific|segment|vertical|adapt.?message|customize|tailor|adjust.?framing|reframe.?for|position.?for|align.?to.?their|depending.?on.?the|varies.?by|buyer.?type|audience|executive|champion|end.?user|economic.?buyer|technical.?buyer|C.?suite)\b/i;
const TEACH_SIGNALS = /\b(insight|reframe|framework|model|score|criteria|method|signal|heuristic|tier|research|principle|rule.?of|mental.?model|data.?point|benchmark|metric|diagnos|assess|evaluat|classif|categoriz|prioritiz|gap|inefficien|overlooked|missed|blind.?spot|counter.?intuitive)\b/i;

function classifyChallengerType(item: any): 'teach' | 'tailor' | 'take_control' {
  const blob = [item.title, item.tactic_summary, item.how_to_execute].filter(Boolean).join(' ');
  if (TAKE_CONTROL_SIGNALS.test(blob)) return 'take_control';
  if (TAILOR_SIGNALS.test(blob)) return 'tailor';
  return 'teach';
}

// ═══════════════════════════════════════════
// Pipeline guardrail metrics (observability only)
// ═══════════════════════════════════════════

interface GuardrailMetrics {
  stage1_candidate_count: number;
  stage2_raw_count: number;
  validated_count: number;
  deduped_count: number;
  stage2_coverage_ratio: number;
  validation_pass_rate: number;
  dedup_loss_rate: number;
  flags: {
    enum_regression: boolean;
    expansion_regression: boolean;
    validation_regression: boolean;
    dedup_regression: boolean;
  };
  challenger_distribution: Record<string, number>;
}

function computeGuardrails(s1: number, s2: number, val: number, ded: number): GuardrailMetrics {
  const coverage = s1 > 0 ? s2 / s1 : 1;
  const passRate = s2 > 0 ? val / s2 : 1;
  const dedupLoss = val > 0 ? (val - ded) / val : 0;
  return {
    stage1_candidate_count: s1,
    stage2_raw_count: s2,
    validated_count: val,
    deduped_count: ded,
    stage2_coverage_ratio: Math.round(coverage * 100) / 100,
    validation_pass_rate: Math.round(passRate * 100) / 100,
    dedup_loss_rate: Math.round(dedupLoss * 100) / 100,
    flags: {
      enum_regression: s1 < 20,
      expansion_regression: coverage < 0.6,
      validation_regression: passRate < 0.7,
      dedup_regression: dedupLoss > 0.2,
    },
    challenger_distribution: {},
  };
}

// ═══════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════

function normalizeItem(raw: any): any {
  const chapter = normalizeString(raw.chapter, 'messaging').toLowerCase().replace(/[\s-]+/g, '_');
  const knowledgeType = normalizeString(raw.knowledge_type, 'skill').toLowerCase();

  return {
    title: normalizeString(raw.title),
    framework: normalizeString(raw.framework, 'General'),
    who: normalizeString(raw.who, 'Unknown'),
    source_excerpt: normalizeString(raw.source_excerpt),
    source_location: normalizeString(raw.source_location, 'Lesson content'),
    macro_situation: normalizeString(raw.macro_situation),
    micro_strategy: normalizeString(raw.micro_strategy),
    why_it_matters: normalizeString(raw.why_it_matters),
    how_to_execute: normalizeStructuredField(raw.how_to_execute),
    what_this_unlocks: normalizeString(raw.what_this_unlocks),
    when_to_use: normalizeString(raw.when_to_use),
    when_not_to_use: normalizeString(raw.when_not_to_use),
    example_usage: normalizeString(raw.example_usage || raw.example),
    tactic_summary: normalizeString(raw.tactic_summary),
    chapter: VALID_CHAPTERS.has(chapter) ? chapter : 'messaging',
    knowledge_type: VALID_TYPES.has(knowledgeType) ? knowledgeType : 'skill',
    sub_chapter: normalizeString(raw.sub_chapter) || null,
    applies_to_contexts: normalizeArray(raw.applies_to_contexts, ['all']),
    tags: normalizeArray(raw.tags, []),
  };
}

function normalizeString(v: any, fallback = ''): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x: any) => normalizeString(x)).filter(Boolean).join('\n');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return fallback;
}

function normalizeStructuredField(v: any): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    return v.map((item: any, i: number) => {
      if (typeof item === 'string') return `${i + 1}. ${item.trim()}`;
      if (item && typeof item === 'object') {
        const text = item.step || item.action || item.description || item.text || JSON.stringify(item);
        const detail = item.detail || item.explanation || '';
        return `${i + 1}. ${normalizeString(text)}${detail ? ' — ' + normalizeString(detail) : ''}`;
      }
      return `${i + 1}. ${String(item)}`;
    }).join('\n');
  }
  if (v && typeof v === 'object') return JSON.stringify(v);
  return '';
}

function normalizeArray(v: any, fallback: string[]): string[] {
  if (Array.isArray(v)) {
    const filtered = v.filter((x: any) => typeof x === 'string' && x.trim().length > 0).map((x: string) => x.trim());
    return filtered.length > 0 ? filtered : fallback;
  }
  return fallback;
}

// ═══════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════

function validateItem(item: any, isLesson: boolean): string[] {
  const reasons: string[] = [];
  const title = (item.title || '').trim();
  const summary = (item.tactic_summary || '').trim();

  if (!title || title.length < 5) reasons.push('title too short');

  if (!isLesson) {
    const verbLedPattern = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize|apply|deploy|establish|negotiate|prepare|structure|deliver|align|engage|trigger|introduce|propose|define|prioritize|execute|implement|develop|assess|evaluate|document|track|measure|monitor|adapt|adjust|escalate|simplify|clarify|articulate|illustrate|connect|link|uncover|reveal|surface|capture|name|label|restate|mirror|acknowledge|interrupt|pause|reset|redirect|flip|seed|earn|secure|protect|defend|block|anticipate|signal|flag|commit|lock|tie|bundle|unbundle|separate|isolate|stack|layer|combine|sequence|time|delay|accelerate|pace|control|manage|own|run|facilitate|orchestrate|coordinate|coach|mentor|advise|guide|steer|navigate|overcome)\b/i;
    if (!verbLedPattern.test(title)) reasons.push('title not actionable');
  }

  if (!hasSubstance(summary, isLesson ? 10 : 20)) reasons.push('tactic_summary lacks substance');

  if (isLesson) {
    if (!item.how_to_execute && !item.source_excerpt) reasons.push('no how_to_execute or source_excerpt');
    if (!item.framework) item.framework = 'General';
    if (!item.who) item.who = 'Unknown';
    if (!item.source_location) item.source_location = 'Lesson content';
  } else {
    if (!hasSubstance(item.how_to_execute, 20)) reasons.push('how_to_execute lacks substance');
    if (!hasSubstance(item.when_to_use, 15)) reasons.push('when_to_use lacks substance');
    if (!hasSubstance(item.source_excerpt, 20)) reasons.push('source_excerpt too short');
    if (!hasSubstance(item.macro_situation, 10)) reasons.push('macro_situation too short');
    if (!item.framework || item.framework === '') reasons.push('framework missing');
    if (!item.who || item.who === '') reasons.push('who missing');
  }

  if (title && summary && summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 30))) {
    reasons.push('title duplicates start of summary');
  }

  const HTML_PATTERN = /<[a-z][\s\S]*>/i;
  const allText = [title, summary, item.how_to_execute, item.example_usage].join(' ');
  if (HTML_PATTERN.test(allText)) reasons.push('html artifacts');

  if (/&(?:ldquo|rdquo|lsquo|rsquo|amp|nbsp|mdash|ndash);|&#\d+;|&#x[0-9a-f]+;/i.test(`${title} ${summary} ${item.example_usage || ''}`)) {
    reasons.push('html entities remain');
  }

  return reasons;
}

function hasSubstance(value: string | undefined | null, minChars: number): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < minChars) return false;
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 1).length;
  return wordCount >= 3;
}

// ═══════════════════════════════════════════
// Composite Deduplication
// ═══════════════════════════════════════════

function compositeDedup(items: any[], isLesson = false): any[] {
  const result: any[] = [];
  const fingerprints = new Set<string>();
  const threshold = isLesson ? 0.75 : 0.55;

  for (const item of items) {
    const fingerprint = normalizeFingerprint(item.tactic_summary || item.title || '');
    if (fingerprint && fingerprints.has(fingerprint)) {
      console.log(`[extract] DEDUP-FINGERPRINT: "${(item.title || '').slice(0, 40)}"`);
      continue;
    }

    let isDupe = false;
    for (const existing of result) {
      const score = compositeSimilarity(item, existing);
      if (score > threshold) {
        console.log(`[extract] DEDUP: "${(item.title || '').slice(0, 40)}" ≈ "${(existing.title || '').slice(0, 40)}" (score: ${score.toFixed(2)})`);
        isDupe = true;
        break;
      }
    }
    if (!isDupe) {
      result.push(item);
      if (fingerprint) fingerprints.add(fingerprint);
    }
  }

  return result;
}

function normalizeFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/&(?:ldquo|rdquo|lsquo|rsquo|amp|nbsp|mdash|ndash);/g, ' ')
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .join(' ')
    .trim();
}

function compositeSimilarity(a: any, b: any): number {
  const titleOverlap = wordOverlap(a.title || '', b.title || '');
  const summaryOverlap = wordOverlap(a.tactic_summary || '', b.tactic_summary || '');
  const excerptOverlap = wordOverlap(a.source_excerpt || '', b.source_excerpt || '');
  const metaMatch = (a.framework === b.framework && a.who === b.who) ? 1.0 : 0.0;
  return (titleOverlap * 0.35) + (summaryOverlap * 0.30) + (excerptOverlap * 0.20) + (metaMatch * 0.15);
}

function wordOverlap(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const toWords = (s: string) => new Set(norm(s).split(/\s+/).filter(w => w.length > 2));
  const aw = toWords(a);
  const bw = toWords(b);
  if (aw.size === 0 || bw.size === 0) return 0;
  const intersection = [...aw].filter(w => bw.has(w)).length;
  return intersection / Math.min(aw.size, bw.size);
}

// ═══════════════════════════════════════════
// Post-extraction invariant: minimum KI floor
// ═══════════════════════════════════════════

function computeMinKiFloor(contentLength: number, isLesson: boolean): number {
  if (contentLength < 500) return 0;
  if (isLesson) {
    if (contentLength < 2000) return 3;
    if (contentLength < 5000) return 5;
    if (contentLength < 10000) return 8;
    return 12;
  }
  if (contentLength < 2000) return 1;
  if (contentLength < 5000) return 2;
  return 3;
}

// ═══════════════════════════════════════════
// DB helpers
// ═══════════════════════════════════════════

async function updateExtractionStatus(supabase: any, resourceId: string, status: string, extraFields?: Record<string, any>) {
  const updatePayload: Record<string, any> = {
    enrichment_status: status,
    updated_at: new Date().toISOString(),
    ...extraFields,
  };
  const { error } = await supabase
    .from('resources')
    .update(updatePayload)
    .eq('id', resourceId);
  if (error) console.error(`[extract] Status update failed: ${error.message}`);
}

async function saveExtractionLog(supabase: any, log: ExtractionLog) {
  const storable = {
    ...log,
    rawAiResponse: log.rawAiResponse ? log.rawAiResponse.slice(0, 5000) : null,
  };
  console.log(`[extract-log] ${JSON.stringify({
    resourceId: storable.resourceId,
    outcome: storable.outcome,
    raw: storable.rawItemCount,
    normalized: storable.normalizedCount,
    validated: storable.validatedCount,
    deduped: storable.dedupedCount,
    inserted: storable.insertedCount,
    preservedEdited: storable.preservedUserEdited,
    rejections: storable.rejections.length,
    lessonPipeline: storable.lessonPipeline || null,
    attemptNumber: storable.attemptNumber || 1,
    strategy: storable.strategy || 'standard',
    failureType: storable.failureType || null,
    error: storable.error || null,
  })}`);
}

// ═══════════════════════════════════════════
// Deno.serve — main handler
// ═══════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resourceId, benchmarkMode } = await req.json();
    const isDryRun = benchmarkMode === true;

    if (!resourceId || typeof resourceId !== 'string') {
      return respond({ error: 'resourceId (string) required' }, 400);
    }

    if (isDryRun) console.log(`[extract] 🔬 BENCHMARK MODE — no DB writes`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      return respond({ error: 'AI not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Fetch resource (including retry tracking fields) ──
    const { data: resource, error: fetchError } = await supabase
      .from('resources')
      .select('id, title, resource_type, content, description, tags, user_id, extraction_attempt_count, max_extraction_attempts, extraction_failure_type, extractor_strategy')
      .eq('id', resourceId)
      .single();

    if (fetchError || !resource) {
      return respond({ error: fetchError?.message || 'Resource not found' }, 404);
    }

    if (!resource.content || resource.content.length < 200) {
      return respond({ resourceId, title: resource.title, kis: 0, error: 'Content too short (<200 chars)' });
    }

    // ── Retry orchestration: determine attempt number and strategy ──
    const attemptNumber = (resource.extraction_attempt_count || 0) + 1;
    const maxAttempts = resource.max_extraction_attempts || 4;
    const lastFailureType = resource.extraction_failure_type as ExtractionFailureType | undefined;
    const strategy = selectStrategy(attemptNumber, lastFailureType);

    console.log(`[extract] Attempt ${attemptNumber}/${maxAttempts} | strategy=${strategy} | lastFailure=${lastFailureType || 'none'} | "${resource.title}"`);

    const startTime = Date.now();

    const log: ExtractionLog = {
      resourceId,
      title: resource.title,
      contentLength: resource.content.length,
      rawItemCount: 0,
      normalizedCount: 0,
      validatedCount: 0,
      dedupedCount: 0,
      insertedCount: 0,
      rejections: [],
      rawAiResponse: null,
      preservedUserEdited: 0,
      outcome: 'pending',
      attemptNumber,
      strategy,
    };

    console.log(`[extract] Starting: "${resource.title}" (${resource.content.length} chars)`);

    // ── 2. Run AI extraction (strategy-aware) ──
    const decodedContent = decodeHTMLEntities(resource.content);
    const decodedTitle = decodeHTMLEntities(resource.title);
    const isLesson = isStructuredLesson(decodedContent, decodedTitle, resource.resource_type);
    const routingBasis = isLesson
      ? (decodedContent.indexOf(LESSON_TRANSCRIPT_MARKER) > 500 ? 'transcript_marker' : 'course_title_pattern')
      : (isTranscriptType(resource.resource_type) ? 'transcript_type' : 'standard');
    let rawItems: any[];
    let rawResponse: string | null = null;

    try {
      if (isLesson) {
        console.log(`[extract] LESSON PATH — strategy=${strategy}`);
        const result = await extractLessonDirect(LOVABLE_API_KEY, decodedContent, resource.title, resource.description, resource.tags || [], strategy);
        rawItems = result.items;
        rawResponse = JSON.stringify({ lesson_pipeline: result.pipelineLog });
        log.lessonPipeline = result.pipelineLog;
      } else {
        console.log(`[extract] STANDARD PATH — strategy=${strategy}`);
        const result = await callAIDirect(LOVABLE_API_KEY, decodedContent, resource.title, resource.tags || [], resource.resource_type, strategy);
        rawItems = result.items;
        rawResponse = result.rawContent;
      }
      log.rawAiResponse = rawResponse;
    } catch (aiErr: any) {
      const failureType = classifyFailure(aiErr, 0, computeMinKiFloor(resource.content.length, isLesson), 0);
      log.outcome = 'ai_error';
      log.error = aiErr.message;
      log.failureType = failureType;
      await saveExtractionLog(supabase, log);

      // Telemetry
      logTelemetry({
        resource_id: resourceId, title: resource.title, content_length: resource.content.length,
        is_structured_lesson: isLesson, ki_count: 0, min_ki_floor: computeMinKiFloor(resource.content.length, isLesson),
        attempt_number: attemptNumber, extractor_strategy: strategy, failure_reason: failureType,
        duration_ms: Date.now() - startTime, routing_basis: routingBasis,
      });

      // Update with retry tracking + auto-retry
      const retryEligible = attemptNumber < maxAttempts && failureType !== 'structural_failure';
      const newStatus = retryEligible ? 'extraction_retrying' : 'extraction_requires_review';

      if (!isDryRun) {
        await updateExtractionStatus(supabase, resourceId, newStatus, {
          extraction_attempt_count: attemptNumber,
          extraction_failure_type: failureType,
          extractor_strategy: strategy,
          extraction_retry_eligible: retryEligible,
        });

        // Auto-retry: fire-and-forget next attempt
        if (retryEligible) {
          scheduleRetry(supabaseUrl, serviceRoleKey, resourceId);
        }
      }

      return respond({
        resourceId, title: resource.title, kis: 0,
        error: `AI error: ${aiErr.message}`,
        attemptNumber, strategy, failureType,
        retryEligible, status: newStatus, log,
      });
    }

    log.rawItemCount = rawItems.length;
    console.log(`[extract] "${resource.title}": ${rawItems.length} raw items from AI`);

    // ── 3. Normalize ──
    const normalized = rawItems.map(normalizeItem);
    log.normalizedCount = normalized.length;

    // ── 4. Validate (lesson-aware) ──
    const validated: any[] = [];
    const rejectReasons: Record<string, number> = {};
    for (const item of normalized) {
      const reasons = validateItem(item, isLesson);
      if (reasons.length > 0) {
        log.rejections.push({ title: (item.title || '').slice(0, 60), reasons });
        for (const r of reasons) { rejectReasons[r] = (rejectReasons[r] || 0) + 1; }
        console.log(`[extract] REJECTED "${(item.title || '').slice(0, 50)}": ${reasons.join('; ')}`);
      } else {
        validated.push(item);
      }
    }
    log.validatedCount = validated.length;

    if (isLesson && log.lessonPipeline) {
      log.lessonPipeline.validatedCount = validated.length;
      log.lessonPipeline.validationRejects = rejectReasons;
    }

    console.log(`[extract] "${resource.title}": ${validated.length} validated from ${normalized.length} normalized`);
    if (Object.keys(rejectReasons).length > 0) {
      console.log(`[extract] Rejection reasons: ${JSON.stringify(rejectReasons)}`);
    }

    // ── 5. Composite dedup (conservative for lessons) ──
    const deduped = compositeDedup(validated, isLesson);
    log.dedupedCount = deduped.length;
    console.log(`[extract] "${resource.title}": ${deduped.length} after dedup (from ${validated.length} validated)`);

    if (isLesson && log.lessonPipeline) {
      log.lessonPipeline.dedupedFinal = deduped.length;
    }

    // ── 5b. Challenger classification ──
    const challengerDist: Record<string, number> = { teach: 0, tailor: 0, take_control: 0 };
    for (const item of deduped) {
      const cType = classifyChallengerType(item);
      item._challenger_type = cType;
      challengerDist[cType] = (challengerDist[cType] || 0) + 1;
    }
    console.log(`[extract] Challenger distribution: ${JSON.stringify(challengerDist)}`);

    // ── 5c. Lesson pipeline guardrails (observability only) ──
    if (isLesson && log.lessonPipeline) {
      const gm = computeGuardrails(
        log.lessonPipeline.stage1 || 0,
        log.lessonPipeline.stage2Raw || 0,
        validated.length,
        deduped.length,
      );
      gm.challenger_distribution = challengerDist;
      log.lessonPipeline.guardrails = gm;

      const triggered = Object.entries(gm.flags).filter(([, v]) => v).map(([k]) => k);
      console.log(`[lesson-guardrails] metrics=${JSON.stringify({
        stage1: gm.stage1_candidate_count,
        stage2: gm.stage2_raw_count,
        validated: gm.validated_count,
        deduped: gm.deduped_count,
        coverage_ratio: gm.stage2_coverage_ratio,
        validation_rate: gm.validation_pass_rate,
        dedup_loss: gm.dedup_loss_rate,
        flags: gm.flags,
        challenger_distribution: challengerDist,
      })}`);
      if (triggered.length > 0) {
        console.warn(`[lesson-guardrails] ⚠️ TRIGGERED: ${triggered.join(', ')}`);
      } else {
        console.log(`[lesson-guardrails] ✅ All guardrails passed`);
      }
    }

    // ── 6. Quality threshold gate + post-extraction invariant ──
    const minKiFloor = computeMinKiFloor(resource.content.length, isLesson);
    const durationMs = Date.now() - startTime;

    if (deduped.length < 1) {
      const failureType = classifyFailure(null, 0, minKiFloor, rawItems.length);
      log.outcome = isDryRun ? 'benchmark_below_threshold' : 'below_threshold';
      log.failureType = failureType;

      logTelemetry({
        resource_id: resourceId, title: resource.title, content_length: resource.content.length,
        is_structured_lesson: isLesson, ki_count: 0, min_ki_floor: minKiFloor,
        attempt_number: attemptNumber, extractor_strategy: strategy, failure_reason: failureType,
        duration_ms: durationMs, routing_basis: routingBasis,
      });

      if (!isDryRun) {
        const retryEligible = attemptNumber < maxAttempts && failureType !== 'structural_failure';
        const newStatus = retryEligible ? 'extraction_retrying' : 'extraction_requires_review';
        await saveExtractionLog(supabase, log);
        await updateExtractionStatus(supabase, resourceId, newStatus, {
          extraction_attempt_count: attemptNumber,
          extraction_failure_type: failureType,
          extractor_strategy: strategy,
          extraction_retry_eligible: retryEligible,
        });
      }
      console.log(`[extract] ⚠️ "${resource.title}": 0 items — attempt ${attemptNumber}/${maxAttempts}`);
      return respond({ resourceId, title: resource.title, kis: 0, error: 'Below quality threshold', attemptNumber, strategy, log, benchmarkMode: isDryRun });
    }

    // Hard invariant: if yield is below the content-proportional floor, trigger retry
    if (deduped.length < minKiFloor) {
      const failureType: ExtractionFailureType = 'under_floor_invariant';
      const invariantMsg = `KI yield invariant violated: got ${deduped.length} KIs but floor is ${minKiFloor} for ${resource.content.length} chars (lesson=${isLesson})`;
      console.error(`[extract] 🚨 INVARIANT FAIL "${resource.title}": ${invariantMsg}`);
      log.outcome = isDryRun ? 'benchmark_invariant_fail' : 'invariant_fail';
      log.error = invariantMsg;
      log.failureType = failureType;

      logTelemetry({
        resource_id: resourceId, title: resource.title, content_length: resource.content.length,
        is_structured_lesson: isLesson, ki_count: deduped.length, min_ki_floor: minKiFloor,
        attempt_number: attemptNumber, extractor_strategy: strategy, failure_reason: failureType,
        duration_ms: durationMs, routing_basis: routingBasis,
      });

      if (!isDryRun) {
        const retryEligible = attemptNumber < maxAttempts;
        const newStatus = retryEligible ? 'extraction_retrying' : 'extraction_requires_review';
        await saveExtractionLog(supabase, log);
        await updateExtractionStatus(supabase, resourceId, newStatus, {
          extraction_attempt_count: attemptNumber,
          extraction_failure_type: failureType,
          extractor_strategy: strategy,
          extraction_retry_eligible: retryEligible,
        });
      }
      return respond({ resourceId, title: resource.title, kis: 0, error: invariantMsg, attemptNumber, strategy, failureType, log, benchmarkMode: isDryRun });
    }

    // ── BENCHMARK MODE: skip all DB mutations, return metrics only ──
    if (isDryRun) {
      log.insertedCount = 0;
      log.dedupedCount = deduped.length;
      log.outcome = 'benchmark_success';
      logTelemetry({
        resource_id: resourceId, title: resource.title, content_length: resource.content.length,
        is_structured_lesson: isLesson, ki_count: deduped.length, min_ki_floor: minKiFloor,
        attempt_number: attemptNumber, extractor_strategy: strategy, failure_reason: null,
        duration_ms: durationMs, routing_basis: routingBasis,
      });
      console.log(`[extract] 🔬 BENCHMARK COMPLETE "${resource.title}": ${deduped.length} KIs would be inserted (dry run — no DB writes)`);
      return respond({ resourceId, title: resource.title, kis: deduped.length, preservedUserEdited: 0, log, benchmarkMode: true });
    }

    // ── 6b. Protect user-edited KIs ──
    const { data: userEditedKIs } = await supabase
      .from('knowledge_items')
      .select('id')
      .eq('source_resource_id', resourceId)
      .eq('user_edited', true);

    const userEditedCount = userEditedKIs?.length || 0;
    log.preservedUserEdited = userEditedCount;

    // ── 6c. Delete ONLY non-user-edited KIs (safe replace) ──
    const { error: deleteError } = await supabase
      .from('knowledge_items')
      .delete()
      .eq('source_resource_id', resourceId)
      .eq('user_edited', false);

    if (deleteError) {
      log.outcome = 'delete_failed';
      log.error = deleteError.message;
      await saveExtractionLog(supabase, log);
      return respond({ resourceId, title: resource.title, kis: 0, error: `Delete failed: ${deleteError.message}`, log });
    }

    // ── 7. Build and insert rows ──
    const rows = deduped.map((item) => ({
      user_id: resource.user_id,
      source_resource_id: resource.id,
      source_title: resource.title,
      title: item.title,
      knowledge_type: item.knowledge_type,
      chapter: item.chapter,
      sub_chapter: item.sub_chapter || null,
      tactic_summary: item.tactic_summary,
      why_it_matters: item.why_it_matters,
      when_to_use: item.when_to_use,
      when_not_to_use: item.when_not_to_use,
      example_usage: item.example_usage,
      macro_situation: item.macro_situation,
      micro_strategy: item.micro_strategy,
      how_to_execute: item.how_to_execute,
      what_this_unlocks: item.what_this_unlocks,
      source_excerpt: item.source_excerpt,
      source_location: item.source_location,
      framework: item.framework,
      who: item.who,
      confidence_score: 0.75,
      status: 'active',
      active: true,
      user_edited: false,
      applies_to_contexts: item.applies_to_contexts || ['all'],
      tags: item.tags || [],
      challenger_type: item._challenger_type || 'teach',
    }));

    const { error: insertError } = await supabase.from('knowledge_items').insert(rows);

    if (insertError) {
      log.outcome = 'insert_failed';
      log.error = insertError.message;
      await saveExtractionLog(supabase, log);
      await updateExtractionStatus(supabase, resourceId, 'extraction_failed', {
        extraction_attempt_count: attemptNumber,
        extraction_failure_type: 'transient_error',
        extractor_strategy: strategy,
        extraction_retry_eligible: attemptNumber < maxAttempts,
      });
      return respond({ resourceId, title: resource.title, kis: 0, error: `Insert failed: ${insertError.message}`, log });
    }

    // ── SUCCESS: reset retry tracking ──
    log.insertedCount = rows.length;
    log.outcome = 'success';
    await saveExtractionLog(supabase, log);
    await updateExtractionStatus(supabase, resourceId, 'extracted', {
      extraction_attempt_count: attemptNumber,
      extraction_failure_type: null,
      extractor_strategy: strategy,
      extraction_retry_eligible: false,
    });

    logTelemetry({
      resource_id: resourceId, title: resource.title, content_length: resource.content.length,
      is_structured_lesson: isLesson, ki_count: rows.length, min_ki_floor: minKiFloor,
      attempt_number: attemptNumber, extractor_strategy: strategy, failure_reason: null,
      duration_ms: durationMs, routing_basis: routingBasis,
    });

    console.log(`[extract] ✅ "${resource.title}": ${rows.length} KIs inserted (attempt ${attemptNumber}, strategy=${strategy}, ${userEditedCount} user-edited preserved)`);

    return respond({ resourceId, title: resource.title, kis: rows.length, preservedUserEdited: userEditedCount, attemptNumber, strategy, log });
  } catch (error: any) {
    console.error('[extract] Unhandled error:', error);
    return respond({ error: error?.message || 'Failed' }, 500);
  }
});
