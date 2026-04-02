import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Single-resource KI extraction endpoint.
 * Accepts: { resourceId: string }
 * Returns: { resourceId, title, kis, error? }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resourceId } = await req.json();

    if (!resourceId || typeof resourceId !== 'string') {
      return new Response(JSON.stringify({ error: 'resourceId (string) required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Fetch single resource ──
    const { data: resource, error: fetchError } = await supabase
      .from('resources')
      .select('id, title, resource_type, content, description, tags, user_id')
      .eq('id', resourceId)
      .single();

    if (fetchError || !resource) {
      return new Response(JSON.stringify({ error: fetchError?.message || 'Resource not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!resource.content || resource.content.length < 200) {
      return respond({ resourceId, title: resource.title, kis: 0, error: 'Content too short (<200 chars)' });
    }

    console.log(`[extract] Starting: "${resource.title}" (${resource.content.length} chars)`);

    // ── Idempotency: delete existing KIs for this resource before re-extracting ──
    const { error: deleteError } = await supabase
      .from('knowledge_items')
      .delete()
      .eq('source_resource_id', resourceId);

    if (deleteError) {
      console.error(`[extract] Failed to clear old KIs: ${deleteError.message}`);
    }

    // ── Call AI ──
    let rawItems: any[];
    try {
      rawItems = await callAI(LOVABLE_API_KEY, resource.content, resource.title, resource.tags || []);
    } catch (aiErr: any) {
      await updateResourceStatus(supabase, resourceId, 'extraction_failed');
      return respond({ resourceId, title: resource.title, kis: 0, error: `AI error: ${aiErr.message}` });
    }

    console.log(`[extract] "${resource.title}": ${rawItems.length} raw items from AI`);

    // ── Normalize, validate, deduplicate ──
    const validated = rawItems
      .map(normalizeItem)
      .filter((item) => {
        const reasons = validateItem(item);
        if (reasons.length > 0) {
          console.log(`[extract] REJECTED "${(item.title || '').slice(0, 50)}": ${reasons.join('; ')}`);
          return false;
        }
        return true;
      });

    const deduped = deduplicateItems(validated).slice(0, 15);
    console.log(`[extract] "${resource.title}": ${deduped.length} after validation+dedup`);

    if (deduped.length === 0) {
      await updateResourceStatus(supabase, resourceId, 'extraction_empty');
      return respond({ resourceId, title: resource.title, kis: 0, error: 'No items passed validation' });
    }

    // ── Build insert rows ──
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
      await updateResourceStatus(supabase, resourceId, 'extraction_failed');
      return respond({ resourceId, title: resource.title, kis: 0, error: `Insert failed: ${insertError.message}` });
    }

    // ── Update resource status ──
    await updateResourceStatus(supabase, resourceId, 'extracted');
    console.log(`[extract] ✅ "${resource.title}": ${rows.length} KIs inserted`);

    return respond({ resourceId, title: resource.title, kis: rows.length });
  } catch (error: any) {
    console.error('[extract] Unhandled error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Helpers ───

function respond(data: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function updateResourceStatus(supabase: any, resourceId: string, status: string) {
  const { error } = await supabase
    .from('resources')
    .update({ enrichment_status: status, updated_at: new Date().toISOString() })
    .eq('id', resourceId);
  if (error) console.error(`[extract] Status update failed: ${error.message}`);
}

// ─── Normalization ───

const VALID_CHAPTERS = new Set([
  'cold_calling', 'discovery', 'objection_handling', 'negotiation', 'competitors',
  'personas', 'messaging', 'closing', 'stakeholder_navigation', 'expansion', 'demo', 'follow_up',
]);
const VALID_TYPES = new Set(['skill', 'product', 'competitive']);

function normalizeItem(raw: any): any {
  const str = (v: any, fallback = '') => {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map((x: any) => typeof x === 'string' ? x.trim() : String(x)).join('\n');
    return fallback;
  };
  const arr = (v: any) => (Array.isArray(v) ? v.filter((x: any) => typeof x === 'string') : []);

  const chapter = str(raw.chapter).toLowerCase().replace(/[\s-]+/g, '_');
  const knowledgeType = str(raw.knowledge_type).toLowerCase();

  return {
    title: str(raw.title),
    framework: str(raw.framework, 'General'),
    who: str(raw.who, 'Unknown'),
    source_excerpt: str(raw.source_excerpt),
    source_location: str(raw.source_location),
    macro_situation: str(raw.macro_situation),
    micro_strategy: str(raw.micro_strategy),
    why_it_matters: str(raw.why_it_matters),
    how_to_execute: str(raw.how_to_execute),
    what_this_unlocks: str(raw.what_this_unlocks),
    when_to_use: str(raw.when_to_use),
    when_not_to_use: str(raw.when_not_to_use),
    example_usage: str(raw.example_usage || raw.example),
    tactic_summary: str(raw.tactic_summary),
    chapter: VALID_CHAPTERS.has(chapter) ? chapter : 'messaging',
    knowledge_type: VALID_TYPES.has(knowledgeType) ? knowledgeType : 'skill',
    sub_chapter: str(raw.sub_chapter) || null,
    applies_to_contexts: arr(raw.applies_to_contexts).length > 0 ? arr(raw.applies_to_contexts) : ['all'],
    tags: arr(raw.tags),
  };
}

// ─── Validation (returns array of rejection reasons) ───

function validateItem(item: any): string[] {
  const reasons: string[] = [];
  if (!item.title || item.title.length < 5) reasons.push('title too short');
  if (!item.tactic_summary || item.tactic_summary.length < 20) reasons.push('tactic_summary too short');
  if (!item.how_to_execute || item.how_to_execute.length < 20) reasons.push('how_to_execute too short');
  if (!item.when_to_use || item.when_to_use.length < 15) reasons.push('when_to_use too short');
  if (!item.source_excerpt || item.source_excerpt.length < 20) reasons.push('source_excerpt too short');
  if (!item.macro_situation || item.macro_situation.length < 15) reasons.push('macro_situation too short');
  if (!item.framework || item.framework === '') reasons.push('framework missing');
  if (!item.who || item.who === '') reasons.push('who missing');
  return reasons;
}

// ─── Deduplication ───

function deduplicateItems(items: any[]): any[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = (s: string) => new Set(norm(s).split(/\s+/).filter(w => w.length > 2));
  const result: any[] = [];
  for (const item of items) {
    const iw = words(item.title || '');
    let isDupe = false;
    for (const existing of result) {
      const ew = words(existing.title || '');
      const overlap = [...iw].filter(w => ew.has(w)).length / Math.max(Math.min(iw.size, ew.size), 1);
      if (overlap > 0.6) { isDupe = true; break; }
    }
    if (!isDupe) result.push(item);
  }
  return result;
}

// ─── AI Call ───

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
9. "how_to_execute" — HOW step by step. 3-5 concrete steps with exact phrasing.
10. "what_this_unlocks" — OUTCOME. 2-3 sentences.
11. "when_to_use" — trigger conditions (2-3 sentences)
12. "when_not_to_use" — boundaries (2-3 sentences)
13. "example_usage" — realistic talk track. Min 3-4 sentences.
14. "tactic_summary" — concise 2-3 sentence summary
15. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
16. "knowledge_type" — skill|product|competitive

QUALITY GATES — REJECT any item that:
- Has fields shorter than 2 sentences (except title, chapter, knowledge_type)
- Is generic advice without specific phrasing
- Describes what to think rather than what to DO

Return ONLY a JSON array. Extract 4-8 plays. Quality over quantity.`;

async function callAI(apiKey: string, content: string, title: string, tags: string[]): Promise<any[]> {
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

  if (!res.ok) throw new Error(`AI returned ${res.status}`);
  return parseResponse(await res.json());
}

function parseResponse(result: any): any[] {
  const raw = result?.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const s = cleaned.indexOf('['), e = cleaned.lastIndexOf(']');
    if (s !== -1 && e > s) {
      try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { return []; }
    }
    return [];
  }
}
