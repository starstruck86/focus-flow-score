import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, accountName } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI gateway not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Scraping URL:', formattedUrl);

    // Step 1: Scrape the website with Firecrawl
    const scrapeResponse = await fetch(FIRECRAWL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ['markdown', 'links'],
        onlyMainContent: false,
        waitFor: 3000,
      }),
    });

    if (!scrapeResponse.ok) {
      const errText = await scrapeResponse.text();
      console.error('Firecrawl error:', scrapeResponse.status, errText);
      if (scrapeResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Firecrawl credits exhausted. Please top up your Firecrawl plan.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: `Scrape failed: ${scrapeResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const scrapeData = await scrapeResponse.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || '';
    const links = scrapeData?.data?.links || scrapeData?.links || [];

    console.log('Scraped', markdown.length, 'chars,', links.length, 'links');

    // Step 2: Use AI to analyze the scraped content
    const analysisPrompt = `Analyze this website for a B2B sales rep selling marketing automation / lifecycle marketing software.

Company: ${accountName || 'Unknown'}
Website: ${formattedUrl}

Website content:
${markdown.slice(0, 8000)}

Links found: ${JSON.stringify(links.slice(0, 50))}

Evaluate each signal and return structured data using the tool provided.

Signal definitions:
1. direct_ecommerce: Can customers buy products, tickets, or services directly online? Look for cart, checkout, buy buttons, ticket purchasing, donation flows.
2. email_sms_capture: Does the site actively capture email/SMS subscribers? Look for newsletter signups, popup forms, SMS opt-in, "join our list".
3. loyalty_membership: Does the company run loyalty, rewards, membership, donor, patron, VIP, insider, or perks programs?
4. category_complexity: Does the navigation show 5+ top-level categories? (Retail: Women, Men, Shoes, etc. Arts: Events, Exhibitions, Membership, Education, etc.)
5. crm_lifecycle_team_size: Estimate the number of CRM/lifecycle/retention/email marketing/marketing automation team members. Use 0 if no evidence, estimate 1-5 for small teams, 6+ for large teams.
6. mobile_app: Does the company have a mobile app? Look for app store links, "download our app".
7. marketing_platform_detected: What marketing/email platform is detected? Look for tracking pixels, form handlers, script tags (e.g., Mailchimp, Klaviyo, HubSpot, Marketo, SFMC, Braze, Iterable, Acoustic, Sailthru, etc.) Return the platform name or null.

For each boolean signal, also provide a confidence level: "high", "medium", or "low".`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert B2B sales intelligence analyst. Analyze websites to extract marketing maturity signals. Be precise about what you can and cannot determine from the available data.' },
          { role: 'user', content: analysisPrompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'report_signals',
              description: 'Report the detected lifecycle marketing signals for the account.',
              parameters: {
                type: 'object',
                properties: {
                  direct_ecommerce: { type: 'boolean', description: 'Can customers buy online?' },
                  direct_ecommerce_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  email_sms_capture: { type: 'boolean', description: 'Active email/SMS capture?' },
                  email_sms_capture_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  loyalty_membership: { type: 'boolean', description: 'Loyalty/membership/rewards program?' },
                  loyalty_membership_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  category_complexity: { type: 'boolean', description: '5+ top-level nav categories?' },
                  category_complexity_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  crm_lifecycle_team_size: { type: 'integer', description: 'Estimated CRM/lifecycle team size (0, 1-5, 6+)' },
                  crm_lifecycle_team_size_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  mobile_app: { type: 'boolean', description: 'Has mobile app?' },
                  mobile_app_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  marketing_platform_detected: { type: 'string', description: 'Marketing platform name or empty string' },
                  marketing_platform_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  summary: { type: 'string', description: '2-3 sentence summary of findings' },
                },
                required: ['direct_ecommerce', 'direct_ecommerce_confidence', 'email_sms_capture', 'email_sms_capture_confidence', 'loyalty_membership', 'loyalty_membership_confidence', 'category_complexity', 'category_complexity_confidence', 'crm_lifecycle_team_size', 'crm_lifecycle_team_size_confidence', 'mobile_app', 'mobile_app_confidence', 'marketing_platform_detected', 'marketing_platform_confidence', 'summary'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'report_signals' } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI gateway error:', aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limited. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'AI credits exhausted. Please add funds in Settings.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: `AI analysis failed: ${aiResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error('No tool call in AI response:', JSON.stringify(aiData));
      return new Response(
        JSON.stringify({ success: false, error: 'AI returned unexpected format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let signals;
    try {
      signals = JSON.parse(toolCall.function.arguments);
    } catch {
      console.error('Failed to parse AI arguments:', toolCall.function.arguments);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to parse AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Calculate scores
    const confidenceWeights: Record<string, number> = { high: 1.0, medium: 0.7, low: 0.4 };

    // Weighted ICP Fit Score (0-100)
    const signalWeights = [
      { value: signals.direct_ecommerce, confidence: signals.direct_ecommerce_confidence, weight: 25 },
      { value: signals.email_sms_capture, confidence: signals.email_sms_capture_confidence, weight: 15 },
      { value: signals.loyalty_membership, confidence: signals.loyalty_membership_confidence, weight: 15 },
      { value: signals.category_complexity, confidence: signals.category_complexity_confidence, weight: 10 },
      { value: signals.mobile_app, confidence: signals.mobile_app_confidence, weight: 5 },
      { value: (signals.marketing_platform_detected || '').length > 0, confidence: signals.marketing_platform_confidence, weight: 5 },
    ];

    let icpFitScore = 0;
    signalWeights.forEach(s => {
      if (s.value) {
        icpFitScore += s.weight * (confidenceWeights[s.confidence] || 0.5);
      }
    });

    // CRM team sweet spot scoring (bell curve): 0→0, 1-2→15, 3-5→25, 6-10→10, 11+→0
    const teamSize = signals.crm_lifecycle_team_size || 0;
    const teamConfidence = confidenceWeights[signals.crm_lifecycle_team_size_confidence] || 0.5;
    let teamScore = 0;
    if (teamSize >= 1 && teamSize <= 2) teamScore = 15;
    else if (teamSize >= 3 && teamSize <= 5) teamScore = 25;
    else if (teamSize >= 6 && teamSize <= 10) teamScore = 10;
    else if (teamSize > 10) teamScore = 0;
    icpFitScore += teamScore * teamConfidence;

    icpFitScore = Math.round(Math.min(100, icpFitScore));

    // Aggregate confidence
    const allConfidences = [
      signals.direct_ecommerce_confidence,
      signals.email_sms_capture_confidence,
      signals.loyalty_membership_confidence,
      signals.category_complexity_confidence,
      signals.crm_lifecycle_team_size_confidence,
      signals.mobile_app_confidence,
      signals.marketing_platform_confidence,
    ].map(c => confidenceWeights[c] || 0.5);
    const avgConfidence = Math.round((allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length) * 100);

    // Tier assignment from ICP fit score
    let lifecycleTier = '4';
    if (icpFitScore >= 75) lifecycleTier = '1';
    else if (icpFitScore >= 50) lifecycleTier = '2';
    else if (icpFitScore >= 25) lifecycleTier = '3';

    const result = {
      success: true,
      signals: {
        direct_ecommerce: signals.direct_ecommerce,
        email_sms_capture: signals.email_sms_capture,
        loyalty_membership: signals.loyalty_membership,
        category_complexity: signals.category_complexity,
        mobile_app: signals.mobile_app,
        marketing_platform_detected: signals.marketing_platform_detected || null,
        crm_lifecycle_team_size: signals.crm_lifecycle_team_size,
      },
      confidence: {
        direct_ecommerce: signals.direct_ecommerce_confidence,
        email_sms_capture: signals.email_sms_capture_confidence,
        loyalty_membership: signals.loyalty_membership_confidence,
        category_complexity: signals.category_complexity_confidence,
        mobile_app: signals.mobile_app_confidence,
        marketing_platform: signals.marketing_platform_confidence,
        crm_lifecycle_team_size: signals.crm_lifecycle_team_size_confidence,
      },
      scores: {
        icp_fit_score: icpFitScore,
        timing_score: 0, // No trigger events from website scrape alone
        priority_score: icpFitScore, // Will be recalculated when triggers are added
        lifecycle_tier: lifecycleTier,
        high_probability_buyer: false, // Needs timing > 0
        triggered_account: false,
        confidence_score: avgConfidence,
      },
      summary: signals.summary,
    };

    console.log('Enrichment complete:', JSON.stringify(result.scores));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Enrichment error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
