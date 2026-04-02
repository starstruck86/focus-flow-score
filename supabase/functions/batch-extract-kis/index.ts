import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Single-resource KI extraction endpoint.
 * Accepts: { resourceId: string }
 *
 * Safe extraction flow:
 *   1. Fetch resource
 *   2. Run AI extraction
 *   3. Normalize all fields (arrays, bullets, numbered steps)
 *   4. Validate each item (substance checks, not just char counts)
 *   5. Composite dedup (title + summary + excerpt + framework/who)
 *   6. Only if new set passes quality threshold → replace prior KIs
 *      (preserving user-edited KIs always)
 *   7. Otherwise preserve existing KIs and mark failure
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resourceId } = await req.json();

    if (!resourceId || typeof resourceId !== 'string') {
      return respond({ error: 'resourceId (string) required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      return respond({ error: 'AI not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Fetch resource ──
    const { data: resource, error: fetchError } = await supabase
      .from('resources')
      .select('id, title, resource_type, content, description, tags, user_id')
      .eq('id', resourceId)
      .single();

    if (fetchError || !resource) {
      return respond({ error: fetchError?.message || 'Resource not found' }, 404);
    }

    if (!resource.content || resource.content.length < 200) {
      return respond({ resourceId, title: resource.title, kis: 0, error: 'Content too short (<200 chars)' });
    }

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
    };

    console.log(`[extract] Starting: "${resource.title}" (${resource.content.length} chars)`);

    // ── 2. Run AI extraction ──
    let rawItems: any[];
    let rawResponse: string | null = null;
    try {
      const aiResult = await callAI(LOVABLE_API_KEY, resource.content, resource.title, resource.tags || []);
      rawItems = aiResult.items;
      rawResponse = aiResult.rawContent;
      log.rawAiResponse = rawResponse;
    } catch (aiErr: any) {
      log.outcome = 'ai_error';
      log.error = aiErr.message;
      await saveExtractionLog(supabase, log);
      await updateExtractionStatus(supabase, resourceId, 'extraction_failed');
      return respond({ resourceId, title: resource.title, kis: 0, error: `AI error: ${aiErr.message}`, log });
    }

    log.rawItemCount = rawItems.length;
    console.log(`[extract] "${resource.title}": ${rawItems.length} raw items from AI`);

    // ── 3. Normalize ──
    const normalized = rawItems.map(normalizeItem);
    log.normalizedCount = normalized.length;

    // ── 4. Validate ──
    const validated: any[] = [];
    for (const item of normalized) {
      const reasons = validateItem(item);
      if (reasons.length > 0) {
        log.rejections.push({ title: (item.title || '').slice(0, 60), reasons });
        console.log(`[extract] REJECTED "${(item.title || '').slice(0, 50)}": ${reasons.join('; ')}`);
      } else {
        validated.push(item);
      }
    }
    log.validatedCount = validated.length;

    // ── 5. Composite dedup ──
    const deduped = compositeDedup(validated).slice(0, 15);
    log.dedupedCount = deduped.length;
    console.log(`[extract] "${resource.title}": ${deduped.length} after validation+dedup (from ${rawItems.length} raw)`);

    // ── 6. Quality threshold gate ──
    const MIN_ITEMS = 1;
    if (deduped.length < MIN_ITEMS) {
      log.outcome = 'below_threshold';
      await saveExtractionLog(supabase, log);
      await updateExtractionStatus(supabase, resourceId, 'extraction_empty');
      console.log(`[extract] ⚠️ "${resource.title}": ${deduped.length} items below threshold — preserving existing KIs`);
      return respond({ resourceId, title: resource.title, kis: 0, error: 'Below quality threshold — existing KIs preserved', log });
    }

    // ── 6b. Protect user-edited KIs ──
    const { data: userEditedKIs } = await supabase
      .from('knowledge_items')
      .select('id')
      .eq('source_resource_id', resourceId)
      .eq('user_edited', true);

    const userEditedCount = userEditedKIs?.length || 0;
    log.preservedUserEdited = userEditedCount;

    if (userEditedCount > 0) {
      console.log(`[extract] Preserving ${userEditedCount} user-edited KIs for "${resource.title}"`);
    }

    // ── 6c. Delete ONLY non-user-edited KIs (safe replace) ──
    const { error: deleteError } = await supabase
      .from('knowledge_items')
      .delete()
      .eq('source_resource_id', resourceId)
      .eq('user_edited', false);

    if (deleteError) {
      console.error(`[extract] Failed to clear old KIs: ${deleteError.message}`);
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
    }));

    const { error: insertError } = await supabase.from('knowledge_items').insert(rows);

    if (insertError) {
      log.outcome = 'insert_failed';
      log.error = insertError.message;
      await saveExtractionLog(supabase, log);
      await updateExtractionStatus(supabase, resourceId, 'extraction_failed');
      return respond({ resourceId, title: resource.title, kis: 0, error: `Insert failed: ${insertError.message}`, log });
    }

    log.insertedCount = rows.length;
    log.outcome = 'success';
    await saveExtractionLog(supabase, log);
    await updateExtractionStatus(supabase, resourceId, 'extracted');
    console.log(`[extract] ✅ "${resource.title}": ${rows.length} KIs inserted (${userEditedCount} user-edited preserved)`);

    return respond({ resourceId, title: resource.title, kis: rows.length, preservedUserEdited: userEditedCount, log });
  } catch (error: any) {
    console.error('[extract] Unhandled error:', error);
    return respond({ error: error?.message || 'Failed' }, 500);
  }
});

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
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function respond(data: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function updateExtractionStatus(supabase: any, resourceId: string, status: string) {
  const { error } = await supabase
    .from('resources')
    .update({ enrichment_status: status, updated_at: new Date().toISOString() })
    .eq('id', resourceId);
  if (error) console.error(`[extract] Status update failed: ${error.message}`);
}

async function saveExtractionLog(supabase: any, log: ExtractionLog) {
  // Truncate raw AI response for storage (keep first 5000 chars for debugging)
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
    error: storable.error || null,
  })}`);
}

// ═══════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════

const VALID_CHAPTERS = new Set([
  'cold_calling', 'discovery', 'objection_handling', 'negotiation', 'competitors',
  'personas', 'messaging', 'closing', 'stakeholder_navigation', 'expansion', 'demo', 'follow_up',
]);
const VALID_TYPES = new Set(['skill', 'product', 'competitive']);

/**
 * Normalizes a raw AI output item into a consistent shape.
 * Handles: arrays → joined text, numbered steps → preserved, bullets → preserved,
 * objects → JSON string, numbers → string.
 */
function normalizeItem(raw: any): any {
  const chapter = normalizeString(raw.chapter, 'messaging').toLowerCase().replace(/[\s-]+/g, '_');
  const knowledgeType = normalizeString(raw.knowledge_type, 'skill').toLowerCase();

  return {
    title: normalizeString(raw.title),
    framework: normalizeString(raw.framework, 'General'),
    who: normalizeString(raw.who, 'Unknown'),
    source_excerpt: normalizeString(raw.source_excerpt),
    source_location: normalizeString(raw.source_location),
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

/** Convert any value to a trimmed string. Arrays joined by newlines, objects JSON-stringified. */
function normalizeString(v: any, fallback = ''): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x: any) => normalizeString(x)).filter(Boolean).join('\n');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return fallback;
}

/** 
 * Normalize structured fields like how_to_execute that commonly come as:
 * - numbered steps: "1. Do X\n2. Do Y"
 * - arrays of strings: ["Step 1", "Step 2"]
 * - arrays of objects: [{step: "...", detail: "..."}]
 * - bullet lists: "- Do X\n- Do Y"
 */
function normalizeStructuredField(v: any): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    return v.map((item: any, i: number) => {
      if (typeof item === 'string') return `${i + 1}. ${item.trim()}`;
      if (item && typeof item === 'object') {
        // Handle {step: "...", detail: "..."} or {action: "..."} shapes
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

/**
 * Validates a normalized item. Returns array of rejection reasons (empty = pass).
 * Checks for substance, not just character count.
 */
function validateItem(item: any): string[] {
  const reasons: string[] = [];

  // Title: must exist, min length, should start with a verb-like word
  if (!item.title || item.title.length < 5) reasons.push('title too short');

  // Core fields: check for meaningful content (not just length)
  if (!hasSubstance(item.tactic_summary, 20)) reasons.push('tactic_summary lacks substance');
  if (!hasSubstance(item.how_to_execute, 20)) reasons.push('how_to_execute lacks substance');
  if (!hasSubstance(item.when_to_use, 15)) reasons.push('when_to_use lacks substance');
  if (!hasSubstance(item.source_excerpt, 20)) reasons.push('source_excerpt too short');
  if (!hasSubstance(item.macro_situation, 10)) reasons.push('macro_situation too short');

  // Required attribution fields
  if (!item.framework || item.framework === '') reasons.push('framework missing');
  if (!item.who || item.who === '') reasons.push('who missing');

  // Anti-junk: title should not be a copy of tactic_summary
  if (item.title && item.tactic_summary &&
      item.tactic_summary.toLowerCase().startsWith(item.title.toLowerCase().slice(0, 30))) {
    reasons.push('title duplicates start of summary');
  }

  return reasons;
}

/** Check that a field has meaningful content: min char count AND min word count */
function hasSubstance(value: string | undefined | null, minChars: number): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < minChars) return false;
  // Must have at least 3 words to be considered substantive
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 1).length;
  return wordCount >= 3;
}

// ═══════════════════════════════════════════
// Composite Deduplication
// ═══════════════════════════════════════════

/**
 * Deduplicates using a composite signal:
 * - title word overlap (weight: 0.35)
 * - tactic_summary word overlap (weight: 0.30)
 * - source_excerpt word overlap (weight: 0.20)
 * - framework+who exact match bonus (weight: 0.15)
 * 
 * Threshold: composite > 0.55 = duplicate
 */
function compositeDedup(items: any[]): any[] {
  const result: any[] = [];

  for (const item of items) {
    let isDupe = false;
    for (const existing of result) {
      const score = compositeSimilarity(item, existing);
      if (score > 0.55) {
        console.log(`[extract] DEDUP: "${(item.title || '').slice(0, 40)}" ≈ "${(existing.title || '').slice(0, 40)}" (score: ${score.toFixed(2)})`);
        isDupe = true;
        break;
      }
    }
    if (!isDupe) result.push(item);
  }

  return result;
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
// AI Call
// ═══════════════════════════════════════════

const SYSTEM_PROMPT = `You are an elite sales execution coach. Extract TACTICAL PLAYS from content.

A Knowledge Item is a PLAY — a structured, situational, reusable tactical entry that tells a rep exactly when, why, and how to execute.

EVERY knowledge item MUST include ALL of these fields:
1. "title" — verb-led action title (e.g. "Reframe the budget objection using cost-of-inaction")
2. "framework" — methodology (GAP Selling, Challenger Sale, MEDDPICC, Command of the Message, SPIN Selling, or "General"). REQUIRED.
3. "who" — thought leader or author. REQUIRED.
4. "source_excerpt" — EXACT quote from content. Min 2 sentences. REQUIRED.
5. "source_location" — where in content this was found. REQUIRED.
6. "macro_situation" — WHEN does this play apply? 2-4 sentences.
7. "micro_strategy" — WHAT are you doing? 2-3 sentences.
8. "why_it_matters" — WHY does this work? 2-3 sentences.
9. "how_to_execute" — HOW step by step. Return as an ARRAY of 3-5 strings, each a concrete step with exact phrasing.
10. "what_this_unlocks" — OUTCOME. 2-3 sentences.
11. "when_to_use" — trigger conditions (2-3 sentences)
12. "when_not_to_use" — boundaries (2-3 sentences)
13. "example_usage" — realistic talk track. Min 3-4 sentences.
14. "tactic_summary" — concise 2-3 sentence summary
15. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
16. "knowledge_type" — skill|product|competitive

QUALITY GATES — REJECT any item that:
- Has fields shorter than 2 sentences (except title, chapter, knowledge_type, how_to_execute steps)
- Is generic advice without specific phrasing
- Describes what to think rather than what to DO

Return ONLY a JSON array. Extract 4-8 plays. Quality over quantity.`;

async function callAI(apiKey: string, content: string, title: string, tags: string[]): Promise<{ items: any[]; rawContent: string }> {
  const userPrompt = `Extract tactical plays from this content:

Title: ${title}
Tags: ${(tags || []).join(', ') || 'none'}

Content:
${content.slice(0, 30000)}

Return ONLY a JSON array of plays.`;

  const body = JSON.stringify({
    model: 'google/gemini-2.5-flash',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 16384,
    temperature: 0.2,
  });

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };

  let res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { method: 'POST', headers, body });

  if (res.status === 429) {
    console.log('[extract] Rate limited, waiting 5s...');
    await new Promise(r => setTimeout(r, 5000));
    res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { method: 'POST', headers, body });
  }

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[extract] AI error response: ${errorBody.slice(0, 500)}`);
    throw new Error(`AI returned ${res.status}`);
  }

  const result = await res.json();
  const rawContent = result?.choices?.[0]?.message?.content || '';
  const items = parseJsonResponse(rawContent);

  return { items, rawContent };
}

function parseJsonResponse(raw: string): any[] {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Attempt to find JSON array in the response
    const s = cleaned.indexOf('[');
    const e = cleaned.lastIndexOf(']');
    if (s !== -1 && e > s) {
      try {
        const parsed = JSON.parse(cleaned.slice(s, e + 1));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        console.error(`[extract] Failed to parse AI JSON. First 200 chars: ${cleaned.slice(0, 200)}`);
        return [];
      }
    }
    console.error(`[extract] No JSON array found in AI response. First 200 chars: ${cleaned.slice(0, 200)}`);
    return [];
  }
}
