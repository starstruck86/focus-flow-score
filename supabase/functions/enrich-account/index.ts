import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';
const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

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

// The structured signal schema used across all channels
const SIGNAL_SCHEMA_PROMPT = `You are analyzing a company's website for a B2B sales rep selling lifecycle marketing / marketing automation software. Extract these signals as JSON:

{
  "direct_ecommerce": boolean (can customers buy online?),
  "direct_ecommerce_confidence": "high"|"medium"|"low",
  "direct_ecommerce_details": "specific findings",
  "email_sms_capture": boolean (newsletter signups, popup forms, SMS opt-in?),
  "email_sms_capture_confidence": "high"|"medium"|"low",
  "email_sms_capture_details": "specific findings",
  "loyalty_membership": boolean (loyalty/rewards/membership programs?),
  "loyalty_membership_confidence": "high"|"medium"|"low",
  "loyalty_membership_details": "specific findings",
  "category_complexity": boolean (5+ top-level navigation categories?),
  "category_complexity_confidence": "high"|"medium"|"low",
  "category_complexity_details": "list categories verbatim",
  "crm_lifecycle_team_size": integer (estimated email/CRM/retention team size, 0 if unknown),
  "crm_lifecycle_team_size_confidence": "high"|"medium"|"low",
  "crm_lifecycle_team_size_details": "evidence",
  "mobile_app": boolean (mobile app with app store links?),
  "mobile_app_confidence": "high"|"medium"|"low",
  "mobile_app_details": "app name, store links",
  "esp_platform": "Klaviyo|Mailchimp|HubSpot|SFMC|Braze|etc or empty",
  "sms_platform": "Attentive|Postscript|etc or empty",
  "ecommerce_platform": "Shopify|WooCommerce|BigCommerce|etc or empty",
  "marketing_platform_detected": "primary marketing platform or empty",
  "marketing_platform_confidence": "high"|"medium"|"low",
  "marketing_platform_details": "ALL marketing tools detected",
  "cdp_platform": "Segment|mParticle|etc or empty",
  "personalization_platform": "Nosto|Dynamic Yield|etc or empty",
  "reviews_platform": "Yotpo|Bazaarvoice|etc or empty",
  "other_tech_detected": "other notable tech",
  "summary": "2-3 sentence summary of lifecycle marketing maturity"
}

Be thorough — name specific platforms, programs, tools. Return ONLY valid JSON.`;

// ─── Channel 1: Firecrawl (structured JSON extraction) ───
async function tryFirecrawl(formattedUrl: string, accountName: string): Promise<{ signals: any; source: string } | null> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    console.log('Channel:Firecrawl — not configured, skipping');
    return null;
  }

  try {
    const response = await fetch(FIRECRAWL_URL, {
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
              direct_ecommerce: { type: 'boolean' },
              direct_ecommerce_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              direct_ecommerce_details: { type: 'string' },
              email_sms_capture: { type: 'boolean' },
              email_sms_capture_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              email_sms_capture_details: { type: 'string' },
              loyalty_membership: { type: 'boolean' },
              loyalty_membership_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              loyalty_membership_details: { type: 'string' },
              category_complexity: { type: 'boolean' },
              category_complexity_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              category_complexity_details: { type: 'string' },
              crm_lifecycle_team_size: { type: 'integer' },
              crm_lifecycle_team_size_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              crm_lifecycle_team_size_details: { type: 'string' },
              mobile_app: { type: 'boolean' },
              mobile_app_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              mobile_app_details: { type: 'string' },
              esp_platform: { type: 'string' },
              sms_platform: { type: 'string' },
              ecommerce_platform: { type: 'string' },
              marketing_platform_detected: { type: 'string' },
              marketing_platform_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              marketing_platform_details: { type: 'string' },
              cdp_platform: { type: 'string' },
              personalization_platform: { type: 'string' },
              reviews_platform: { type: 'string' },
              other_tech_detected: { type: 'string' },
              summary: { type: 'string' },
            },
            required: ['direct_ecommerce', 'email_sms_capture', 'loyalty_membership', 'category_complexity', 'crm_lifecycle_team_size', 'mobile_app', 'marketing_platform_detected', 'summary'],
          },
          prompt: `Analyze this website for ${accountName}. Name specific platforms, programs, tools. Be thorough about marketing tech detection.`,
        },
        onlyMainContent: false,
        waitFor: 3000,
        timeout: 30000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Channel:Firecrawl — error', response.status, errText.slice(0, 300));
      return null;
    }

    const data = await response.json();
    const signals = data?.data?.json || data?.data?.extract || data?.json || data?.extract;

    if (!signals || typeof signals !== 'object' || signals.direct_ecommerce === undefined) {
      console.error('Channel:Firecrawl — no structured signals in response');
      return null;
    }

    console.log('Channel:Firecrawl — success');
    return { signals, source: 'firecrawl' };
  } catch (err) {
    console.error('Channel:Firecrawl — exception:', err);
    return null;
  }
}

// ─── Channel 2: Firecrawl markdown + Lovable AI analysis ───
async function tryFirecrawlMarkdownWithAI(formattedUrl: string, accountName: string): Promise<{ signals: any; source: string } | null> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!FIRECRAWL_API_KEY || !LOVABLE_API_KEY) {
    console.log('Channel:Firecrawl+AI — missing keys, skipping');
    return null;
  }

  try {
    // Step 1: Get raw markdown from Firecrawl (simpler, less likely to fail)
    const scrapeResponse = await fetch(FIRECRAWL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ['markdown', 'html'],
        onlyMainContent: false,
        waitFor: 2000,
        timeout: 20000,
      }),
    });

    if (!scrapeResponse.ok) {
      console.error('Channel:Firecrawl+AI — scrape failed', scrapeResponse.status);
      return null;
    }

    const scrapeData = await scrapeResponse.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || '';
    const html = scrapeData?.data?.html || scrapeData?.html || '';
    const pageContent = (markdown || html).slice(0, 15000); // Limit to avoid token overflow

    if (!pageContent || pageContent.length < 100) {
      console.error('Channel:Firecrawl+AI — insufficient page content');
      return null;
    }

    // Step 2: Send to Lovable AI for structured extraction
    const aiResponse = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SIGNAL_SCHEMA_PROMPT },
          { role: 'user', content: `Company: "${accountName}" — Website: ${formattedUrl}\n\nPage content:\n${pageContent}` },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      console.error('Channel:Firecrawl+AI — AI call failed', aiResponse.status);
      return null;
    }

    const aiData = await aiResponse.json();
    const raw = aiData.choices?.[0]?.message?.content || '';
    const signals = parseJsonFromAI(raw);

    if (!signals) {
      console.error('Channel:Firecrawl+AI — could not parse AI response');
      return null;
    }

    console.log('Channel:Firecrawl+AI — success');
    return { signals, source: 'firecrawl+ai' };
  } catch (err) {
    console.error('Channel:Firecrawl+AI — exception:', err);
    return null;
  }
}

// ─── Channel 3: Perplexity web search (no scraping needed) ───
async function tryPerplexitySignals(accountName: string, formattedUrl: string): Promise<{ signals: any; source: string } | null> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) {
    console.log('Channel:Perplexity — not configured, skipping');
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
        model: 'sonar-pro',
        messages: [
          { role: 'system', content: SIGNAL_SCHEMA_PROMPT },
          {
            role: 'user',
            content: `Research the company "${accountName}" (website: ${formattedUrl}). Visit/analyze their website and extract the structured signals. Look at their tech stack, marketing tools, ecommerce setup, loyalty programs, mobile apps, email/SMS capture methods. Return ONLY valid JSON matching the schema.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Channel:Perplexity — error', response.status, errBody.slice(0, 200));
      return null;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const signals = parseJsonFromAI(raw);

    if (!signals) {
      console.error('Channel:Perplexity — could not parse response');
      return null;
    }

    console.log('Channel:Perplexity — success');
    return { signals, source: 'perplexity' };
  } catch (err) {
    console.error('Channel:Perplexity — exception:', err);
    return null;
  }
}

// ─── Channel 4: Lovable AI only (uses model knowledge, no live scraping) ───
async function tryLovableAIOnly(accountName: string, formattedUrl: string): Promise<{ signals: any; source: string } | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.log('Channel:LovableAI — not configured, skipping');
    return null;
  }

  try {
    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SIGNAL_SCHEMA_PROMPT },
          {
            role: 'user',
            content: `Based on your knowledge of the company "${accountName}" (website: ${formattedUrl}), extract the structured marketing signals. Use your training data knowledge about this company's tech stack, business model, and marketing practices. If you are unsure about a signal, set confidence to "low". Return ONLY valid JSON.`,
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error('Channel:LovableAI — error', response.status);
      return null;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const signals = parseJsonFromAI(raw);

    if (!signals) {
      console.error('Channel:LovableAI — could not parse response');
      return null;
    }

    // Mark all confidences as low since this is from model knowledge only
    for (const key of Object.keys(signals)) {
      if (key.endsWith('_confidence') && signals[key] === 'high') {
        signals[key] = 'medium'; // Downgrade since no live data
      }
    }

    console.log('Channel:LovableAI — success (model knowledge only)');
    return { signals, source: 'ai-knowledge' };
  } catch (err) {
    console.error('Channel:LovableAI — exception:', err);
    return null;
  }
}

// Parse JSON from potentially messy AI output
function parseJsonFromAI(raw: string): any | null {
  if (!raw) return null;
  try {
    // Try direct parse
    return JSON.parse(raw);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch { /* fall through */ }
    }
    // Try finding first { ... } block
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// Fetch company news and business summary via Perplexity
async function fetchCompanyIntelligence(companyName: string, websiteUrl: string): Promise<{
  businessSummary: string;
  recentNews: string;
} | null> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) return null;

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
            content: 'You are a B2B sales research assistant. Provide concise, factual intelligence. Use bullet points. Focus on actionable information.',
          },
          {
            role: 'user',
            content: `Research the company whose official website is ${websiteUrl} (company name: "${companyName}"). Make sure you are researching THIS SPECIFIC company at this URL, not a different company with a similar name.

Provide:
1. BUSINESS MODEL (2-3 sentences): How does this company make money?
2. RECENT NEWS & HIRES (past 12 months): Notable news, executive hires, funding, acquisitions, product launches. Include dates. If nothing found, say "No significant recent news found."

Keep it concise and factual.`,
          },
        ],
        search_recency_filter: 'year',
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('CompanyIntel error:', response.status, errBody.slice(0, 200));
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const businessMatch = content.match(/BUSINESS MODEL[:\s]*\n?([\s\S]*?)(?=\n\s*(?:2\.|RECENT NEWS|$))/i);
    const newsMatch = content.match(/RECENT NEWS[^:]*[:\s]*\n?([\s\S]*?)$/i);

    return {
      businessSummary: (businessMatch?.[1] || content.split('\n').slice(0, 3).join('\n')).trim(),
      recentNews: (newsMatch?.[1] || '').trim(),
    };
  } catch (err) {
    console.error('CompanyIntel exception:', err);
    return null;
  }
}

// Search for martech case studies related to this company via Perplexity
async function fetchMartechCaseStudies(companyName: string, websiteUrl: string, espPlatform?: string): Promise<string | null> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) return null;

  const platformHint = espPlatform ? ` They may use ${espPlatform}.` : '';
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'You are a martech research specialist. Find real, published case studies and success stories. Only include results you can verify with sources. Be concise — bullet points with links when available.',
          },
          {
            role: 'user',
            content: `Find marketing technology case studies, success stories, or published results involving "${companyName}" (${websiteUrl}).${platformHint}

Search for:
- Case studies published by ESPs (Klaviyo, Mailchimp, HubSpot, Braze, SFMC, Iterable, etc.) featuring this company
- Case studies from SMS platforms (Attentive, Postscript, etc.) featuring this company  
- Case studies from loyalty/rewards platforms (Yotpo, Smile.io, LoyaltyLion, etc.)
- Case studies from ecommerce platforms (Shopify Plus, BigCommerce, etc.)
- Case studies from CDPs, personalization tools, or review platforms
- Blog posts, webinars, or conference talks by this company about their marketing stack
- Any published ROI metrics, email/SMS revenue numbers, or retention statistics

For each case study found, include:
- The platform/vendor that published it
- Key results or metrics mentioned
- URL if available

If no case studies are found, say "No published case studies found" and suggest which platforms would likely have them based on the company's profile.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('CaseStudy search error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return content.trim() || null;
  } catch (err) {
    console.error('CaseStudy search exception:', err);
    return null;
  }
}

// Auto-discover website URL using Perplexity
async function discoverWebsite(companyName: string, industry?: string): Promise<string | null> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY || !companyName) return null;

  const industryHint = industry ? ` in the ${industry} industry` : '';
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
            content: 'You find company websites. Respond with ONLY the URL. No explanation, no markdown, just the bare URL starting with https://. If you cannot confidently identify the company, respond with exactly "NOTFOUND".',
          },
          {
            role: 'user',
            content: `What is the official website URL for the company "${companyName}"${industryHint}? This is a brand/retailer that sells products or services to consumers. Return their main corporate or ecommerce website.`,
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    if (raw === 'NOTFOUND' || !raw.includes('.')) return null;
    const urlMatch = raw.match(/https?:\/\/[^\s\])"'>]+/);
    return urlMatch ? urlMatch[0].replace(/[.,;:!?)]+$/, '') : null;
  } catch (err) {
    console.error('Website discovery failed:', err);
    return null;
  }
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, accountName, accountId, industry } = await req.json();

    // Auto-discover website if not provided
    let formattedUrl = (url || '').trim();
    let discoveredUrl: string | null = null;
    if (!formattedUrl && accountName) {
      console.log('No URL, attempting auto-discovery for:', accountName);
      discoveredUrl = await discoverWebsite(accountName, industry);
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

    try { new URL(formattedUrl); } catch {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid URL: "${formattedUrl}". Please check the website address.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Enriching:', formattedUrl, 'for:', accountName);

    // ─── Multi-channel waterfall + parallel intelligence ───
    // Company intelligence and case study search run in parallel with signal extraction
    const companyIntelPromise = fetchCompanyIntelligence(accountName || '', formattedUrl);
    // Case study search starts immediately (doesn't need signal results)
    const caseStudyPromise = fetchMartechCaseStudies(accountName || '', formattedUrl);

    // Try channels in priority order — stop at first success
    let signalResult: { signals: any; source: string } | null = null;

    // Channel 1: Firecrawl structured JSON (highest quality)
    signalResult = await tryFirecrawl(formattedUrl, accountName || '');

    // Channel 2: Firecrawl markdown → Lovable AI analysis
    if (!signalResult) {
      console.log('Falling back to Channel 2: Firecrawl markdown + AI');
      signalResult = await tryFirecrawlMarkdownWithAI(formattedUrl, accountName || '');
    }

    // Channel 3: Perplexity web search (no scraping — searches the web)
    if (!signalResult) {
      console.log('Falling back to Channel 3: Perplexity signals');
      signalResult = await tryPerplexitySignals(accountName || '', formattedUrl);
    }

    // Channel 4: Lovable AI model knowledge (last resort)
    if (!signalResult) {
      console.log('Falling back to Channel 4: AI model knowledge');
      signalResult = await tryLovableAIOnly(accountName || '', formattedUrl);
    }

    const companyIntel = await companyIntelPromise;

    // If ALL channels failed, return error with company intel if available
    if (!signalResult) {
      const fallbackSummary = companyIntel
        ? `**How they make money:**\n${companyIntel.businessSummary}\n\n**Recent news:**\n${companyIntel.recentNews}`
        : null;

      if (fallbackSummary) {
        // Return partial result with just company intel
        return new Response(JSON.stringify({
          success: true,
          partial: true,
          source: 'company-intel-only',
          discoveredUrl: discoveredUrl || null,
          signals: { direct_ecommerce: false, email_sms_capture: false, loyalty_membership: false, category_complexity: false, mobile_app: false, marketing_platform_detected: null, crm_lifecycle_team_size: 0 },
          confidence: {},
          evidence: { business_summary: companyIntel!.businessSummary, recent_news: companyIntel!.recentNews },
          scores: { icp_fit_score: 0, timing_score: 0, priority_score: 0, lifecycle_tier: '4', high_probability_buyer: false, triggered_account: false, confidence_score: 0 },
          marTech: null, ecommerce: null,
          summary: fallbackSummary,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(
        JSON.stringify({ success: false, error: 'All enrichment channels failed. The site may be inaccessible. Try adding a direct homepage URL.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { signals, source } = signalResult;
    console.log('Signals extracted via:', source);

    // Build MarTech string
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

    // Build enriched summary
    let enrichedSummary = signals.summary || '';
    enrichedSummary += `\n\n_Source: ${source}_`;
    if (companyIntel) {
      if (companyIntel.businessSummary) enrichedSummary += `\n\n**How they make money:**\n${companyIntel.businessSummary}`;
      if (companyIntel.recentNews) enrichedSummary += `\n\n**Recent news & hires:**\n${companyIntel.recentNews}`;
    }

    // Write to DB
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
          enrichment_source: source,
        };

        const updatePayload: Record<string, any> = {
          direct_ecommerce: signals.direct_ecommerce,
          email_sms_capture: signals.email_sms_capture,
          loyalty_membership: signals.loyalty_membership,
          category_complexity: signals.category_complexity,
          mobile_app: signals.mobile_app,
          marketing_platform_detected: signals.marketing_platform_detected || null,
          crm_lifecycle_team_size: signals.crm_lifecycle_team_size || 0,
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
          mar_tech: marTechString,
          ecommerce: ecommerceString,
        };

        if (discoveredUrl) updatePayload.website = discoveredUrl;

        const { error: dbError } = await supabase.from('accounts').update(updatePayload).eq('id', accountId);
        if (dbError) console.error('DB write error:', dbError);
        else console.log('Enrichment persisted for', accountId, 'via', source);
      } catch (dbErr) {
        console.error('DB persistence failed:', dbErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      source,
      discoveredUrl: discoveredUrl || null,
      signals: {
        direct_ecommerce: signals.direct_ecommerce,
        email_sms_capture: signals.email_sms_capture,
        loyalty_membership: signals.loyalty_membership,
        category_complexity: signals.category_complexity,
        mobile_app: signals.mobile_app,
        marketing_platform_detected: signals.marketing_platform_detected || null,
        crm_lifecycle_team_size: signals.crm_lifecycle_team_size || 0,
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
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Enrichment error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: `Enrichment failed: ${errorMessage}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
