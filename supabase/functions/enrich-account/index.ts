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

// CRM team sweet-spot bell curve
function crmTeamScore(size: number): number {
  if (size >= 3 && size <= 5) return 25;
  if (size >= 1 && size <= 2) return 15;
  if (size >= 6 && size <= 10) return 10;
  return 0;
}

function calculateScores(signals: any) {
  const conf = (key: string) => CONFIDENCE_MULTIPLIERS[signals[`${key}_confidence`]] || 0.5;

  let icpFitScore = 0;

  // Boolean signals
  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    const signalKey = key === 'marketing_platform' ? 'marketing_platform_detected' : key;
    const val = key === 'marketing_platform'
      ? (signals.marketing_platform_detected || '').length > 0
      : !!signals[signalKey];
    if (val) icpFitScore += weight * conf(key === 'marketing_platform' ? 'marketing_platform' : key);
  }

  // CRM team
  const teamSize = signals.crm_lifecycle_team_size || 0;
  icpFitScore += crmTeamScore(teamSize) * conf('crm_lifecycle_team_size');

  icpFitScore = Math.round(Math.min(100, icpFitScore));

  // Aggregate confidence
  const confKeys = ['direct_ecommerce', 'email_sms_capture', 'loyalty_membership', 'category_complexity', 'mobile_app', 'marketing_platform', 'crm_lifecycle_team_size'];
  const avgConf = Math.round(
    (confKeys.map(k => CONFIDENCE_MULTIPLIERS[signals[`${k}_confidence`]] || 0.5).reduce((a, b) => a + b, 0) / confKeys.length) * 100
  );

  // Tier
  let lifecycleTier = '4';
  if (icpFitScore >= 75) lifecycleTier = '1';
  else if (icpFitScore >= 50) lifecycleTier = '2';
  else if (icpFitScore >= 25) lifecycleTier = '3';

  // High probability = fit >= 60 and has key combo signals
  const highProbabilityBuyer = icpFitScore >= 60 && signals.direct_ecommerce && (signals.email_sms_capture || signals.loyalty_membership);

  return { icpFitScore, lifecycleTier, confidenceScore: avgConf, highProbabilityBuyer };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, accountName, accountId } = await req.json();

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

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Enriching:', formattedUrl, 'for account:', accountName);

    // Use Firecrawl JSON extraction — single API call, no separate AI needed
    const scrapeResponse = await fetch(FIRECRAWL_URL, {
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
              direct_ecommerce_evidence: { type: 'string', description: 'Specific evidence: quote exact UI elements, URLs, buttons, or page sections that prove this. E.g. "Add to Cart button on /shop, checkout flow at /cart, Shopify checkout detected"' },
              email_sms_capture: { type: 'boolean', description: 'Does the site actively capture email/SMS subscribers? Look for newsletter signups, popup forms, SMS opt-in.' },
              email_sms_capture_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              email_sms_capture_evidence: { type: 'string', description: 'Specific evidence: quote the signup forms, popups, footer signups, or SMS opt-in language found. E.g. "Footer email signup form with 10% off offer, exit-intent popup for SMS club"' },
              loyalty_membership: { type: 'boolean', description: 'Does the company run loyalty, rewards, membership, donor, patron, VIP, insider, or perks programs?' },
              loyalty_membership_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              loyalty_membership_evidence: { type: 'string', description: 'Specific evidence: name the program, quote links or pages found. E.g. "Rewards program link in nav bar, /rewards page with points system"' },
              category_complexity: { type: 'boolean', description: 'Does the navigation show 5+ top-level categories?' },
              category_complexity_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              category_complexity_evidence: { type: 'string', description: 'Specific evidence: list the top-level navigation categories found. E.g. "Nav has: Women, Men, Kids, Home, Sale, New Arrivals, Accessories (7 categories)"' },
              crm_lifecycle_team_size: { type: 'integer', description: 'Estimated CRM/lifecycle/retention/email marketing team size. 0 if no evidence.' },
              crm_lifecycle_team_size_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              crm_lifecycle_team_size_evidence: { type: 'string', description: 'Specific evidence: what indicators suggest this team size? E.g. "LinkedIn shows 3 email marketing roles, careers page lists Lifecycle Marketing Manager opening"' },
              mobile_app: { type: 'boolean', description: 'Has mobile app? Look for app store links.' },
              mobile_app_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              mobile_app_evidence: { type: 'string', description: 'Specific evidence: quote app store links, download CTAs, or app banners found. E.g. "iOS App Store link in footer, smart app banner on mobile"' },
              marketing_platform_detected: { type: 'string', description: 'Marketing/email platform detected from scripts/pixels (e.g., Klaviyo, HubSpot, Mailchimp, SFMC, Braze). Empty string if none.' },
              marketing_platform_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              marketing_platform_evidence: { type: 'string', description: 'Specific evidence: what script, pixel, or code snippet was detected? E.g. "Klaviyo signup form embed detected, klaviyo.com/onsite/js loaded in page source"' },
              summary: { type: 'string', description: '2-3 sentence summary of lifecycle marketing maturity findings.' },
            },
            required: ['direct_ecommerce', 'email_sms_capture', 'loyalty_membership', 'category_complexity', 'crm_lifecycle_team_size', 'mobile_app', 'marketing_platform_detected', 'summary'],
          },
          prompt: `Analyze this website for a B2B sales rep selling marketing automation / lifecycle marketing software to ${accountName || 'this company'}. Evaluate each signal carefully and provide SPECIFIC EVIDENCE for every detection — cite exact page elements, URLs, button text, script names, or navigation items you observe. For CRM team size, estimate based on job listings links, team pages, or company size indicators.`,
        },
        onlyMainContent: false,
        waitFor: 2000,
      }),
    });

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
        JSON.stringify({ success: false, error: 'Failed to extract signals from website' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Signals extracted:', JSON.stringify(signals));

    // Calculate scores
    const { icpFitScore, lifecycleTier, confidenceScore, highProbabilityBuyer } = calculateScores(signals);

    // Write directly to DB if accountId provided
    if (accountId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const evidence = {
            direct_ecommerce: signals.direct_ecommerce_evidence || '',
            email_sms_capture: signals.email_sms_capture_evidence || '',
            loyalty_membership: signals.loyalty_membership_evidence || '',
            category_complexity: signals.category_complexity_evidence || '',
            mobile_app: signals.mobile_app_evidence || '',
            marketing_platform: signals.marketing_platform_evidence || '',
            crm_lifecycle_team_size: signals.crm_lifecycle_team_size_evidence || '',
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
            enrichment_source_summary: signals.summary,
            enrichment_evidence: evidence,
          })
          .eq('id', accountId);

        if (dbError) console.error('DB write error:', dbError);
        else console.log('Enrichment persisted to DB for', accountId);
      } catch (dbErr) {
        console.error('DB persistence failed:', dbErr);
        // Don't fail the whole request — still return enrichment data
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
        direct_ecommerce: signals.direct_ecommerce_evidence || '',
        email_sms_capture: signals.email_sms_capture_evidence || '',
        loyalty_membership: signals.loyalty_membership_evidence || '',
        category_complexity: signals.category_complexity_evidence || '',
        mobile_app: signals.mobile_app_evidence || '',
        marketing_platform: signals.marketing_platform_evidence || '',
        crm_lifecycle_team_size: signals.crm_lifecycle_team_size_evidence || '',
      scores: {
        icp_fit_score: icpFitScore,
        timing_score: 0,
        priority_score: icpFitScore,
        lifecycle_tier: lifecycleTier,
        high_probability_buyer: highProbabilityBuyer,
        triggered_account: false,
        confidence_score: confidenceScore,
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
