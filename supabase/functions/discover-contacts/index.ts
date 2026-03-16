import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';

type DiscoveryMode = 'auto' | 'marketing' | 'digital_engagement' | 'marketing_ops' | 'revenue' | 'cx_loyalty' | 'operations' | 'it' | 'executive';

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

// Strict LinkedIn URL validation — reject generic, placeholder, or malformed URLs
function isValidLinkedInUrl(url?: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  // Must match linkedin.com/in/{slug} pattern
  const match = trimmed.match(/^https?:\/\/(www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)\/?$/);
  if (!match) return false;
  const slug = match[2];
  // Reject generic/placeholder slugs
  const blocked = ['example', 'placeholder', 'unknown', 'profile', 'user', 'test', 'firstname-lastname', 'john-doe', 'jane-doe'];
  if (blocked.includes(slug.toLowerCase())) return false;
  // Reject too-short slugs (likely fake)
  if (slug.length < 3) return false;
  return true;
}

// Verify a LinkedIn URL is a real page using Firecrawl (returns true/false)
async function verifyLinkedInUrl(url: string): Promise<boolean> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) return true; // Can't verify without Firecrawl, assume valid
  
  try {
    const resp = await fetch(FIRECRAWL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 3000,
        timeout: 10000,
      }),
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      console.log(`LinkedIn verify failed for ${url}: ${resp.status}`);
      // 402 = no credits, don't penalize the contact
      if (resp.status === 402) return true;
      return false;
    }
    
    const data = await resp.json();
    const markdown = cleanText(data?.data?.markdown || data?.markdown || '');
    // If we got content and it doesn't look like a 404/error page, consider it valid
    if (markdown.length > 100 && !markdown.toLowerCase().includes('page not found') && !markdown.toLowerCase().includes('this page doesn')) {
      return true;
    }
    console.log(`LinkedIn verify: ${url} looks like a dead page (content length: ${markdown.length})`);
    return false;
  } catch (err) {
    console.error('LinkedIn verify exception:', err);
    return true; // On error, don't penalize
  }
}

function detectCompanySize(contextBlob: string): 'small' | 'mid' | 'enterprise' {
  // Enterprise signals
  if (/(fortune\s*\d|f500|nasdaq|nyse|publicly traded|global brand|10,?000\+?\s*employees|multinational|billion|enterprise|large.*(retailer|brand|company)|major\s+(retailer|brand|chain))/.test(contextBlob)) {
    return 'enterprise';
  }
  // Small/local signals
  if (/(local|small business|family.owned|single.location|boutique|independently owned|tavern|café|cafe|diner|inn|bed.and.breakfast|bakery|salon|barbershop|florist|pizzeria|brewery|taproom|pub|restaurant|shop|store|studio|clinic|practice|agency|consultancy|freelance|solopreneur|\d{1,2}\s*employees|small team|fewer than \d{2} (people|employees|staff))/.test(contextBlob)) {
    return 'small';
  }
  // Mid-market signals
  if (/(mid.market|mid.size|regional|100[\-–]\d{3,4}\s*employees|growing|series [a-d]|startup|scale.?up)/.test(contextBlob)) {
    return 'mid';
  }
  return 'mid'; // Default to mid if unclear
}

function getCompanySizeGuidance(size: 'small' | 'mid' | 'enterprise'): string {
  if (size === 'small') {
    return `COMPANY SIZE CONTEXT: This appears to be a SMALL or LOCAL business. Adjust your expectations:
- Titles will be simpler: Owner, General Manager, Marketing Manager, Director of Operations — NOT VP/SVP/CMO.
- One person may wear many hats (e.g., "Owner" handles marketing, operations, and purchasing decisions).
- The owner or general manager is almost always the economic buyer AND decision-maker.
- Look for: Owner, Co-owner, Founder, General Manager, Marketing Manager/Coordinator, Operations Manager, Office Manager, Director.
- Do NOT expect enterprise-style buying committees. 1-3 contacts is a perfectly good result.
- Search their website About/Team page, Google Business listing, local press, Yelp, and industry associations.`;
  }
  if (size === 'enterprise') {
    return `COMPANY SIZE CONTEXT: This is a LARGE ENTERPRISE. Expect a full buying committee:
- Look for VP/SVP/C-suite stakeholders who own budget and strategy.
- Map out the full committee: economic buyer, champions, technical evaluators, and influencers.
- Large companies have specialized roles — find the specific function owners.`;
  }
  return `COMPANY SIZE CONTEXT: This appears to be a MID-MARKET company. Expect a moderate buying committee:
- Titles range from Director to VP level, occasionally C-suite at smaller mid-market.
- Some role consolidation (e.g., one Director may own both marketing and digital).
- Typically 3-5 stakeholders in a buying decision.`;
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

  const companySize = detectCompanySize(contextBlob);
  const sizeGuidance = getCompanySizeGuidance(companySize);

  const looksLikeHomeServices = /(pest|termite|inspection|service center|residential|commercial services|home service|field service|branch|local service|referral)/.test(contextBlob);
  const looksLikeRenewal = /(renewal|expansion|existing customer|customer base|retention)/.test(contextBlob);

  const smallBizAddendum = companySize === 'small'
    ? ' For this smaller company, focus on whoever manages marketing/customer communications — this might be the Owner, GM, or a Marketing Manager rather than a VP or Director.'
    : '';

  if (mode === 'marketing') {
    return {
      resolvedMode: 'marketing',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize marketing, CRM, lifecycle, retention, digital, demand generation, ecommerce, and customer engagement stakeholders plus their executive approver.${smallBizAddendum}`,
    };
  }

  if (mode === 'digital_engagement') {
    return {
      resolvedMode: 'digital_engagement',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize digital engagement leaders: digital marketing, email/SMS channel owners, push notification/app engagement, personalization, customer journey orchestration, digital experience, website optimization, and digital product managers. These are the people who own the customer-facing messaging channels and touchpoints, NOT the people who manage the martech stack or CRM infrastructure.${smallBizAddendum}`,
    };
  }

  if (mode === 'marketing_ops') {
    return {
      resolvedMode: 'marketing_ops',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize marketing operations and martech leaders: marketing technology, CRM administration, data & analytics, campaign operations, marketing automation platform owners, integration/data pipeline owners, and revenue operations.${smallBizAddendum}`,
    };
  }

  if (mode === 'revenue') {
    return {
      resolvedMode: 'revenue',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize revenue leaders, growth leaders, revenue operations, sales/marketing alignment owners, pipeline owners, and executive sponsors involved in commercial systems decisions.${smallBizAddendum}`,
    };
  }

  if (mode === 'cx_loyalty') {
    return {
      resolvedMode: 'cx_loyalty',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize customer experience, loyalty program, retention, customer insights, voice of customer, NPS/satisfaction program owners, customer success, and member engagement leaders.${smallBizAddendum}`,
    };
  }

  if (mode === 'operations') {
    return {
      resolvedMode: 'operations',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize operations, customer experience, contact center, service delivery, branch/service center management, and process owners who influence systems, routing, or customer communication workflows.${smallBizAddendum}`,
    };
  }

  if (mode === 'it') {
    return {
      resolvedMode: 'it',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize IT, systems, data, integrations, marketing operations, and platform owners who evaluate security, implementation, and technical fit.${smallBizAddendum}`,
    };
  }

  if (mode === 'executive') {
    return {
      resolvedMode: 'executive',
      companySize,
      brief: `${sizeGuidance}\n\nPrioritize executive stakeholders and final approvers such as CMO, COO, CRO, CTO/CIO, President, GM, or SVP/VP leaders who would sponsor or approve the initiative.${smallBizAddendum}`,
    };
  }

  if (looksLikeHomeServices) {
    return {
      resolvedMode: 'operations',
      companySize,
      brief: `${sizeGuidance}\n\nThis appears to be a home-services / field-services company, so prioritize digital marketing, customer acquisition, customer experience, contact center, operations, IT, and executive sponsors rather than ecommerce-only roles.${smallBizAddendum}`,
    };
  }

  if (looksLikeRenewal) {
    return {
      resolvedMode: 'revenue',
      companySize,
      brief: `${sizeGuidance}\n\nThis looks tied to an existing customer or renewal motion, so prioritize customer marketing, lifecycle/CRM, digital, customer experience, revenue/ops, IT, and executive sponsors.${smallBizAddendum}`,
    };
  }

  return {
    resolvedMode: 'auto',
    companySize,
    brief: `${sizeGuidance}\n\nPrioritize the most likely buying committee for lifecycle marketing / CRM / customer communication software: marketing, digital, lifecycle/CRM, customer experience, operations, IT, and executive sponsors.${smallBizAddendum}`,
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
  division,
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
  division?: string | null;
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
            content: `Find current employees and likely buying-committee stakeholders at "${accountName}"${division ? ` specifically within the "${division}" division/business unit` : ''}.

CRITICAL ACCURACY REQUIREMENT: "${accountName}" must be matched EXACTLY. Do NOT confuse this company with similarly-named companies. Use the website (${website || 'unknown'}) and industry (${industry || 'unknown'}) to disambiguate. If the company has a common name, be extra careful to verify each person works at THIS specific company.

Company context:
- Website: ${website || 'unknown'}
- Industry: ${industry || 'unknown'}
- Motion: ${motion || 'unknown'}
- Division/BU: ${division || 'entire company'}
- Opportunity context: ${opportunityContext || 'none provided'}
- Custom focus: ${focusPrompt || 'none provided'}
- Website summary: ${websiteSummary || 'not available'}

Discovery guidance:
${roleBrief}

${division ? `CRITICAL: Only return people who work in or support the "${division}" division. Exclude people from other divisions.` : ''}

Search LinkedIn, company leadership/about/team pages, press releases, conference speaker pages, interviews, podcasts, local business coverage, and industry association directories.

IMPORTANT: Do NOT include interns, fellows, apprentices, or co-ops. Only full-time professional employees.

For smaller or local businesses, look harder at the company website (About/Team/Leadership pages), local news coverage, and industry memberships. Even 1-2 accurate contacts is valuable.

Return up to ${maxContacts} CURRENT people at the company who are most relevant. For each person include:
- Full name
- Current title
- Department or team they belong to
- Why they matter to this evaluation
- Their DIRECT LinkedIn profile URL (https://www.linkedin.com/in/...) — this is REQUIRED
- How long they have been at the company (in months), or "unknown" if not determinable
- How long they have been in their current role (in months), or "unknown" if not determinable
- 1 short evidence note proving they are at THIS EXACT company now (e.g., "LinkedIn shows current role at ${accountName} since March 2023")

IMPORTANT: Only return people whose LinkedIn profile you can VERIFY shows them at "${accountName}". It is better to return fewer, accurate results than more questionable ones. If tenure is unknown, still include them — accuracy of employment is more important than tenure data.

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

async function discoverForSingleAccount({
  supabase,
  userId,
  accountId,
  accountName,
  website,
  industry,
  opportunityContext,
  focusPrompt,
  maxContacts,
  discoveryMode,
  division,
}: {
  supabase: any;
  userId: string;
  accountId: string;
  accountName?: string;
  website?: string;
  industry?: string;
  opportunityContext?: string;
  focusPrompt?: string;
  maxContacts?: number;
  discoveryMode?: string;
  division?: string;
}) {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id, name, website, industry, motion, notes')
    .eq('id', accountId)
    .maybeSingle();

  if (accountError) {
    console.error('discover-contacts account lookup failed:', accountError.message);
    return { accountId, error: 'Failed to load account context' };
  }

  if (!account) {
    return { accountId, error: 'Account not found' };
  }

  const resolvedAccountName = cleanText(account.name || accountName);
  if (!resolvedAccountName) {
    return { accountId, error: 'accountName required' };
  }

  const resolvedWebsite = normalizeWebsite(account.website || website);
  const resolvedIndustry = cleanText(account.industry || industry);
  const resolvedMotion = cleanText(account.motion);
  const resolvedFocusPrompt = cleanText(focusPrompt);
  const resolvedDivision = cleanText(division);
  const requestedMaxContacts = Math.max(3, Math.min(Number(maxContacts) || 5, 10));
  const requestedMode = (['auto', 'marketing', 'digital_engagement', 'marketing_ops', 'revenue', 'cx_loyalty', 'operations', 'it', 'executive'].includes(discoveryMode || '')
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
    return { accountId, accountName: resolvedAccountName, error: 'Failed to load existing contacts' };
  }

  const existingNames = new Set((existingContacts || []).map((contact: any) => cleanText(contact.name).toLowerCase()).filter(Boolean));
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
    division: resolvedDivision,
  });

  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    return { accountId, accountName: resolvedAccountName, error: 'AI not configured' };
  }

  console.log('discover-contacts request context:', {
    userId,
    accountId,
    accountName: resolvedAccountName,
    requestedMode,
    resolvedMode,
    requestedMaxContacts,
    division: resolvedDivision || null,
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
          content: `You are a B2B stakeholder discovery assistant. Your PRIMARY goal is ACCURACY — never return a contact unless you have strong evidence they currently work at this specific company. Convert research into a strict contact list for a sales rep.

ACCURACY RULES (non-negotiable):
1. ONLY return contacts where you have CONCRETE EVIDENCE they currently work at this EXACT company (not a similarly-named company, not a former employee).
2. You MUST provide their real LinkedIn profile URL (https://www.linkedin.com/in/...). Do NOT invent or guess LinkedIn URLs.
3. You MUST verify the company name matches — "Black Dog Tavern" is NOT "Black Dog Clothing". "Delta Dental" is NOT "Delta Airlines". Pay close attention to industry context.
4. If the company has a common name, use the website domain, industry, and other context to disambiguate. When in doubt, EXCLUDE the contact.
5. If you can determine tenure, include it. If you cannot determine tenure, you may still include the contact — set company_tenure_months and role_tenure_months to -1 to indicate unknown. Do NOT exclude contacts solely because tenure is unknown.
6. Keep notes short and evidence-based. Include WHERE you found evidence of their employment (e.g., "Found on company leadership page", "LinkedIn shows current role since 2023").
7. It is FAR BETTER to return 2 accurate contacts than 5 questionable ones.
8. NEVER include interns, fellows, apprentices, or co-ops. Only include full-time professional staff.
9. For smaller or local businesses, look at the company website's About/Team/Leadership pages, local press, and industry associations. These companies may have fewer stakeholders — return whoever is relevant even if it's only 1-2 people.${resolvedDivision ? ` CRITICAL: Only include people from the "${resolvedDivision}" division/business unit. Exclude people from other divisions.` : ''}`,
        },
        {
          role: 'user',
          content: `Build a stakeholder map for "${resolvedAccountName}"${resolvedDivision ? ` — "${resolvedDivision}" division only` : ''}.

Account context:
- Website: ${resolvedWebsite || 'unknown'}
- Industry: ${resolvedIndustry || 'unknown'}
- Motion: ${resolvedMotion || 'unknown'}
- Division/BU: ${resolvedDivision || 'entire company (all divisions)'}
- Opportunity context: ${opportunityContext || 'none provided'}
- Discovery mode: ${resolvedMode}
- Custom focus: ${resolvedFocusPrompt || 'none provided'}
- Target count: ${requestedMaxContacts}
- Account notes: ${cleanText(account.notes) || 'none'}

${divisionScope}

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
- Exclude duplicate names and anyone already in the existing contacts list.
- NEVER include interns, fellows, apprentices, or co-ops — only full-time professional employees.
- CRITICAL: You MUST provide a direct LinkedIn profile URL for every contact (https://www.linkedin.com/in/...). Do NOT return a contact if you cannot find their LinkedIn profile URL.
- For tenure: estimate company_tenure_months and role_tenure_months based on available evidence. If you truly cannot determine tenure, set both to -1 (unknown) — do NOT omit the contact just because tenure is unknown.
- For smaller/local businesses with limited online presence, search the company website (About, Team, Leadership, Contact pages), local news, industry directories, and association memberships. Even 1-2 accurate contacts is valuable.`,
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
                      linkedin_url: { type: 'string', description: 'Direct LinkedIn profile URL (https://www.linkedin.com/in/...)' },
                      company_tenure_months: { type: 'number', description: 'Estimated months at the company' },
                      role_tenure_months: { type: 'number', description: 'Estimated months in current role' },
                      notes: { type: 'string' },
                      confidence: { type: 'string', enum: ['verified', 'likely', 'suggested'] },
                    },
                    required: ['name', 'title', 'buyer_role', 'linkedin_url', 'company_tenure_months', 'role_tenure_months'],
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
    if (status === 429) return { accountId, accountName: resolvedAccountName, error: 'Rate limit exceeded' };
    if (status === 402) return { accountId, accountName: resolvedAccountName, error: 'AI credits exhausted' };
    return { accountId, accountName: resolvedAccountName, error: `AI error: ${status}` };
  }

  const aiData = await aiResp.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    console.error('discover-contacts AI response missing tool call:', JSON.stringify(aiData).slice(0, 1000));
    return { accountId, accountName: resolvedAccountName, error: 'No structured response from AI' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (parseErr) {
    console.error('discover-contacts JSON parse failed:', parseErr, toolCall.function.arguments.slice(0, 500));
    return { accountId, accountName: resolvedAccountName, error: 'Failed to parse AI response' };
  }

  // Server-side validation: enforce LinkedIn URL format, filter interns
  const validContacts = (parsed?.contacts || []).filter((contact: any) => {
    if (!contact.name || !cleanText(contact.name)) return false;
    // Must have a valid LinkedIn URL (strict format check)
    if (!isValidLinkedInUrl(contact.linkedin_url)) {
      console.log(`discover-contacts: filtered out "${contact.name}" — invalid LinkedIn URL: ${contact.linkedin_url || 'none'}`);
      return false;
    }
    // Filter out interns/fellows/apprentices
    const titleLower = (contact.title || '').toLowerCase();
    if (/\b(intern|internship|fellow|apprentice|co-op|coop)\b/.test(titleLower)) {
      console.log(`discover-contacts: filtered out "${contact.name}" — intern/fellow title: ${contact.title}`);
      return false;
    }
    // Normalize unknown tenure to -1 instead of rejecting
    if (typeof contact.company_tenure_months !== 'number') contact.company_tenure_months = -1;
    if (typeof contact.role_tenure_months !== 'number') contact.role_tenure_months = -1;
    return true;
  });

  const deduped = dedupeContacts(validContacts).filter((contact: any) => !existingNames.has(cleanText(contact.name).toLowerCase()));

  // For single-account discovery (not batch), verify top LinkedIn URLs via Firecrawl
  // Limit to 3 verifications to avoid timeout
  const maxVerify = 3;
  const discovered: any[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const contact = deduped[i];
    if (i < maxVerify) {
      const verified = await verifyLinkedInUrl(contact.linkedin_url);
      contact.linkedin_verified = verified;
      if (!verified) {
        console.log(`discover-contacts: LinkedIn verification failed for "${contact.name}" — ${contact.linkedin_url}`);
        contact.confidence = 'suggested'; // Downgrade confidence
      }
    } else {
      contact.linkedin_verified = null; // Not checked
    }
    discovered.push(contact);
  }

  console.log('discover-contacts completed:', {
    accountId,
    accountName: resolvedAccountName,
    totalStructured: parsed?.contacts?.length || 0,
    newContacts: discovered.length,
    source: webResearch ? (websiteSummary ? 'website+perplexity+ai' : 'perplexity+ai') : (websiteSummary ? 'website+ai' : 'ai'),
  });

  return {
    accountId,
    accountName: resolvedAccountName,
    success: true,
    contacts: discovered,
    total_found: parsed?.contacts?.length || 0,
    new_contacts: discovered.length,
    source: webResearch ? (websiteSummary ? 'website+perplexity+ai' : 'perplexity+ai') : (websiteSummary ? 'website+ai' : 'ai'),
    discovery_mode: resolvedMode,
    focus_prompt: resolvedFocusPrompt || null,
    website_research_used: Boolean(websiteSummary),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authorization' }, 401);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('discover-contacts auth error:', userError?.message || 'No user');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const userId = user.id;
    const body = await req.json();

    // Support batch mode: if accountIds array is provided, run for each
    const accountIds: string[] = body.accountIds || (body.accountId ? [body.accountId] : []);
    if (accountIds.length === 0) {
      return jsonResponse({ error: 'accountId or accountIds required' }, 400);
    }

    const isBatch = accountIds.length > 1;

    if (!isBatch) {
      // Single account mode — preserve existing response shape
      const result = await discoverForSingleAccount({
        supabase,
        userId,
        accountId: accountIds[0],
        accountName: body.accountName,
        website: body.website,
        industry: body.industry,
        opportunityContext: body.opportunityContext,
        focusPrompt: body.focusPrompt,
        maxContacts: body.maxContacts,
        discoveryMode: body.discoveryMode,
        division: body.division,
      });

      if (result.error) {
        return jsonResponse({ error: result.error }, 400);
      }
      return jsonResponse(result);
    }

    // Batch mode — process sequentially to avoid timeouts, return results array
    const results: any[] = [];
    for (const accountId of accountIds) {
      try {
        const result = await discoverForSingleAccount({
          supabase,
          userId,
          accountId,
          discoveryMode: body.discoveryMode,
          maxContacts: body.maxContacts,
          focusPrompt: body.focusPrompt,
          division: body.division,
        });
        results.push(result);
        console.log(`Batch discover: ${result.accountName || accountId} — ${result.new_contacts || 0} new contacts`);
      } catch (err) {
        console.error(`Batch discover failed for ${accountId}:`, err);
        results.push({ accountId, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return jsonResponse({
      success: true,
      batch: true,
      total_accounts: accountIds.length,
      completed: results.filter((r) => r.success).length,
      failed: results.filter((r) => r.error).length,
      results,
    });
  } catch (error) {
    console.error('discover-contacts error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});