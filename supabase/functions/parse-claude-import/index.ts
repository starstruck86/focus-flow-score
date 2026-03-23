import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, existingAccounts, existingOpportunities, existingContacts } = await req.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const systemPrompt = `You are a sales data parser. Extract structured CRM records from user-pasted text (typically from Claude conversations or notes).

Return ONLY valid JSON in this exact format:
{
  "records": [
    {
      "type": "account" | "opportunity" | "contact",
      "name": "Record name",
      "fields": { key: value pairs matching the field names below },
      "parentAccountName": "Account name this opp/contact belongs to (if applicable)"
    }
  ],
  "warnings": ["Any parsing warnings"]
}

ACCOUNT fields: name, website, industry, priority (high/medium/low), tier (A/B/C), motion (new-logo/renewal/general), salesforceLink, notes, nextStep
OPPORTUNITY fields: name, stage (Prospect/Discover/Demo/Proposal/Negotiate/Closed Won/Closed Lost), status (active/stalled/closed-won/closed-lost), arr (number), closeDate (YYYY-MM-DD), nextStep, nextStepDate (YYYY-MM-DD), notes, dealType (new-logo/expansion/renewal/one-time), churnRisk (low/medium/high/certain), salesforceLink, priorContractArr, renewalArr, oneTimeAmount, termMonths
CONTACT fields: name, title, email, linkedInUrl, department, seniority, buyerRole (economic_buyer/champion/technical_buyer/user_buyer/coach/influencer/blocker), influenceLevel (high/medium/low), notes, salesforceLink

Rules:
- Extract ALL recognizable records from the text
- For freeform notes about existing deals, extract as opportunity updates
- Parse dates to YYYY-MM-DD format
- Parse currency amounts to plain numbers (no $ or commas)
- If text mentions an account that an opportunity belongs to, set parentAccountName
- For contacts, always try to associate with an account via parentAccountName
- Be generous with extraction - extract partial data rather than nothing`;

    const userPrompt = `Parse the following text into CRM records. Here are existing records to match against:

EXISTING ACCOUNTS: ${JSON.stringify(existingAccounts?.slice(0, 100) || [])}

EXISTING OPPORTUNITIES: ${JSON.stringify(existingOpportunities?.slice(0, 100) || [])}

EXISTING CONTACTS: ${JSON.stringify(existingContacts?.slice(0, 100) || [])}

TEXT TO PARSE:
${text}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI API call failed [${response.status}]: ${errBody}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || '';
    
    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];
    
    let parsed;
    try {
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      return new Response(JSON.stringify({
        records: [],
        raw: content,
        warnings: ['Could not parse AI response as JSON. Raw response saved.'],
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Match records to existing data
    const records = (parsed.records || []).map((record: any) => {
      const result = { ...record, matchedId: null, matchedName: null, isNew: true, parentAccountId: null };
      
      // Fuzzy name match helper
      const normalize = (s: string) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      
      if (record.type === 'account') {
        const match = existingAccounts?.find((a: any) => 
          normalize(a.name) === normalize(record.name) ||
          (a.website && record.fields?.website && normalize(a.website).includes(normalize(record.fields.website)))
        );
        if (match) {
          result.matchedId = match.id;
          result.matchedName = match.name;
          result.isNew = false;
        }
      } else if (record.type === 'opportunity') {
        const match = existingOpportunities?.find((o: any) => 
          normalize(o.name) === normalize(record.name)
        );
        if (match) {
          result.matchedId = match.id;
          result.matchedName = match.name;
          result.isNew = false;
          result.parentAccountId = match.accountId;
          result.parentAccountName = match.accountName;
        }
        // Resolve parent account
        if (!result.parentAccountId && record.parentAccountName) {
          const acctMatch = existingAccounts?.find((a: any) => 
            normalize(a.name) === normalize(record.parentAccountName)
          );
          if (acctMatch) {
            result.parentAccountId = acctMatch.id;
            result.parentAccountName = acctMatch.name;
          }
        }
      } else if (record.type === 'contact') {
        const match = existingContacts?.find((c: any) => 
          normalize(c.name) === normalize(record.name) ||
          (c.email && record.fields?.email && normalize(c.email) === normalize(record.fields.email))
        );
        if (match) {
          result.matchedId = match.id;
          result.matchedName = match.name;
          result.isNew = false;
          result.parentAccountId = match.accountId;
        }
        if (!result.parentAccountId && record.parentAccountName) {
          const acctMatch = existingAccounts?.find((a: any) => 
            normalize(a.name) === normalize(record.parentAccountName)
          );
          if (acctMatch) {
            result.parentAccountId = acctMatch.id;
            result.parentAccountName = acctMatch.name;
          }
        }
      }
      
      return result;
    });

    return new Response(JSON.stringify({
      records,
      raw: content,
      warnings: parsed.warnings || [],
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in parse-claude-import:', error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
