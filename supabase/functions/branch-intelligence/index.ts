import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: { user }, error: authError } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  ).auth.getUser();

  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const { accountName, industry, notes, tags, vertical } = await req.json();

  const relevantDimensions = ['expansion_strategy', 'discovery', 'product_knowledge', 'deal_control'];
  const allKIs: any[] = [];

  for (const dim of relevantDimensions) {
    const { data: kis } = await supabase
      .from('knowledge_items')
      .select('title, tactic_summary, when_to_use, spider_dimension')
      .eq('user_id', user.id)
      .eq('chapter', 'branch_io')
      .eq('spider_dimension', dim)
      .eq('active', true)
      .order('confidence_score', { ascending: false })
      .limit(3);
    if (kis) allKIs.push(...kis);
  }

  const kiContext = allKIs.map(k =>
    `[${k.spider_dimension}] ${k.title}: ${k.tactic_summary}${k.when_to_use ? ` | When: ${k.when_to_use}` : ''}`
  ).join('\n');

  const verticalGuide: Record<string, string> = {
    'media': 'streaming/content app attribution, viewer journey tracking, email-to-app for subscriber retention',
    'travel': 'loyalty app journeys, booking attribution, QR in-property, web-to-app for search traffic',
    'retail': 'email/SMS-to-app conversion, loyalty program attribution, in-store QR, web-to-app',
    'healthcare': 'member portal app journeys, HIPAA-compliant attribution, pharmacy app linking',
    'fintech': 'account acquisition journeys, mobile banking attribution, deferred deep linking for applications',
    'telecom': 'service app attribution, upgrade journey tracking, cross-product linking',
  };

  const verticalKey = Object.keys(verticalGuide).find(k =>
    (industry || '').toLowerCase().includes(k) || (vertical || '').toLowerCase().includes(k)
  ) || 'retail';
  const verticalContext = verticalGuide[verticalKey];

  const systemPrompt = `You are a Branch.io Strategic Account Executive preparing for expansion conversations. Branch.io is a mobile measurement, deep linking, and attribution platform. You help existing customers grow their usage — more use cases, more apps, more business units.

Your job is to generate Account Intelligence for an expansion call. Be specific, direct, and commercially useful. Reference Branch product capabilities naturally. Keep each section concise.`;

  const userPrompt = `Generate Branch.io expansion intelligence for ${accountName}.

ACCOUNT CONTEXT:
- Industry: ${industry || 'Not specified'}
- Vertical use cases: ${verticalContext}
- Tags: ${(tags || []).join(', ')}
- Notes: ${notes || 'No notes available'}

BRANCH KI LIBRARY CONTEXT (our plays for this type of account):
${kiContext}

Generate a JSON response with exactly these fields:
{
  "expansion_whitespace": "2-3 sentences: what Branch use cases/products this account likely hasn't fully adopted yet and why. Be specific to their vertical.",
  "discovery_questions": ["5 Branch-specific discovery questions that would uncover expansion opportunity at this account. Make them specific to their vertical and current account context."],
  "expansion_angle": "1-2 sentences: the primary expansion narrative — the single best reason to grow Branch usage at this account right now.",
  "first_outreach": "One crisp, specific opening line for an executive email or call opener. Should reference a Branch outcome relevant to their vertical.",
  "branch_products_to_focus": ["2-3 specific Branch products or capabilities most relevant to this account's expansion"]
}

Respond with ONLY the JSON object. No preamble, no markdown backticks.`;

  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: 'Failed to parse response', raw: text };
  }

  return new Response(JSON.stringify(parsed), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
