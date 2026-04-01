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

    const { title, content, description, tags, resourceType, strict } = await req.json();

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

A Knowledge Item is a PLAY — a structured, situational, reusable tactical entry that tells a rep exactly when, why, and how to execute.

EVERY knowledge item MUST include ALL of these fields with PARAGRAPH-LEVEL depth (not 1-2 sentences):

1. "title" — verb-led action title (e.g. "Reframe the budget objection using cost-of-inaction")
2. "framework" — methodology this belongs to (GAP Selling, Challenger Sale, MEDDPICC, Command of the Message, SPIN, or empty string)
3. "who" — thought leader (Keenan, Dixon, McMahon, Force Management, Chris Voss, or empty string)
4. "macro_situation" — WHEN does this play apply? Describe the big-picture scenario in 2-4 sentences. Include deal stage, buyer behavior, competitive dynamics. Example: "You're mid-discovery with a prospect who has admitted operational pain but hasn't connected it to financial impact. They're still in 'exploring' mode and haven't built internal urgency. There may be competing priorities that could stall the deal."
5. "micro_strategy" — WHAT are you specifically doing? 2-3 sentences on the tactical approach. Example: "You're going to bridge their operational complaint to a quantified business impact by asking a sequence of impact questions that force them to calculate the cost themselves."
6. "why_it_matters" — WHY does this work? 2-3 sentences on the psychology or sales principle. Example: "Prospects who self-discover the financial impact of their problem are 3x more likely to act with urgency. When they calculate the number themselves, they own it — it's no longer your claim, it's their reality."
7. "how_to_execute" — HOW to do it, step by step. 3-5 concrete steps with exact phrasing where applicable. Must be immediately usable in a real conversation.
8. "what_this_unlocks" — OUTCOME: what happens when you execute this well? 2-3 sentences. Example: "The prospect shifts from 'exploring' to 'committed buyer.' They start asking YOU how fast you can implement, and they volunteer to bring in their CFO."
9. "when_to_use" — specific trigger conditions (2-3 sentences, not a single phrase)
10. "when_not_to_use" — boundaries and anti-patterns (2-3 sentences)
11. "example_usage" — a REALISTIC, conversational talk track or email snippet. Must sound like a real human, not a textbook. Minimum 3-4 sentences.
12. "tactic_summary" — concise 2-3 sentence summary of the play for quick reference
13. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
14. "knowledge_type" — skill|product|competitive
15. "sub_chapter" — optional sub-category

QUALITY GATES — REJECT any item that:
- Has any field shorter than 2 sentences (except title, chapter, knowledge_type, sub_chapter, who, framework)
- Is generic advice without specific phrasing
- Contains UI/HTML/CSS artifacts
- Describes what to think rather than what to DO
- Could apply to any situation (not situational enough)

Return 2-6 high-quality tactical plays as a JSON array. Fewer is better — quality over quantity.

Only return the JSON array, no markdown fences.`;

    // Chunk content for better extraction
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

Remember: each play must be a COMPLETE tactical entry with paragraph-level depth in every field. No short fragments.`;

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

    // Quality validation — reject low-quality items
    const MIN_FIELD_LEN = 40;
    const validated = (items || []).filter((item: any) => {
      if (!item.title || !item.tactic_summary) return false;
      if (!item.macro_situation || item.macro_situation.length < MIN_FIELD_LEN) return false;
      if (!item.micro_strategy || item.micro_strategy.length < MIN_FIELD_LEN) return false;
      if (!item.how_to_execute || item.how_to_execute.length < MIN_FIELD_LEN) return false;
      if (!item.what_this_unlocks || item.what_this_unlocks.length < MIN_FIELD_LEN) return false;
      if (!item.when_to_use || item.when_to_use.length < 20) return false;
      if (!item.example_usage && !item.example) return false;
      const example = item.example_usage || item.example || '';
      if (example.length < 30) return false;
      return true;
    }).map((item: any) => ({
      ...item,
      tactic_summary: item.tactic_summary,
      example_usage: item.example_usage || item.example,
      why_it_matters: item.why_it_matters || item.micro_strategy,
    }));

    return new Response(JSON.stringify({ items: validated, mode: strict ? 'strict' : 'standard' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('extract-tactics error:', error);
    return new Response(JSON.stringify({ error: 'Extraction failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
