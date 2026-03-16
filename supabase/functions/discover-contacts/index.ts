import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';

type DiscoveryMode = 'auto' | 'marketing' | 'revenue' | 'operations' | 'it' | 'executive';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanText(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeWebsite(website?: string | null) {
  const trimmed = cleanText(website);
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function dedupeContacts(contacts: any[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const name = cleanText(contact?.name).toLowerCase();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function getDiscoveryBrief({
  mode,
  motion,
  industry,
  opportunityContext,
  focusPrompt,
  websiteSummary,
}: {
  mode: DiscoveryMode;
  motion?: string | null;
  industry?: string | null;
  opportunityContext?: string | null;
  focusPrompt?: string | null;
  websiteSummary?: string | null;
}) {
  const contextBlob = [motion, industry, opportunityContext, focusPrompt, websiteSummary]
    .map((value) => cleanText(value))
    .join(' ')
    .toLowerCase();

  const looksLikeHomeServices = /(pest|termite|inspection|service center|residential|commercial services|home service|field service|branch|local service|referral)/.test(contextBlob);
  const looksLikeRenewal = /(renewal|expansion|existing customer|customer base|retention)/.test(contextBlob);

  if (mode === 'marketing') {
    return {
      resolvedMode: 'marketing',
      brief: 'Prioritize marketing, CRM, lifecycle, retention, digital, demand generation, ecommerce, and customer engagement stakeholders plus their executive approver.',
    };
  }

  if (mode === 'revenue') {
    return {
      resolvedMode: 'revenue',
      brief: 'Prioritize revenue leaders, growth leaders, revenue operations, sales/marketing alignment owners, pipeline owners, and executive sponsors involved in commercial systems decisions.',
    };
  }

  if (mode === 'operations') {
    return {
      resolvedMode: 'operations',
      brief: 'Prioritize operations, customer experience, contact center, service delivery, branch/service center management, and process owners who influence systems, routing, or customer communication workflows.',
    };
  }

  if (mode === 'it') {
    return {
      resolvedMode: 'it',
      brief: 'Prioritize IT, systems, data, integrations, marketing operations, and platform owners who evaluate security, implementation, and technical fit.',
    };
  }

  if (mode === 'executive') {
    return {
      resolvedMode: 'executive',
      brief: 'Prioritize executive stakeholders and final approvers such as CMO, COO, CRO, CTO/CIO, President, GM, or SVP/VP leaders who would sponsor or approve the initiative.',
    };
  }

  if (looksLikeHomeServices) {
    return {
      resolvedMode: 'operations',
      brief: 'This appears to be a home-services / field-services company, so prioritize digital marketing, customer acquisition, customer experience, contact center, operations, IT, and executive sponsors rather than ecommerce-only roles.',
    };
  }

  if (looksLikeRenewal) {
    return {
      resolvedMode: 'revenue',
      brief: 'This looks tied to an existing customer or renewal motion, so prioritize customer marketing, lifecycle/CRM, digital, customer experience, revenue/ops, IT, and executive sponsors.',
    };
  }

  return {
    resolvedMode: 'auto',
    brief: 'Prioritize the most likely buying committee for lifecycle marketing / CRM / customer communication software: marketing, digital, lifecycle/CRM, customer experience, operations, IT, and executive sponsors.',
  };
}

async function fetchWebsiteContext(website?: string | null) {
  const normalizedWebsite = normalizeWebsite(website);
  if (!normalizedWebsite) return '';

  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

  if (firecrawlKey) {
    try {
      const response = await fetch(FIRECRAWL_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: normalizedWebsite,
          formats: ['markdown', 'html'],
          onlyMainContent: false,
          waitFor: 2000,
          timeout: 20000,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const markdown = cleanText(data?.data?.markdown || data?.markdown || '');
        const html = cleanText(stripHtml(data?.data?.html || data?.html || ''));
        const combined = cleanText(`${markdown} ${html}`);
        if (combined) {
          return truncate(combined, 12000);
        }
      } else {
        console.error('discover-contacts website research failed via Firecrawl:', response.status, await response.text());
      }
    } catch (error) {
      console.error('discover-contacts Firecrawl exception:', error);
    }
  }

  try {
    const response = await fetch(normalizedWebsite, {
      headers: { 'User-Agent': 'Mozilla/5.0 Lovable Stakeholder Discovery' },
    });

    if (!response.ok) {
      console.error('discover-contacts website fetch failed:', response.status);
      return '';
    }

    const html = await response.text();
    return truncate(stripHtml(html), 8000);
  } catch (error) {
    console.error('discover-contacts direct website fetch exception:', error);
    return '';
  }
}

async function runPerplexityResearch({
  accountName,
  website,
  industry,
  motion,
  opportunityContext,
  focusPrompt,
  roleBrief,
  websiteSummary,
  maxContacts,
}: {
  accountName: string;
  website?: string | null;
  industry?: string | null;
  motion?: string | null;
  opportunityContext?: string | null;
  focusPrompt?: string | null;
  roleBrief: string;
  websiteSummary?: string | null;
  maxContacts: number;
}) {
  const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
  if (!perplexityKey) return '';

  try {
    const searchResp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${perplexityKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'user',
            content: `Find current employees and likely buying-committee stakeholders at "${accountName}".

Company context:
- Website: ${website || 'unknown'}
- Industry: ${industry || 'unknown'}
- Motion: ${motion || 'unknown'}
- Opportunity context: ${opportunityContext || 'none provided'}
- Custom focus: ${focusPrompt || 'none provided'}
- Website summary: ${websiteSummary || 'not available'}

Discovery guidance:
${roleBrief}

Search LinkedIn, company leadership/about/team pages, press releases, conference speaker pages, interviews, podcasts, and local business coverage.

Return up to ${maxContacts} CURRENT people at the company who are most relevant. For each person include:
- Full name
- Current title
- Why they matter to this evaluation
- LinkedIn URL if you can find one
- 1 short evidence note proving they are at the company now

Prioritize real named people. If the obvious marketing leader is not public, include adjacent leaders in digital, operations, CX, IT, or executive leadership who would influence the decision.`,
          },
        ],
      }),
    });

    if (!searchResp.ok) {
      console.error('discover-contacts Perplexity error:', searchResp.status, await searchResp.text());
      return '';
    }

    const searchData = await searchResp.json();
    return cleanText(searchData.choices?.[0]?.message?.content || '');
  } catch (error) {
    console.error('discover-contacts Perplexity exception:', error);
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authorization' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      console.error('discover-contacts auth error:', claimsError?.message || 'No claims');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const userId = claimsData.claims.sub;
    const body = await req.json();
    const {
      accountId,
      accountName,
      website,
      industry,
      opportunityContext,
      focusPrompt,
      maxContacts,
      discoveryMode,
      division,
    } = body || {};

    if (!accountId) {
      return jsonResponse({ error: 'accountId required' }, 400);
    }

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, name, website, industry, motion, notes')
      .eq('id', accountId)
      .maybeSingle();

    if (accountError) {
      console.error('discover-contacts account lookup failed:', accountError.message);
      return jsonResponse({ error: 'Failed to load account context' }, 500);
    }

    if (!account) {
      return jsonResponse({ error: 'Account not found' }, 404);
    }

    const resolvedAccountName = cleanText(account.name || accountName);
    if (!resolvedAccountName) {
      return jsonResponse({ error: 'accountName required' }, 400);
    }

    const resolvedWebsite = normalizeWebsite(account.website || website);
    const resolvedIndustry = cleanText(account.industry || industry);
    const resolvedMotion = cleanText(account.motion);
    const resolvedFocusPrompt = cleanText(focusPrompt);
    const resolvedDivision = cleanText(division);
    const requestedMaxContacts = Math.max(3, Math.min(Number(maxContacts) || 5, 10));
    const requestedMode = (['auto', 'marketing', 'revenue', 'operations', 'it', 'executive'].includes(discoveryMode)
      ? discoveryMode
      : 'auto') as DiscoveryMode;

    const divisionScope = resolvedDivision
      ? `IMPORTANT: Scope ALL research to the "${resolvedDivision}" division/business unit of ${resolvedAccountName}. Only return people who work in or directly support this division. Exclude contacts from other divisions or the parent company's unrelated teams.`
      : '';

    const { data: existingContacts, error: contactsError } = await supabase
      .from('contacts')
      .select('name, title, linkedin_url')
      .eq('account_id', accountId);

    if (contactsError) {
      console.error('discover-contacts existing contacts lookup failed:', contactsError.message);
      return jsonResponse({ error: 'Failed to load existing contacts' }, 500);
    }

    const existingNames = new Set((existingContacts || []).map((contact) => cleanText(contact.name).toLowerCase()).filter(Boolean));
    const websiteSummary = await fetchWebsiteContext(resolvedWebsite);
    const { resolvedMode, brief } = getDiscoveryBrief({
      mode: requestedMode,
      motion: resolvedMotion,
      industry: resolvedIndustry,
      opportunityContext,
      focusPrompt: resolvedFocusPrompt,
      websiteSummary,
    });

    const webResearch = await runPerplexityResearch({
      accountName: resolvedAccountName,
      website: resolvedWebsite,
      industry: resolvedIndustry,
      motion: resolvedMotion,
      opportunityContext,
      focusPrompt: resolvedFocusPrompt,
      roleBrief: brief,
      websiteSummary,
      maxContacts: requestedMaxContacts,
    });

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      return jsonResponse({ error: 'AI not configured' }, 500);
    }

    console.log('discover-contacts request context:', {
      userId,
      accountId,
      accountName: resolvedAccountName,
      requestedMode,
      resolvedMode,
      requestedMaxContacts,
      hasWebsiteSummary: Boolean(websiteSummary),
      hasWebResearch: Boolean(webResearch),
      hasFocusPrompt: Boolean(resolvedFocusPrompt),
    });

    const aiResp = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are a B2B stakeholder discovery assistant. Convert research into a strict contact list for a sales rep. Prefer real, current employees. Do not invent LinkedIn URLs. If research is sparse, infer buyer_role and influence_level conservatively from the title. Keep notes short and evidence-based.',
          },
          {
            role: 'user',
            content: `Build a stakeholder map for "${resolvedAccountName}".

Account context:
- Website: ${resolvedWebsite || 'unknown'}
- Industry: ${resolvedIndustry || 'unknown'}
- Motion: ${resolvedMotion || 'unknown'}
- Opportunity context: ${opportunityContext || 'none provided'}
- Discovery mode: ${resolvedMode}
- Custom focus: ${resolvedFocusPrompt || 'none provided'}
- Target count: ${requestedMaxContacts}
- Account notes: ${cleanText(account.notes) || 'none'}

Role guidance:
${brief}

Website summary:
${websiteSummary || 'No website summary available'}

Web research:
${webResearch || 'No external web research available'}

Existing contacts to skip:
${Array.from(existingNames).join(', ') || 'none'}

Rules:
- Return at most ${requestedMaxContacts} contacts.
- Prioritize exact current employees at this company.
- Map buyer_role from: champion, economic_buyer, technical_buyer, user_buyer, coach, influencer, blocker, unknown.
- Map influence_level from: high, medium, low.
- Use notes for a short evidence-backed reason they belong in the map.
- If the title suggests budget ownership or executive sponsorship, prefer economic_buyer.
- If the title suggests implementation or systems responsibility, prefer technical_buyer.
- If the title suggests process knowledge, internal advocacy, or day-to-day ownership, prefer champion, coach, influencer, or user_buyer.
- Exclude duplicate names and anyone already in the existing contacts list.`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'structure_contacts',
              description: 'Return discovered contacts for the stakeholder map',
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
          },
        ],
        tool_choice: { type: 'function', function: { name: 'structure_contacts' } },
        temperature: 0.2,
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      const bodyText = await aiResp.text();
      console.error('discover-contacts AI error:', status, bodyText);
      if (status === 429) return jsonResponse({ error: 'Rate limit exceeded' }, 429);
      if (status === 402) return jsonResponse({ error: 'AI credits exhausted' }, 402);
      return jsonResponse({ error: `AI error: ${status}` }, 500);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error('discover-contacts AI response missing tool call:', JSON.stringify(aiData).slice(0, 1000));
      return jsonResponse({ error: 'No structured response from AI' }, 500);
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const discovered = dedupeContacts(parsed?.contacts || []).filter((contact: any) => !existingNames.has(cleanText(contact.name).toLowerCase()));

    console.log('discover-contacts completed:', {
      accountId,
      totalStructured: parsed?.contacts?.length || 0,
      newContacts: discovered.length,
      source: webResearch ? (websiteSummary ? 'website+perplexity+ai' : 'perplexity+ai') : (websiteSummary ? 'website+ai' : 'ai'),
    });

    return jsonResponse({
      success: true,
      contacts: discovered,
      total_found: parsed?.contacts?.length || 0,
      new_contacts: discovered.length,
      source: webResearch ? (websiteSummary ? 'website+perplexity+ai' : 'perplexity+ai') : (websiteSummary ? 'website+ai' : 'ai'),
      discovery_mode: resolvedMode,
      focus_prompt: resolvedFocusPrompt || null,
      website_research_used: Boolean(websiteSummary),
    });
  } catch (error) {
    console.error('discover-contacts error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});