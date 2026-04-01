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

    // ── Standard vs Strict extraction prompts ─────────────
    const standardSystemPrompt = `You are a sales execution coach. Extract ACTIONABLE UNITS from content.

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
  "sub_chapter": "optional sub-category",
  "who": "person or thought leader behind this idea (e.g. Keenan, Matthew Dixon, Chris Voss). Use their known name. Leave empty string if unknown.",
  "framework": "methodology or system this belongs to (e.g. GAP Selling, Challenger Sale, MEDDICC, SPIN Selling). Leave empty string if not clearly tied to a framework."
}]

Only return the JSON array, no markdown.`;

    const strictSystemPrompt = `You are a STRICT sales execution extraction engine. Your job is to find ONLY the most specific, highest-quality actionable units.

STRICT MODE RULES — these override everything else:
1. EXACT PHRASES ONLY: Every unit MUST contain actual words a rep would say or write. Quote them directly.
2. NO GENERIC ACTIONS: "Follow up" or "Research the company" are NOT valid. Must include HOW + WHAT EXACT WORDS.
3. MINIMUM SPECIFICITY: Every unit must reference a specific situation, persona type, objection, or deal stage.
4. PHRASING QUALITY: The example must sound like a real human rep, not an AI or textbook.
5. ATOMIC ACTIONS: One action per unit. If it has "and" connecting two different actions, split it.
6. SENTENCE-LEVEL EXTRACTION: Look for individual sentences or paragraphs that contain real talk tracks, questions, or phrases.
7. CHUNK DIFFERENTLY: Scan the content in small paragraphs, not as a whole. Extract from each paragraph independently.
8. REJECT AGGRESSIVELY: If in doubt, do NOT include it. Quality over quantity.

Return 2-8 MAXIMUM units. Fewer is better if the content doesn't have enough specifics.

Format as JSON array:
[{
  "title": "short verb-led title (MUST start with action verb)",
  "action_type": "say|ask|write|use",
  "what_to_do": "EXACT phrasing to use — must include quoted speech or specific steps",
  "when_to_use": "specific trigger: 'When [exact situation], after [exact event]'",
  "when_not_to_use": "specific counter-trigger",
  "example": "REALISTIC phrasing as a rep would actually say/write it — no corporate jargon",
  "why_it_matters": "concrete impact statement",
  "chapter": "cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up",
  "knowledge_type": "skill|product|competitive",
  "sub_chapter": "optional"
}]

Only return the JSON array, no markdown.`;

    const systemPrompt = strict ? strictSystemPrompt : standardSystemPrompt;

    // Strict mode: chunk content into smaller segments for better extraction
    let contentForExtraction: string;
    if (strict && content.length > 3000) {
      // Split into paragraphs, take meaningful ones
      const paragraphs = content.split(/\n\n+/).filter((p: string) => p.trim().length > 50);
      // Take first 8000 chars worth of meaningful paragraphs
      let accumulated = '';
      for (const p of paragraphs) {
        if (accumulated.length + p.length > 8000) break;
        accumulated += p + '\n\n';
      }
      contentForExtraction = accumulated || content.slice(0, 8000);
    } else {
      contentForExtraction = content.slice(0, 12000);
    }

    const userPrompt = strict
      ? `STRICT EXTRACTION — find only the most specific, quotable, usable actions from this ${resourceType || 'document'}.

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}

Scan each paragraph independently. Extract ONLY units with real quoted phrasing:

${contentForExtraction}`
      : `Extract actionable units from this ${resourceType || 'document'}:

Title: ${title}
${description ? `Description: ${description}` : ''}
Tags: ${(tags || []).join(', ')}

Content:
${contentForExtraction}`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: strict ? 'google/gemini-2.5-flash' : 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: strict ? 2000 : 3000,
        temperature: strict ? 0.15 : 0.3,
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
    const minExampleLen = strict ? 25 : 15;
    const minWhatLen = strict ? 30 : 20;
    const validated = (items || []).filter((item: any) =>
      item.title &&
      item.what_to_do && item.what_to_do.length >= minWhatLen &&
      item.example && item.example.length >= minExampleLen &&
      item.when_to_use && item.when_to_use.length >= 10 &&
      item.action_type
    ).map((item: any) => ({
      ...item,
      tactic_summary: item.what_to_do,
      example_usage: item.example,
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
