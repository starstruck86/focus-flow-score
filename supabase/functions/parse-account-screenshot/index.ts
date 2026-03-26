import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { imageUrls, context } = await req.json();

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No images provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Parsing ${imageUrls.length} screenshot(s) for account import`);

    const imageContent = imageUrls.map((url: string) => ({
      type: 'image_url' as const,
      image_url: { url },
    }));

    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `You are a data extraction assistant. Extract account/company information from screenshots. These could be from CRM systems, company websites, LinkedIn, spreadsheets, emails, or any source showing company details.

Extract as many fields as you can identify. Return ONLY valid JSON with this structure (use null for fields you cannot find):

{
  "accounts": [
    {
      "name": "Company name (REQUIRED)",
      "website": "Company website URL",
      "industry": "Industry or vertical",
      "motion": "new-logo or renewal (infer from context - if it mentions renewal dates/contracts it's renewal, otherwise new-logo)",
      "tier": "A, B, or C (infer from size/revenue if possible, otherwise null)",
      "ecommerce": "Ecommerce platform if visible (Shopify, BigCommerce, etc.)",
      "mar_tech": "Marketing tech stack if visible",
      "salesforce_id": "Salesforce ID if visible (18-char alphanumeric)",
      "salesforce_link": "Salesforce URL if visible",
      "planhat_link": "Planhat URL if visible",
      "notes": "Any additional context worth capturing",
      "arr": null,
      "renewal_due": null,
      "contacts": [
        {
          "name": "Contact name",
          "title": "Job title",
          "email": "Email address"
        }
      ]
    }
  ],
  "raw_text_summary": "Brief summary of what was in the screenshot(s)"
}

Rules:
- Extract ALL companies/accounts you can identify, even if partial data
- If you see a list/table of accounts, extract each row as a separate account
- For renewal accounts, try to extract ARR and renewal_due date (format: YYYY-MM-DD)
- Website should be just the domain (e.g. "example.com") without https://
- Be smart about inferring motion: renewal-related context = "renewal", prospecting/new business = "new-logo"
- Include contacts if you can identify people associated with accounts
- Never fabricate data - only extract what's clearly visible`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract all account/company information from these ${imageUrls.length} screenshot(s). ${context ? `Context: ${context}` : 'Look for company names, websites, industries, contact info, and any CRM/business data.'}`,
              },
              ...imageContent,
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI Gateway error:', response.status, errText);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again shortly.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: `AI processing failed: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    console.log('AI response length:', content.length);

    let parsed: any;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1]!.trim());
    } catch (parseErr) {
      console.error('Failed to parse AI response as JSON:', content);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to parse extracted data', raw: content }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, ...parsed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Screenshot import error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An unexpected error occurred. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
