import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';

// Weighted ICP scoring config
const SIGNAL_WEIGHTS = {
  direct_ecommerce: 25,
  email_sms_capture: 15,
  loyalty_membership: 15,
  category_complexity: 10,
  mobile_app: 5,
  marketing_platform: 5,
};

const CONFIDENCE_MULTIPLIERS: Record<string, number> = { high: 1.0, medium: 0.7, low: 0.4 };

function crmTeamScore(size: number): number {
  if (size >= 3 && size <= 5) return 25;
  if (size >= 1 && size <= 2) return 15;
  if (size >= 6 && size <= 10) return 10;
  return 0;
}

function calculateScores(signals: any) {
  const conf = (key: string) => CONFIDENCE_MULTIPLIERS[signals[`${key}_confidence`]] || 0.5;

  let icpFitScore = 0;

  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    const signalKey = key === 'marketing_platform' ? 'marketing_platform_detected' : key;
    const val = key === 'marketing_platform'
      ? (signals.marketing_platform_detected || '').length > 0
      : !!signals[signalKey];
    if (val) icpFitScore += weight * conf(key === 'marketing_platform' ? 'marketing_platform' : key);
  }

  const teamSize = signals.crm_lifecycle_team_size || 0;
  icpFitScore += crmTeamScore(teamSize) * conf('crm_lifecycle_team_size');
  icpFitScore = Math.round(Math.min(100, icpFitScore));

  const confKeys = ['direct_ecommerce', 'email_sms_capture', 'loyalty_membership', 'category_complexity', 'mobile_app', 'marketing_platform', 'crm_lifecycle_team_size'];
  const avgConf = Math.round(
    (confKeys.map(k => CONFIDENCE_MULTIPLIERS[signals[`${k}_confidence`]] || 0.5).reduce((a, b) => a + b, 0) / confKeys.length) * 100
  );

  let lifecycleTier = '4';
  if (icpFitScore >= 75) lifecycleTier = '1';
  else if (icpFitScore >= 50) lifecycleTier = '2';
  else if (icpFitScore >= 25) lifecycleTier = '3';

  const highProbabilityBuyer = icpFitScore >= 60 && signals.direct_ecommerce && (signals.email_sms_capture || signals.loyalty_membership);

  return { icpFitScore, lifecycleTier, confidenceScore: avgConf, highProbabilityBuyer };
}

// Fetch company news and business summary via Perplexity
async function fetchCompanyIntelligence(companyName: string, websiteUrl: string): Promise<{
  businessSummary: string;
  recentNews: string;
} | null> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) {
    console.log('Perplexity not configured, skipping company intelligence');
    return null;
  }

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a B2B sales research assistant. Provide concise, factual intelligence for sales preparation. Use bullet points. Focus on actionable information.',
          },
          {
            role: 'user',
            content: `Research "${companyName}" (${websiteUrl}). Provide:

1. BUSINESS MODEL (2-3 sentences): How does this company make money? What do they sell, to whom, and through what channels?

2. RECENT NEWS & HIRES (past 12 months): List any notable company news, executive hires, funding rounds, acquisitions, product launches, partnerships, or strategic changes. Include dates when possible. If nothing notable found, say "No significant recent news found."

Keep it concise and factual. Focus on information useful for a B2B sales conversation.`,
          },
        ],
        search_recency_filter: 'year',
      }),
    });

    if (!response.ok) {
      console.error('Perplexity error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse sections
    const businessMatch = content.match(/BUSINESS MODEL[:\s]*\n?([\s\S]*?)(?=\n\s*(?:2\.|RECENT NEWS|$))/i);
    const newsMatch = content.match(/RECENT NEWS[^:]*[:\s]*\n?([\s\S]*?)$/i);

    return {
      businessSummary: (businessMatch?.[1] || content.split('\n').slice(0, 3).join('\n')).trim(),
      recentNews: (newsMatch?.[1] || '').trim(),
    };
  } catch (err) {
    console.error('Perplexity fetch failed:', err);
    return null;
  }
}

// Auto-discover website URL using Perplexity
async function discoverWebsite(companyName: string): Promise<string | null> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY || !companyName) return null;

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You find company websites. Respond with ONLY the URL, nothing else. No explanation, no markdown, just the bare URL starting with https://. If you cannot find it, respond with exactly "NOTFOUND".',
          },
          {
            role: 'user',
            content: `What is the official website URL for the company "${companyName}"?`,
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    if (raw === 'NOTFOUND' || !raw.includes('.')) return null;
    // Clean up - extract URL if wrapped in markdown
    const urlMatch = raw.match(/https?:\/\/[^\s\])"'>]+/);
    return urlMatch ? urlMatch[0].replace(/[.,;:!?)]+$/, '') : null;
  } catch (err) {
    console.error('Website discovery failed:', err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, accountName, accountId } = await req.json();

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Auto-discover website if not provided
    let formattedUrl = (url || '').trim();
    let discoveredUrl: string | null = null;
    if (!formattedUrl && accountName) {
      console.log('No URL provided, attempting auto-discovery for:', accountName);
      discoveredUrl = await discoverWebsite(accountName);
      if (!discoveredUrl) {
        return new Response(
          JSON.stringify({ success: false, error: `Could not find a website for "${accountName}". Please add a URL manually.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      formattedUrl = discoveredUrl;
      console.log('Discovered website:', formattedUrl);
    } else if (!formattedUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL or account name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Enriching:', formattedUrl, 'for account:', accountName);

    // Run Firecrawl and Perplexity in parallel
    const [scrapeResponse, companyIntel] = await Promise.all([
      fetch(FIRECRAWL_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: formattedUrl,
          formats: ['json'],
          jsonOptions: {
            schema: {
              type: 'object',
              properties: {
                direct_ecommerce: { type: 'boolean', description: 'Can customers buy products, tickets, or services directly online? Look for cart, checkout, buy buttons, ticket purchasing, donation flows.' },
                direct_ecommerce_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                direct_ecommerce_details: { type: 'string', description: 'What was found: name the ecommerce platform (Shopify, WooCommerce, BigCommerce, custom), list specific purchase flows observed.' },
                email_sms_capture: { type: 'boolean', description: 'Does the site actively capture email/SMS subscribers? Look for newsletter signups, popup forms, SMS opt-in.' },
                email_sms_capture_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                email_sms_capture_details: { type: 'string', description: 'What was found: describe each capture method observed — popup type, footer form, inline form, SMS opt-in. List ALL methods found.' },
                loyalty_membership: { type: 'boolean', description: 'Does the company run loyalty, rewards, membership, VIP, or perks programs?' },
                loyalty_membership_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                loyalty_membership_details: { type: 'string', description: 'What was found: name the program, describe the structure.' },
                category_complexity: { type: 'boolean', description: 'Does the navigation show 5+ top-level categories?' },
                category_complexity_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                category_complexity_details: { type: 'string', description: 'List ALL top-level navigation categories verbatim.' },
                crm_lifecycle_team_size: { type: 'integer', description: 'Estimated CRM/lifecycle/retention/email marketing team size. 0 if no evidence.' },
                crm_lifecycle_team_size_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                crm_lifecycle_team_size_details: { type: 'string', description: 'List specific roles, job postings, or team indicators.' },
                mobile_app: { type: 'boolean', description: 'Has mobile app? Look for app store links.' },
                mobile_app_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                mobile_app_details: { type: 'string', description: 'Name the app, list store links.' },
                // Marketing tech - specific platform names
                esp_platform: { type: 'string', description: 'Email Service Provider detected (e.g. Klaviyo, Mailchimp, HubSpot, SFMC, Braze, Iterable, Sailthru, Cordial, Ometria, Dotdigital, Emarsys). Empty string if none detected.' },
                sms_platform: { type: 'string', description: 'SMS marketing platform detected (e.g. Attentive, Postscript, Yotpo SMS, Klaviyo SMS, Twilio). Empty string if none detected.' },
                ecommerce_platform: { type: 'string', description: 'Ecommerce platform detected (e.g. Shopify, Shopify Plus, WooCommerce, BigCommerce, Magento, Salesforce Commerce Cloud, custom). Empty string if none.' },
                marketing_platform_detected: { type: 'string', description: 'Primary marketing automation / email platform detected. Empty string if none.' },
                marketing_platform_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                marketing_platform_details: { type: 'string', description: 'Name EVERY marketing tool/script detected with specifics. List ALL marketing tech observed.' },
                cdp_platform: { type: 'string', description: 'Customer Data Platform detected (e.g. Segment, mParticle, Tealium, Treasure Data). Empty string if none.' },
                personalization_platform: { type: 'string', description: 'Personalization/recommendation engine detected (e.g. Nosto, Dynamic Yield, Bloomreach, Certona). Empty string if none.' },
                reviews_platform: { type: 'string', description: 'Reviews/UGC platform detected (e.g. Yotpo, Bazaarvoice, PowerReviews, Stamped, Judge.me). Empty string if none.' },
                other_tech_detected: { type: 'string', description: 'Any other notable technology detected (chat widgets, BNPL, analytics). List everything notable.' },
                summary: { type: 'string', description: '2-3 sentence summary of lifecycle marketing maturity findings with specific observations.' },
              },
              required: ['direct_ecommerce', 'email_sms_capture', 'loyalty_membership', 'category_complexity', 'crm_lifecycle_team_size', 'mobile_app', 'marketing_platform_detected', 'esp_platform', 'sms_platform', 'ecommerce_platform', 'summary'],
            },
            prompt: `Analyze this website for a B2B sales rep selling marketing automation / lifecycle marketing software to ${accountName || 'this company'}. For EVERY signal, report exactly what you discovered — name specific platforms, programs, tools, page elements. Be thorough about detecting marketing technology: look at page source for scripts like Klaviyo, Attentive, Mailchimp, HubSpot, etc. Check for Shopify/WooCommerce indicators. The rep needs to know exactly what MarTech stack this company uses.`,
          },
          onlyMainContent: false,
          waitFor: 3000,
        }),
      }),
      fetchCompanyIntelligence(accountName || '', formattedUrl),
    ]);

    if (!scrapeResponse.ok) {
      const errText = await scrapeResponse.text();
      console.error('Firecrawl error:', scrapeResponse.status, errText);
      if (scrapeResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Firecrawl credits exhausted. Connect to Firecrawl with the email that created the connection and upgrade with coupon LOVABLE50 for 50% off.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: `Scrape failed: ${scrapeResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const scrapeData = await scrapeResponse.json();
    const signals = scrapeData?.data?.json || scrapeData?.data?.extract || scrapeData?.extract || scrapeData?.json;

    if (!signals || typeof signals !== 'object') {
      console.error('No JSON extraction result:', JSON.stringify(scrapeData).slice(0, 500));
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to extract signals from website. The site may be blocking automated access.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Signals extracted:', JSON.stringify(signals));

    // Build MarTech string from detected platforms
    const marTechParts: string[] = [];
    if (signals.esp_platform) marTechParts.push(`ESP: ${signals.esp_platform}`);
    if (signals.sms_platform) marTechParts.push(`SMS: ${signals.sms_platform}`);
    if (signals.cdp_platform) marTechParts.push(`CDP: ${signals.cdp_platform}`);
    if (signals.personalization_platform) marTechParts.push(`Personalization: ${signals.personalization_platform}`);
    if (signals.reviews_platform) marTechParts.push(`Reviews: ${signals.reviews_platform}`);
    if (signals.marketing_platform_detected && !signals.esp_platform) {
      marTechParts.push(signals.marketing_platform_detected);
    }
    const marTechString = marTechParts.join(' | ') || signals.marketing_platform_detected || null;
    const ecommerceString = signals.ecommerce_platform || null;

    // Calculate scores
    const { icpFitScore, lifecycleTier, confidenceScore, highProbabilityBuyer } = calculateScores(signals);

    // Build enriched summary with business intel
    let enrichedSummary = signals.summary || '';
    if (companyIntel) {
      if (companyIntel.businessSummary) {
        enrichedSummary += `\n\n**How they make money:**\n${companyIntel.businessSummary}`;
      }
      if (companyIntel.recentNews) {
        enrichedSummary += `\n\n**Recent news & hires:**\n${companyIntel.recentNews}`;
      }
    }

    // Write directly to DB if accountId provided
    if (accountId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const evidence = {
          direct_ecommerce: signals.direct_ecommerce_details || '',
          email_sms_capture: signals.email_sms_capture_details || '',
          loyalty_membership: signals.loyalty_membership_details || '',
          category_complexity: signals.category_complexity_details || '',
          mobile_app: signals.mobile_app_details || '',
          marketing_platform: signals.marketing_platform_details || '',
          crm_lifecycle_team_size: signals.crm_lifecycle_team_size_details || '',
          ecommerce_platform: signals.ecommerce_platform || '',
          esp_platform: signals.esp_platform || '',
          sms_platform: signals.sms_platform || '',
          cdp_platform: signals.cdp_platform || '',
          personalization_platform: signals.personalization_platform || '',
          reviews_platform: signals.reviews_platform || '',
          other_tech_detected: signals.other_tech_detected || '',
          business_summary: companyIntel?.businessSummary || '',
          recent_news: companyIntel?.recentNews || '',
        };

        const { error: dbError } = await supabase
          .from('accounts')
          .update({
            direct_ecommerce: signals.direct_ecommerce,
            email_sms_capture: signals.email_sms_capture,
            loyalty_membership: signals.loyalty_membership,
            category_complexity: signals.category_complexity,
            mobile_app: signals.mobile_app,
            marketing_platform_detected: signals.marketing_platform_detected || null,
            crm_lifecycle_team_size: signals.crm_lifecycle_team_size,
            icp_fit_score: icpFitScore,
            timing_score: 0,
            priority_score: icpFitScore,
            lifecycle_tier: lifecycleTier,
            high_probability_buyer: highProbabilityBuyer,
            triggered_account: false,
            confidence_score: confidenceScore,
            last_enriched_at: new Date().toISOString(),
            enrichment_source_summary: enrichedSummary,
            enrichment_evidence: evidence,
            // Populate MarTech and Ecommerce columns
            mar_tech: marTechString,
            ecommerce: ecommerceString,
          })
          .eq('id', accountId);

        if (dbError) console.error('DB write error:', dbError);
        else console.log('Enrichment persisted to DB for', accountId);
      } catch (dbErr) {
        console.error('DB persistence failed:', dbErr);
      }
    }

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
      evidence: {
        direct_ecommerce: signals.direct_ecommerce_details || '',
        email_sms_capture: signals.email_sms_capture_details || '',
        loyalty_membership: signals.loyalty_membership_details || '',
        category_complexity: signals.category_complexity_details || '',
        mobile_app: signals.mobile_app_details || '',
        marketing_platform: signals.marketing_platform_details || '',
        crm_lifecycle_team_size: signals.crm_lifecycle_team_size_details || '',
        ecommerce_platform: signals.ecommerce_platform || '',
        esp_platform: signals.esp_platform || '',
        sms_platform: signals.sms_platform || '',
        cdp_platform: signals.cdp_platform || '',
        personalization_platform: signals.personalization_platform || '',
        reviews_platform: signals.reviews_platform || '',
        other_tech_detected: signals.other_tech_detected || '',
        business_summary: companyIntel?.businessSummary || '',
        recent_news: companyIntel?.recentNews || '',
      },
      scores: {
        icp_fit_score: icpFitScore,
        timing_score: 0,
        priority_score: icpFitScore,
        lifecycle_tier: lifecycleTier,
        high_probability_buyer: highProbabilityBuyer,
        triggered_account: false,
        confidence_score: confidenceScore,
      },
      marTech: marTechString,
      ecommerce: ecommerceString,
      summary: enrichedSummary,
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
