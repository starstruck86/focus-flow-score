import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

    const { imageUrls, accountId, accountName } = await req.json();

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No images provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Parsing ${imageUrls.length} screenshots for account: ${accountName}`);

    // Build image content parts for vision model
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
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a data extraction assistant for B2B sales reps. Extract structured data from screenshots of platforms like eTailInsights, BuiltWith, Wappalyzer, or similar tools.

These screenshots typically contain two sections:
1. "Website Details" — company info, revenue estimates, product counts, order volume, social followers
2. "Technology" — categorized list of detected platforms with first/last seen dates

Return ONLY valid JSON with this exact structure (use empty string "" for unknown fields, not null):
{
  "ecommerce_platform": "Commerce platform (e.g. Shopify, Shopify Plus, BigCommerce, Magento, WooCommerce, Salesforce Commerce Cloud)",
  "esp_platform": "Email Service Provider from 'Email Service Provider(s)' row (e.g. Klaviyo, Mailchimp, SFMC, Braze, Iterable, Sailthru, Cordial, or 'In-House Solution')",
  "sms_platform": "SMS/Chat platform from 'Chat Technologies' row (e.g. Attentive, Postscript, Yotpo SMS, Klaviyo SMS)",
  "loyalty_platform": "Loyalty/rewards platform from 'Web Analytics' or dedicated row (e.g. LoyaltyLion, Smile.io, Yotpo Loyalty)",
  "reviews_platform": "Reviews/UGC tool from 'Reviews' row (e.g. Yotpo, Judge.me, Bazaarvoice, PowerReviews, Stamped)",
  "cdp_platform": "CDP name if visible (e.g. Segment, mParticle, Tealium)",
  "advertising_platforms": "Advertising/referral platforms (e.g. Friendbuy, Refersion)",
  "payment_platforms": "Payment methods detected (e.g. Apple Pay, Klarna, PayPal, Venmo, Afterpay)",
  "analytics_tools": "Analytics tools (e.g. Google Tag Manager, Northbeam, Triple Whale)",
  "search_platform": "Site search tool (e.g. Algolia, Searchspring)",
  "cms_platform": "CMS if detected (e.g. Contentful, WordPress)",
  "mobile_app_platform": "Mobile app tech if detected (e.g. Tapcart, React Native)",
  "other_tech": "Any other notable tech (CDN, A/B testing, etc.)",
  "estimated_product_count": "Number from 'Estimated Product Count' (e.g. '1,000')",
  "estimated_aov": "Dollar amount from 'Estimated Average Order Value' (e.g. '$105.4')",
  "estimated_online_sales": "Most recent year's estimated online sales (e.g. '$51M')",
  "estimated_orders_per_day": "From 'Estimated Online Orders Shipped Per Day' (e.g. '1,309')",
  "employee_count": "From 'Employee Count' (e.g. '201 - 500')",
  "industry": "From 'Industry' field (e.g. 'Apparel, Accessories, and Shoes')",
  "annual_email_frequency": "From 'Annual Email Send Frequency' (e.g. '239')",
  "ships_internationally": true/false,
  "direct_ecommerce": true/false,
  "loyalty_membership": true/false,
  "mobile_app": true/false,
  "summary": "2-3 sentence summary highlighting the most sales-relevant findings"
}

Combine data from ALL screenshots into a single unified result. If the same field appears in multiple screenshots, prefer the most specific/detailed value. Pay close attention to category headers in the Technology section — they tell you what type of tool each entry is.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract all data from these ${imageUrls.length} eTailInsights screenshot(s) for "${accountName || 'unknown'}". Look for: Commerce Platform, Email Service Provider, SMS/Chat tech, Loyalty platform, Reviews, Advertising, Payments, Analytics, Search, CMS, Mobile App tech. Also extract Website Details: Estimated Product Count, Average Order Value, Online Sales, Orders/Day, Employee Count, Industry, Email Frequency.`,
              },
              ...imageContent,
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI Gateway error:', response.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `AI processing failed: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    console.log('AI response:', content);

    // Parse JSON from response (handle markdown code blocks)
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

    // Build MarTech string
    const marTechParts: string[] = [];
    if (parsed.esp_platform) marTechParts.push(`ESP: ${parsed.esp_platform}`);
    if (parsed.sms_platform) marTechParts.push(`SMS: ${parsed.sms_platform}`);
    if (parsed.cdp_platform) marTechParts.push(`CDP: ${parsed.cdp_platform}`);
    if (parsed.personalization_platform) marTechParts.push(`Personalization: ${parsed.personalization_platform}`);
    if (parsed.reviews_platform) marTechParts.push(`Reviews: ${parsed.reviews_platform}`);
    if (parsed.marketing_automation && parsed.marketing_automation !== parsed.esp_platform) {
      marTechParts.push(`Automation: ${parsed.marketing_automation}`);
    }
    const marTechString = marTechParts.join(' | ') || null;
    const ecommerceString = parsed.ecommerce_platform || null;

    // Write to DB if accountId provided
    if (accountId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const updates: Record<string, any> = {
          mar_tech: marTechString,
          ecommerce: ecommerceString,
          last_enriched_at: new Date().toISOString(),
        };

        // Update boolean signals if detected
        if (parsed.direct_ecommerce !== undefined) updates.direct_ecommerce = parsed.direct_ecommerce;
        if (parsed.email_sms_capture !== undefined) updates.email_sms_capture = parsed.email_sms_capture;
        if (parsed.loyalty_membership !== undefined) updates.loyalty_membership = parsed.loyalty_membership;
        if (parsed.mobile_app !== undefined) updates.mobile_app = parsed.mobile_app;
        if (parsed.esp_platform || parsed.marketing_automation) {
          updates.marketing_platform_detected = parsed.esp_platform || parsed.marketing_automation;
        }

        // Merge into enrichment_evidence
        const { data: existing } = await supabase
          .from('accounts')
          .select('enrichment_evidence, enrichment_source_summary')
          .eq('id', accountId)
          .single();

        const existingEvidence = (existing?.enrichment_evidence as Record<string, string>) || {};
        updates.enrichment_evidence = {
          ...existingEvidence,
          screenshot_esp_platform: parsed.esp_platform || '',
          screenshot_sms_platform: parsed.sms_platform || '',
          screenshot_ecommerce_platform: parsed.ecommerce_platform || '',
          screenshot_cdp_platform: parsed.cdp_platform || '',
          screenshot_personalization: parsed.personalization_platform || '',
          screenshot_reviews: parsed.reviews_platform || '',
          screenshot_loyalty: parsed.loyalty_program || '',
          screenshot_other: parsed.other_tech || '',
          screenshot_parsed_at: new Date().toISOString(),
        };

        // Append screenshot summary
        const existingSummary = existing?.enrichment_source_summary || '';
        if (parsed.summary) {
          updates.enrichment_source_summary = existingSummary
            ? `${existingSummary}\n\n**Screenshot data (${new Date().toLocaleDateString()}):**\n${parsed.summary}`
            : `**Screenshot data (${new Date().toLocaleDateString()}):**\n${parsed.summary}`;
        }

        const { error: dbError } = await supabase
          .from('accounts')
          .update(updates)
          .eq('id', accountId);

        if (dbError) console.error('DB write error:', dbError);
        else console.log('Screenshot enrichment persisted for', accountId);
      } catch (dbErr) {
        console.error('DB persistence failed:', dbErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted: parsed,
        marTech: marTechString,
        ecommerce: ecommerceString,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Screenshot parse error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
