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
    const { text, opportunityContext } = await req.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const systemPrompt = `You are a CRM data extraction assistant. Given pasted text (usually from Claude conversations or meeting notes), extract updates for a SINGLE sales opportunity.

Current opportunity context:
${JSON.stringify(opportunityContext || {}, null, 2)}

Extract any field updates found in the text. Only return fields that have clear new values in the pasted text — do NOT echo back existing values.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Extract opportunity field updates from this text:\n\n${text}` },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_opp_updates',
            description: 'Extract opportunity field updates from pasted text',
            parameters: {
              type: 'object',
              properties: {
                updates: {
                  type: 'object',
                  properties: {
                    stage: { type: 'string', enum: ['Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate', 'Closed Won', 'Closed Lost'] },
                    status: { type: 'string', enum: ['active', 'stalled', 'closed-won', 'closed-lost'] },
                    arr: { type: 'number', description: 'Annual Recurring Revenue in dollars' },
                    closeDate: { type: 'string', description: 'YYYY-MM-DD format' },
                    nextStep: { type: 'string' },
                    nextStepDate: { type: 'string', description: 'YYYY-MM-DD format' },
                    notes: { type: 'string', description: 'New notes to append' },
                    churnRisk: { type: 'string', enum: ['low', 'medium', 'high', 'certain'] },
                    dealType: { type: 'string', enum: ['new-logo', 'expansion', 'renewal', 'one-time'] },
                    priorContractArr: { type: 'number' },
                    renewalArr: { type: 'number' },
                    oneTimeAmount: { type: 'number' },
                    termMonths: { type: 'number' },
                  },
                  additionalProperties: false,
                },
                contacts: {
                  type: 'array',
                  description: 'New contacts mentioned in the text',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      title: { type: 'string' },
                      buyerRole: { type: 'string', enum: ['economic_buyer', 'champion', 'technical_buyer', 'user_buyer', 'coach', 'influencer', 'blocker'] },
                      notes: { type: 'string' },
                    },
                    required: ['name'],
                    additionalProperties: false,
                  },
                },
                summary: { type: 'string', description: 'Brief summary of what was extracted' },
              },
              required: ['updates', 'summary'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'extract_opp_updates' } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded, try again shortly.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error('No tool call in AI response');

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in parse-opp-synopsis:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
