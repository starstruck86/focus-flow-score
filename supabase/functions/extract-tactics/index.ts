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

    const systemPrompt = `You are a sales execution coach. Extract ACTIONABLE UNITS from content.

Every unit must be something a sales rep can directly:
- SAY in a conversation
- ASK a prospect
- WRITE in an email/doc
- USE in a deal workflow

RULES:
- Each unit must be a SPECIFIC ACTION, not a concept or summary
- Each unit must include EXACT PHRASING the rep can use
- If you cannot provide real words/phrases to say/write, DO NOT include it
- REJECT anything generic, conceptual, or descriptive-only

BAD (REJECT these):
- "Discovery is important" (concept)
- "Build rapport with prospects" (vague)
- "Understanding pricing helps close deals" (summary)

GOOD:
- title: "Ask the cost-of-inaction question"
  action_type: "ask"
  what_to_do: "After prospect names a pain, ask: 'What happens if you don't fix this in 6 months?'"
  when_to_use: "After prospect admits a specific pain point during discovery"
  example: "So you mentioned losing 15% of customers at renewal. What happens to your revenue if that continues for another year?"

Return 3-10 actionable units as a JSON array:
[{
  "title": "short verb-led title",
  "action_type": "say|ask|write|use",
  "what_to_do": "EXACTLY what to do — include specific words, phrases, or steps",
  "when_to_use": "specific trigger moment or context",
  "when_not_to_use": "when this would backfire",
  "example": "realistic talk track, email snippet, or exact phrasing",
  "why_it_matters": "one sentence on impact",
  "chapter": "cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up",
  "knowledge_type": "skill|product|competitive",
  "sub_chapter": "optional sub-category"
}]

Only return the JSON array, no markdown.`;

    const userPrompt = `Extract actionable units from this ${resourceType || 'document'}:

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}

Content:
${content.slice(0, 12000)}`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 3000,
        temperature: 0.3,
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

    // Validate: must have action-oriented fields
    const validated = (items || []).filter((item: any) =>
      item.title &&
      item.what_to_do && item.what_to_do.length >= 20 &&
      item.example && item.example.length >= 15 &&
      item.when_to_use && item.when_to_use.length >= 10 &&
      item.action_type
    ).map((item: any) => ({
      ...item,
      // Map to knowledge item format for compatibility
      tactic_summary: item.what_to_do,
      example_usage: item.example,
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
