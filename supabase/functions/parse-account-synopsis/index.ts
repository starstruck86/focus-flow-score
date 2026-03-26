import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, accountContext } = await req.json();

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

    const systemPrompt = `You are a sales data parser for account records. Extract structured updates from pasted text (typically from Claude conversations, meeting notes, or research summaries).

Return ONLY valid JSON in this exact format:
{
  "companyNotes": "Key insights, research findings, or meeting notes to append to company notes (string or null)",
  "updates": {
    "nextStep": "Next action item if mentioned (string or null)",
    "lastTouchDate": "Date of most recent interaction if mentioned, YYYY-MM-DD format (string or null)",
    "lastTouchType": "Type: call, manual-email, meeting, linkedin, other (string or null)",
    "industry": "Industry if mentioned and not already set (string or null)",
    "accountStatus": "One of: researching, prepped, active, inactive, disqualified, meeting-booked (string or null)"
  },
  "contacts": [
    {
      "name": "Full Name",
      "title": "Job Title",
      "department": "Department if mentioned",
      "seniority": "Seniority level if mentioned",
      "email": "Email if mentioned",
      "linkedInUrl": "LinkedIn URL if mentioned",
      "buyerRole": "economic_buyer/champion/technical_buyer/user_buyer/coach/influencer/blocker",
      "notes": "Any relevant notes about this person"
    }
  ],
  "summary": "One-line summary of what was extracted"
}

Rules:
- Extract ALL people/contacts mentioned with as much detail as possible
- For companyNotes: extract key business insights, research findings, competitive intel, product usage details — anything valuable for account context. Format cleanly with bullet points if multiple items.
- For lastTouchDate: only extract if a specific date of interaction is mentioned
- For nextStep: extract the most actionable next step mentioned
- Only set fields you have confidence about — use null for uncertain fields
- Parse dates to YYYY-MM-DD format
- Be generous with contact extraction — partial data is better than nothing`;

    const userPrompt = `Parse the following text for account "${accountContext.name}".

Current account data:
- Status: ${accountContext.accountStatus || 'unknown'}
- Industry: ${accountContext.industry || 'unknown'}
- Next Step: ${accountContext.nextStep || 'none'}
- Existing contacts: ${JSON.stringify(accountContext.existingContacts?.map((c: any) => c.name) || [])}

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

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    let parsed;
    try {
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      return new Response(JSON.stringify({
        companyNotes: null,
        updates: {},
        contacts: [],
        summary: 'Could not parse AI response.',
        raw: content,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      companyNotes: parsed.companyNotes || null,
      updates: parsed.updates || {},
      contacts: parsed.contacts || [],
      summary: parsed.summary || 'Parsed successfully',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in parse-account-synopsis:', error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
