import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { accountId, accountName, website, industry, opportunityContext } = await req.json();
    if (!accountId || !accountName) {
      return new Response(JSON.stringify({ error: 'accountId and accountName required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get existing contacts for this account to avoid duplicates
    const { data: existingContacts } = await supabase
      .from('contacts')
      .select('name, title, linkedin_url')
      .eq('account_id', accountId);

    const existingNames = (existingContacts || []).map(c => c.name.toLowerCase());

    // Step 1: Use Perplexity to find key people
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let searchResults = '';
    if (PERPLEXITY_API_KEY) {
      try {
        const searchResp = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'sonar-pro',
            messages: [{
              role: 'user',
              content: `Find key decision makers and stakeholders at "${accountName}" (${website || 'no website'}), ${industry || 'unknown industry'}.

I'm selling lifecycle marketing / marketing automation software. Find people in these roles:
- VP/Director/Head of Marketing, CRM, Lifecycle, Retention, Growth, Digital, Ecommerce
- CMO, CDO, CRO, VP Revenue
- Marketing Managers focused on email, SMS, loyalty, retention
- Ecommerce Directors/Managers
- IT/Technology leaders who influence martech decisions

For each person found, provide:
- Full name
- Current title at the company  
- LinkedIn profile URL if findable
- Their likely buyer role (Champion, Economic Buyer, Technical Buyer, User Buyer, Coach, Influencer)

Search LinkedIn, the company website about/team page, recent press releases, and conference speaker lists.
Return as many relevant contacts as you can find (aim for 5-10).`,
            }],
          }),
        });

        if (searchResp.ok) {
          const searchData = await searchResp.json();
          searchResults = searchData.choices?.[0]?.message?.content || '';
        }
      } catch (err) {
        console.error('Perplexity search failed:', err);
      }
    }

    // Step 2: Use AI to structure the results
    const aiResp = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a B2B sales intelligence tool. Structure discovered contacts into a JSON array. Each contact should have buyer_role from: champion, economic_buyer, technical_buyer, user_buyer, coach, influencer, blocker, unknown.`,
          },
          {
            role: 'user',
            content: `Company: "${accountName}" (${website || 'no website'}, ${industry || ''})
${opportunityContext ? `Opportunity context: ${opportunityContext}` : ''}

Already known contacts (skip these): ${existingNames.join(', ') || 'none'}

Research findings:
${searchResults || 'No web research available. Use your knowledge of typical org structures for this type of company.'}

Return a JSON array of discovered contacts. For companies without specific results, suggest typical roles that would be involved in a lifecycle marketing software purchase.`,
          },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'structure_contacts',
            description: 'Structure discovered contacts',
            parameters: {
              type: 'object',
              properties: {
                contacts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      title: { type: 'string' },
                      department: { type: 'string' },
                      seniority: { type: 'string', enum: ['c-suite', 'vp', 'director', 'manager', 'individual'] },
                      buyer_role: { type: 'string', enum: ['champion', 'economic_buyer', 'technical_buyer', 'user_buyer', 'coach', 'influencer', 'blocker', 'unknown'] },
                      influence_level: { type: 'string', enum: ['high', 'medium', 'low'] },
                      linkedin_url: { type: 'string' },
                      notes: { type: 'string' },
                      confidence: { type: 'string', enum: ['verified', 'likely', 'suggested'] },
                    },
                    required: ['name', 'title', 'buyer_role'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['contacts'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'structure_contacts' } },
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (status === 402) return new Response(JSON.stringify({ error: 'AI credits exhausted' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      throw new Error(`AI error: ${status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error('No structured response from AI');

    const { contacts: discovered } = JSON.parse(toolCall.function.arguments);

    // Filter out contacts that already exist
    const newContacts = (discovered || []).filter(
      (c: any) => !existingNames.includes(c.name.toLowerCase())
    );

    return new Response(JSON.stringify({
      success: true,
      contacts: newContacts,
      total_found: discovered?.length || 0,
      new_contacts: newContacts.length,
      source: PERPLEXITY_API_KEY ? 'perplexity+ai' : 'ai-knowledge',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('discover-contacts error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
