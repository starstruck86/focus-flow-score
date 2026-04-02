import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

const SYSTEM_PROMPT = `You are an elite sales execution coach. Extract TACTICAL PLAYS from content.

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

Return 2-4 high-quality tactical plays as a JSON array. Fewer is better — quality over quantity.
Only return the JSON array, no markdown fences.`;

const CHUNK_SIZE = 8000;
const CHUNK_OVERLAP = 500;
const MAX_KIS_PER_RESOURCE = 15;
const SINGLE_PASS_THRESHOLD = 12000;
const PRIMARY_MAX_TOKENS = 12000;
const RETRY_MAX_TOKENS = 12000;

/** Split content into overlapping chunks on paragraph boundaries */
function chunkContent(content: string): string[] {
  if (content.length <= SINGLE_PASS_THRESHOLD) return [content];

  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20);
  const chunks: string[] = [];
  let current = '';
  let overlapBuffer = '';

  for (const para of paragraphs) {
    if (current.length + para.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current);
      // Start next chunk with overlap from end of current
      overlapBuffer = current.slice(-CHUNK_OVERLAP);
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
    const status = res.status;
    // On 429 retry once after 2s
    if (status === 429) {
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
    throw new Error(`AI error: ${status}`);
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

/** Call AI gateway for a single chunk */
async function extractFromChunk(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<any[]> {
  const primaryResult = await requestExtraction(apiKey, systemPrompt, userPrompt, PRIMARY_MAX_TOKENS);
  let items = parseAiResponse(primaryResult);

  if (items.length > 0 && !isTruncatedResponse(primaryResult)) {
    return items;
  }

  const retryPrompt = `${userPrompt}\n\nIMPORTANT: Return exactly 2 tactical plays maximum. Keep every field complete but concise, and output valid JSON only.`;
  const retryResult = await requestExtraction(apiKey, systemPrompt, retryPrompt, RETRY_MAX_TOKENS);
  const retryItems = parseAiResponse(retryResult);

  if (retryItems.length > 0) {
    items = retryItems;
  }

  return items;
}

/** Deduplicate by title similarity */
function deduplicateItems(items: any[]): any[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = (s: string) => new Set(normalize(s).split(/\s+/).filter(w => w.length > 2));

  const result: any[] = [];
  for (const item of items) {
    const itemWords = words(item.title || '');
    let isDupe = false;
    for (let i = 0; i < result.length; i++) {
      const existingWords = words(result[i].title || '');
      // Check containment or >60% word overlap
      const intersection = [...itemWords].filter(w => existingWords.has(w));
      const overlapRatio = intersection.length / Math.min(itemWords.size, existingWords.size);
      if (overlapRatio > 0.6 || normalize(item.title).includes(normalize(result[i].title)) || normalize(result[i].title).includes(normalize(item.title))) {
        isDupe = true;
        // Keep the one with longer source_excerpt
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

/** Validate a single extracted item */
function validateItem(item: any): boolean {
  const MIN_FIELD_LEN = 40;
  const HTML_PATTERN = /<[a-z][\s\S]*>/i;

  if (!item.framework || item.framework.trim() === '') return false;
  if (!item.who || item.who.trim() === '') return false;
  if (!item.source_excerpt || item.source_excerpt.length < 20) return false;
  if (!item.source_location || item.source_location.trim() === '') return false;
  if (!item.title) return false;
  if (!item.tactic_summary || item.tactic_summary.length < 30) return false;
  if (!item.macro_situation || item.macro_situation.length < MIN_FIELD_LEN) return false;
  if (!item.micro_strategy || item.micro_strategy.length < MIN_FIELD_LEN) return false;
  if (!item.how_to_execute || item.how_to_execute.length < MIN_FIELD_LEN) return false;
  if (!item.when_to_use || item.when_to_use.length < 20) return false;

  const example = item.example_usage || item.example || '';
  if (example.length < 30) return false;

  const allText = [item.title, item.tactic_summary, item.macro_situation, item.how_to_execute, example].join(' ');
  if (HTML_PATTERN.test(allText)) return false;

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

    // ── Chunked extraction ──
    const chunks = chunkContent(content);
    const totalChunks = chunks.length;
    let processedChunks = 0;
    let failedChunks = 0;
    const allItems: any[] = [];

    console.log(`[extract-tactics] Content: ${content.length} chars → ${totalChunks} chunk(s)`);

    for (let i = 0; i < chunks.length; i++) {
      const chunkLabel = totalChunks > 1 ? `Chunk ${i + 1} of ${totalChunks}` : '';
      const approxPosition = totalChunks > 1
        ? `~${Math.round((i / totalChunks) * 100)}% through the content`
        : '';

      const userPrompt = `Extract structured tactical plays from this ${resourceType || 'document'}:

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}
${chunkLabel ? `\nPosition: ${chunkLabel} (${approxPosition})` : ''}
${totalChunks > 1 ? `\nIMPORTANT: Extract 2-4 plays from THIS section only. Do not repeat plays from other sections.` : ''}

Content:
${chunks[i]}

Remember: every play MUST include source_excerpt (verbatim quote), source_location, framework, and who. No play without attribution.`;

      try {
        const chunkItems = await extractFromChunk(LOVABLE_API_KEY, SYSTEM_PROMPT, userPrompt);
        // Tag items with chunk position
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

    // Deduplicate across chunks
    const deduped = deduplicateItems(allItems);

    // Validate and normalize
    const validated = deduped
      .filter(validateItem)
      .slice(0, MAX_KIS_PER_RESOURCE)
      .map((item: any) => ({
        ...item,
        tactic_summary: item.tactic_summary,
        example_usage: item.example_usage || item.example,
        why_it_matters: item.why_it_matters || item.why_this_works || item.micro_strategy,
        what_this_unlocks: item.what_this_unlocks || null,
        source_title: title,
      }));

    console.log(`[extract-tactics] Final: ${validated.length} validated items from ${processedChunks}/${totalChunks} chunks`);

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
