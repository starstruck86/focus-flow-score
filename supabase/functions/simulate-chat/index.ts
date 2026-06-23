import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

async function callAnthropic(body: Record<string, unknown>) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { messages, system, isGradeMode } = body;

    if (isGradeMode) {
      const conversationText = (messages || [])
        .map((m: any) => `${m.role === 'user' ? 'AE' : 'Prospect'}: ${m.content}`)
        .join('\n');

      const gradePrompt = `You are a sales coach grading an AE's performance in a simulated call.

CONVERSATION:
${conversationText}

Grade this conversation on a 0-100 scale. Return ONLY valid JSON:
{
  "score": <0-100>,
  "grade": "<A+|A|A-|B+|B|B-|C+|C|D|F>",
  "summary": "<1 sentence overall assessment>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<gap 1>", "<gap 2>"],
  "nextStepLocked": <true|false>,
  "discoveryDepth": <1-5>,
  "coachingNote": "<1 specific actionable thing to do differently next time>"
}`;

      const gradeRes = await callAnthropic({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: gradePrompt }],
      });

      if (!gradeRes.ok) {
        const err = await gradeRes.text();
        return new Response(JSON.stringify({ error: err }), { status: gradeRes.status, headers: corsHeaders });
      }

      const data = await gradeRes.json();
      const text = data.content?.[0]?.text ?? '{}';
      const clean = text.replace(/```json|```/g, '').trim();
      let gradeResult: any = null;
      try { gradeResult = JSON.parse(clean); } catch { gradeResult = null; }
      return new Response(JSON.stringify({ gradeResult }), { status: 200, headers: corsHeaders });
    }

    const response = await callAnthropic({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      system,
      messages,
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: err }), { status: response.status, headers: corsHeaders });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '';
    return new Response(JSON.stringify({ text }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
