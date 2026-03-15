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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { feedback, previousBatchId } = await req.json();

    // Get user's existing accounts to avoid suggesting duplicates
    const { data: existingAccounts } = await supabase
      .from('accounts')
      .select('name, website, industry, icp_fit_score, tier')
      .order('icp_fit_score', { ascending: false })
      .limit(50);

    // Get ICP profile from top accounts
    const topAccounts = (existingAccounts || []).filter(a => (a.icp_fit_score || 0) >= 50);
    const existingNames = (existingAccounts || []).map(a => a.name.toLowerCase());

    // Get previous feedback if any
    let feedbackContext = '';
    if (feedback) {
      feedbackContext = `\nUser feedback on previous suggestions: "${feedback}"`;
    }
    if (previousBatchId) {
      const { data: prevBatch } = await supabase
        .from('icp_sourced_accounts')
        .select('company_name, status, feedback')
        .eq('batch_id', previousBatchId);
      if (prevBatch?.length) {
        const liked = prevBatch.filter(b => b.status === 'accepted').map(b => b.company_name);
        const rejected = prevBatch.filter(b => b.status === 'rejected').map(b => `${b.company_name} (${b.feedback || 'no reason'})`);
        if (liked.length) feedbackContext += `\nUser liked: ${liked.join(', ')}`;
        if (rejected.length) feedbackContext += `\nUser rejected: ${rejected.join(', ')}`;
      }
    }

    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Step 1: Use Perplexity for real-time signal detection
    let signals = '';
    if (PERPLEXITY_API_KEY) {
      try {
        const industries = [...new Set(topAccounts.map(a => a.industry).filter(Boolean))].slice(0, 5);
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
              content: `Find 5 mid-market to enterprise B2B/DTC companies that recently showed buying signals for lifecycle marketing or marketing automation software. Look for:

1. Companies that recently hired a VP/Director of CRM, Lifecycle Marketing, Retention, or Growth
2. Companies that raised funding and are scaling their marketing team
3. Companies switching or evaluating ESPs (email service providers) like Klaviyo, Braze, Iterable, SFMC
4. Companies that recently launched ecommerce or loyalty programs
5. Companies with recent news about digital transformation or customer experience initiatives

${industries.length ? `Focus on industries similar to: ${industries.join(', ')}` : 'Focus on retail, ecommerce, DTC, consumer brands, and multi-location businesses'}

For each company provide: name, website, industry, what triggered the signal, approximate size, and any key contacts you find.

EXCLUDE these companies (already in CRM): ${existingNames.slice(0, 30).join(', ')}
${feedbackContext}`,
            }],
            search_recency_filter: 'month',
          }),
        });

        if (searchResp.ok) {
          const data = await searchResp.json();
          signals = data.choices?.[0]?.message?.content || '';
        }
      } catch (err) {
        console.error('Perplexity search failed:', err);
      }
    }

    // Step 2: Structure with AI
    const batchId = crypto.randomUUID();
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
            content: 'You are an ICP account sourcing engine for a B2B SaaS company selling lifecycle marketing / marketing automation software. Identify high-fit prospect accounts based on buying signals.',
          },
          {
            role: 'user',
            content: `Based on my ICP profile (top accounts):
${topAccounts.slice(0, 10).map(a => `- ${a.name} (${a.industry || 'unknown'}, Tier ${a.tier}, ICP ${a.icp_fit_score})`).join('\n')}

Signal research:
${signals || 'No live research available. Use your knowledge to suggest companies matching the ICP.'}

Existing accounts to EXCLUDE: ${existingNames.slice(0, 30).join(', ')}
${feedbackContext}

Find exactly 5 high-fit prospect accounts. Each must have a clear, recent buying signal or strong ICP match. Prioritize companies with verifiable signals.`,
          },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'suggest_accounts',
            description: 'Suggest 5 ICP-fit prospect accounts',
            parameters: {
              type: 'object',
              properties: {
                accounts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      company_name: { type: 'string' },
                      website: { type: 'string' },
                      industry: { type: 'string' },
                      employee_count: { type: 'string' },
                      hq_location: { type: 'string' },
                      icp_fit_reason: { type: 'string', description: '2-3 sentences on why they fit the ICP' },
                      trigger_signal: { type: 'string', description: 'The specific buying signal detected' },
                      signal_date: { type: 'string', description: 'When the signal was detected (approximate)' },
                      news_snippet: { type: 'string', description: 'Relevant news or context' },
                      fit_score: { type: 'number', description: '0-100 ICP fit score' },
                      suggested_contacts: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            title: { type: 'string' },
                            linkedin_url: { type: 'string' },
                          },
                          required: ['name', 'title'],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ['company_name', 'icp_fit_reason', 'trigger_signal', 'fit_score'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['accounts'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'suggest_accounts' } },
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
    if (!toolCall) throw new Error('No structured response');

    const { accounts: suggestions } = JSON.parse(toolCall.function.arguments);

    // Save to DB
    const rows = (suggestions || []).map((s: any) => ({
      user_id: user.id,
      company_name: s.company_name,
      website: s.website || null,
      industry: s.industry || null,
      employee_count: s.employee_count || null,
      hq_location: s.hq_location || null,
      icp_fit_reason: s.icp_fit_reason,
      trigger_signal: s.trigger_signal || null,
      signal_date: s.signal_date || null,
      suggested_contacts: s.suggested_contacts || [],
      news_snippet: s.news_snippet || null,
      fit_score: s.fit_score || 0,
      batch_id: batchId,
      status: 'new',
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('icp_sourced_accounts').insert(rows);
      if (insertError) console.error('Insert error:', insertError);
    }

    return new Response(JSON.stringify({
      success: true,
      batch_id: batchId,
      accounts: suggestions,
      count: suggestions?.length || 0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('source-icp-accounts error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
