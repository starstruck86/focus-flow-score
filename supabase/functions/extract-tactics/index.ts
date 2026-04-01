import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

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
      return new Response(JSON.stringify({ items: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `You are an elite sales execution coach. Extract TACTICAL PLAYS from content.

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

Return 2-6 high-quality tactical plays as a JSON array. Fewer is better — quality over quantity.
Only return the JSON array, no markdown fences.`;

    // Chunk content for extraction
    let contentForExtraction: string;
    if (content.length > 3000) {
      const paragraphs = content.split(/\n\n+/).filter((p: string) => p.trim().length > 50);
      let accumulated = '';
      for (const p of paragraphs) {
        if (accumulated.length + p.length > 10000) break;
        accumulated += p + '\n\n';
      }
      contentForExtraction = accumulated || content.slice(0, 10000);
    } else {
      contentForExtraction = content.slice(0, 12000);
    }

    const userPrompt = `Extract structured tactical plays from this ${resourceType || 'document'}:

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}

Content:
${contentForExtraction}

Remember: every play MUST include source_excerpt (verbatim quote), source_location, framework, and who. No play without attribution.`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 6000,
        temperature: 0.2,
      }),
    });

    if (!aiRes.ok) {
      const status = aiRes.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited, try again later' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: 'Credits exhausted' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('AI error:', status, await aiRes.text());
      return new Response(JSON.stringify({ items: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await aiRes.json();
    const raw = aiResult.choices?.[0]?.message?.content || '[]';

    let items;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      items = JSON.parse(cleaned);
    } catch {
      items = [];
    }

    // Strict validation — reject low-quality or unattributed items
    const MIN_FIELD_LEN = 40;
    const HTML_PATTERN = /<[a-z][\s\S]*>/i;

    const validated = (items || []).filter((item: any) => {
      // Required attribution
      if (!item.framework || item.framework.trim() === '') return false;
      if (!item.who || item.who.trim() === '') return false;
      if (!item.source_excerpt || item.source_excerpt.length < 20) return false;
      if (!item.source_location || item.source_location.trim() === '') return false;

      // Required tactical depth
      if (!item.title) return false;
      if (!item.tactic_summary || item.tactic_summary.length < 30) return false;
      if (!item.macro_situation || item.macro_situation.length < MIN_FIELD_LEN) return false;
      if (!item.micro_strategy || item.micro_strategy.length < MIN_FIELD_LEN) return false;
      if (!item.how_to_execute || item.how_to_execute.length < MIN_FIELD_LEN) return false;
      if (!item.when_to_use || item.when_to_use.length < 20) return false;

      // Example required
      const example = item.example_usage || item.example || '';
      if (example.length < 30) return false;

      // Reject HTML/CSS artifacts
      const allText = [item.title, item.tactic_summary, item.macro_situation, item.how_to_execute, example].join(' ');
      if (HTML_PATTERN.test(allText)) return false;

      return true;
    }).map((item: any) => ({
      ...item,
      tactic_summary: item.tactic_summary,
      example_usage: item.example_usage || item.example,
      why_it_matters: item.why_it_matters || item.why_this_works || item.micro_strategy,
      what_this_unlocks: item.what_this_unlocks || null,
      source_title: title, // from the resource being extracted
    }));

    return new Response(JSON.stringify({ items: validated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('extract-tactics error:', error);
    return new Response(JSON.stringify({ error: 'Extraction failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
