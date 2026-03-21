import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch resource digests and transcript grades in parallel
    const [digestsRes, gradesRes] = await Promise.all([
      supabase
        .from('resource_digests')
        .select('resource_id, takeaways, use_cases, grading_criteria, summary')
        .eq('user_id', user.id),
      supabase
        .from('transcript_grades')
        .select('overall_score, structure_score, cotm_score, meddicc_score, discovery_score, presence_score, commercial_score, next_step_score, improvements, coaching_issue, missed_opportunities, call_type, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    const digests = digestsRes.data || [];
    const grades = gradesRes.data || [];

    if (!grades.length) {
      return new Response(JSON.stringify({
        gaps: [],
        summary: 'Not enough graded transcripts to identify knowledge gaps. Grade at least 3 calls first.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Calculate average scores across categories
    const categories = ['structure_score', 'cotm_score', 'meddicc_score', 'discovery_score', 'presence_score', 'commercial_score', 'next_step_score'];
    const categoryLabels: Record<string, string> = {
      structure_score: 'Call Structure',
      cotm_score: 'Command of the Message',
      meddicc_score: 'MEDDICC',
      discovery_score: 'Discovery Depth',
      presence_score: 'Executive Presence',
      commercial_score: 'Commercial Acumen',
      next_step_score: 'Next Steps',
    };

    const avgScores: Record<string, number> = {};
    for (const cat of categories) {
      const vals = grades.map((g: any) => g[cat]).filter((v: any) => v !== null && v !== undefined);
      avgScores[cat] = vals.length ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : 0;
    }

    // Aggregate resource coverage topics from use_cases
    const allUseCases = digests.flatMap((d: any) => d.use_cases || []);
    const allTakeaways = digests.flatMap((d: any) => d.takeaways || []);

    // Find weak areas (below 60/100) that have limited resource coverage
    const weakCategories = categories.filter(cat => avgScores[cat] < 60);
    const recurringIssues = grades
      .flatMap((g: any) => g.improvements || [])
      .reduce((acc: Record<string, number>, item: string) => {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
      }, {});

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = `You are a sales enablement strategist. Analyze the gap between what this rep's library teaches vs where they're weak.

LIBRARY COVERAGE (${digests.length} operationalized resources):
Use cases covered: ${allUseCases.slice(0, 50).join('; ')}
Key takeaways themes: ${allTakeaways.slice(0, 30).join('; ')}

PERFORMANCE DATA (last ${grades.length} graded calls):
Average scores: ${categories.map(c => `${categoryLabels[c]}: ${avgScores[c]}/100`).join(', ')}
Weak areas (below 60): ${weakCategories.map(c => categoryLabels[c]).join(', ') || 'None'}
Recurring improvements needed: ${Object.entries(recurringIssues).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5).map(([k, v]) => `${k} (${v}x)`).join(', ')}

Return a JSON array of 3-5 knowledge gaps with this structure:
[{
  "topic": "short topic name",
  "severity": "high" | "medium" | "low",
  "avgScore": number,
  "libraryResources": number (how many resources cover this),
  "diagnosis": "one sentence explaining the gap",
  "searchQuery": "suggested search to find resources on this topic"
}]

Only return the JSON array, no markdown.`;

    const aiRes = await fetch('https://api.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.3,
      }),
    });

    if (!aiRes.ok) {
      console.error('AI error:', await aiRes.text());
      return new Response(JSON.stringify({ error: 'AI analysis failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await aiRes.json();
    const content = aiResult.choices?.[0]?.message?.content || '[]';

    let gaps;
    try {
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      gaps = JSON.parse(cleaned);
    } catch {
      gaps = [];
    }

    return new Response(JSON.stringify({
      gaps,
      summary: `Analyzed ${grades.length} graded calls against ${digests.length} operationalized resources.`,
      avgScores: Object.fromEntries(categories.map(c => [categoryLabels[c], avgScores[c]])),
      weakCategories: weakCategories.map(c => categoryLabels[c]),
      librarySize: digests.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('detect-knowledge-gaps error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
