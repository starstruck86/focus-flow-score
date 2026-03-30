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

    const systemPrompt = `You are a sales enablement expert. Your job is to extract ONLY actionable sales tactics from content.

RULES:
- Each tactic must describe a SPECIFIC ACTION a sales rep can take
- Each tactic must be TESTABLE in a call or roleplay
- Each tactic must be tied to a MOMENT (when to use it)
- Phrase as a TACTIC, not a concept or summary
- If you cannot fill all required fields for a tactic, DO NOT include it

BAD examples (do NOT produce these):
- "Discovery is important for understanding customer needs"
- "Objection handling helps close deals"
- "Building rapport creates trust"

GOOD examples:
- Title: "Ask the impact question after surfacing pain"
  Tactic: "Once the prospect names a problem, immediately ask 'What happens if you don't solve this in the next 6 months?' to quantify urgency"
  When to use: "After the prospect admits a pain point during discovery"

Return a JSON array of 3-5 tactics with this exact structure:
[{
  "title": "short actionable title starting with a verb",
  "tactic_summary": "EXACTLY how to execute this tactic - specific words, sequence, technique",
  "when_to_use": "specific trigger condition or moment",
  "when_not_to_use": "when this would backfire or be inappropriate",
  "example_usage": "realistic talk track or script the rep could say",
  "why_it_matters": "one sentence on why this works",
  "chapter": "cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up",
  "knowledge_type": "skill|product|competitive",
  "sub_chapter": "optional sub-category"
}]

Only return the JSON array, no markdown.`;

    const userPrompt = `Extract actionable sales tactics from this ${resourceType || 'document'}:

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
        max_tokens: 2000,
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

    // Validate each item has required fields
    const validated = (items || []).filter((item: any) =>
      item.title &&
      item.tactic_summary && item.tactic_summary.length >= 20 &&
      item.when_to_use && item.when_to_use.length >= 10
    );

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
