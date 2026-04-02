import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resourceIds } = await req.json();
    
    if (!resourceIds || !Array.isArray(resourceIds) || resourceIds.length === 0) {
      return new Response(JSON.stringify({ error: 'resourceIds required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch resources
    const { data: resources, error: fetchError } = await supabase
      .from('resources')
      .select('id, title, resource_type, content, description, tags, user_id')
      .in('id', resourceIds);

    if (fetchError || !resources) {
      return new Response(JSON.stringify({ error: fetchError?.message || 'No resources found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[batch-extract] Processing ${resources.length} resources`);

    const results: any[] = [];

    for (const r of resources) {
      if (!r.content || r.content.length < 200) {
        results.push({ id: r.id, title: r.title, kis: 0, error: 'Content too short' });
        continue;
      }

      try {
        // Call AI
        const items = await extractFromResource(LOVABLE_API_KEY, r);
        
        if (items.length === 0) {
          results.push({ id: r.id, title: r.title, kis: 0, error: 'No items passed validation' });
          continue;
        }

        // Insert KIs
        const rows = items.map((item: any) => ({
          user_id: r.user_id,
          source_resource_id: r.id,
          source_title: r.title,
          title: item.title,
          knowledge_type: item.knowledge_type || 'skill',
          chapter: item.chapter || 'messaging',
          sub_chapter: item.sub_chapter || null,
          tactic_summary: item.tactic_summary,
          why_it_matters: item.why_it_matters,
          when_to_use: item.when_to_use,
          when_not_to_use: item.when_not_to_use,
          example_usage: item.example_usage || item.example,
          macro_situation: item.macro_situation,
          micro_strategy: item.micro_strategy,
          how_to_execute: item.how_to_execute,
          what_this_unlocks: item.what_this_unlocks,
          source_excerpt: item.source_excerpt,
          source_location: item.source_location,
          framework: item.framework || 'General',
          who: item.who || 'Unknown',
          confidence_score: 0.75,
          status: 'active',
          active: true,
          user_edited: false,
          applies_to_contexts: item.applies_to_contexts || ['all'],
          tags: item.tags || [],
        }));

        const { error: insertError } = await supabase.from('knowledge_items').insert(rows);
        if (insertError) {
          results.push({ id: r.id, title: r.title, kis: 0, error: insertError.message });
        } else {
          results.push({ id: r.id, title: r.title, kis: rows.length });
          console.log(`[batch-extract] ${r.title}: ${rows.length} KIs inserted`);
        }
      } catch (err: any) {
        results.push({ id: r.id, title: r.title, kis: 0, error: err?.message || 'Unknown' });
      }
    }

    const totalKIs = results.reduce((s, r) => s + r.kis, 0);
    console.log(`[batch-extract] Done: ${totalKIs} KIs from ${resources.length} resources`);

    return new Response(JSON.stringify({ results, totalKIs }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[batch-extract] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── AI Extraction Logic ───

const SYSTEM_PROMPT = `You are an elite sales execution coach. Extract TACTICAL PLAYS from content.

A Knowledge Item is a PLAY — a structured, situational, reusable tactical entry that tells a rep exactly when, why, and how to execute.

EVERY knowledge item MUST include ALL of these fields:
1. "title" — verb-led action title (e.g. "Reframe the budget objection using cost-of-inaction")
2. "framework" — methodology (GAP Selling, Challenger Sale, MEDDPICC, Command of the Message, SPIN Selling, or "General"). REQUIRED.
3. "who" — thought leader or author. REQUIRED.
4. "source_excerpt" — EXACT quote from content. Min 2 sentences. REQUIRED.
5. "source_location" — where in content this was found. REQUIRED.
6. "macro_situation" — WHEN does this play apply? 2-4 sentences.
7. "micro_strategy" — WHAT are you doing? 2-3 sentences.
8. "why_it_matters" — WHY does this work? 2-3 sentences.
9. "how_to_execute" — HOW step by step. 3-5 concrete steps with exact phrasing.
10. "what_this_unlocks" — OUTCOME. 2-3 sentences.
11. "when_to_use" — trigger conditions (2-3 sentences)
12. "when_not_to_use" — boundaries (2-3 sentences)
13. "example_usage" — realistic talk track. Min 3-4 sentences.
14. "tactic_summary" — concise 2-3 sentence summary
15. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
16. "knowledge_type" — skill|product|competitive

TRANSCRIPT-SPECIFIC:
You are extracting from a podcast/interview transcript. Find SPECIFIC TECHNIQUES, FRAMEWORKS, and ACTIONABLE METHODS.
Extract 4-8 plays. Prioritize DEPTH over breadth.

QUALITY GATES — REJECT any item that:
- Has fields shorter than 2 sentences (except title, chapter, knowledge_type)
- Is generic advice without specific phrasing
- Describes what to think rather than what to DO

Return ONLY a JSON array.`;

async function callAI(apiKey: string, content: string, title: string, tags: string[]): Promise<any[]> {
  const userPrompt = `Extract tactical plays from this transcript:

Title: ${title}
Tags: ${(tags || []).join(', ') || 'none'}
Extract 4-8 plays. Quality over quantity.

Content:
${content.slice(0, 30000)}

Return ONLY a JSON array.`;

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 16384,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 3000));
      const retry = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 16384,
          temperature: 0.2,
        }),
      });
      if (!retry.ok) throw new Error(`AI retry failed: ${retry.status}`);
      return parseResponse(await retry.json());
    }
    throw new Error(`AI error: ${res.status}`);
  }

  return parseResponse(await res.json());
}

function parseResponse(result: any): any[] {
  const raw = result?.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf('['), e = cleaned.lastIndexOf(']');
    if (s !== -1 && e > s) {
      try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { return []; }
    }
    return [];
  }
}

function validateItem(item: any): boolean {
  if (!item.title || item.title.length < 5) return false;
  if (!item.tactic_summary || item.tactic_summary.length < 30) return false;
  if (!item.how_to_execute || item.how_to_execute.length < 40) return false;
  if (!item.when_to_use || item.when_to_use.length < 20) return false;
  if (!(item.example_usage || item.example)) return false;
  if (!item.framework) return false;
  if (!item.who) return false;
  
  const verbPattern = /^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize|apply|deploy|establish|negotiate|prepare|structure|deliver|align|engage|trigger|introduce|propose|define|prioritize|execute|implement|develop|assess|evaluate|document|track|measure|adapt|adjust|escalate|simplify|clarify|articulate|illustrate|connect|uncover|reveal|expose|surface|extract|capture|name|restate|mirror|acknowledge|interrupt|pause|reset|redirect|flip|plant|seed|earn|secure|protect|defend|block|pre-empt|anticipate|signal|commit|lock|tie|bundle|separate|isolate|stack|layer|combine|sequence|time|delay|accelerate|slow|speed|pace|control|manage|own|run|facilitate|orchestrate|coordinate|coach|mentor|advise|guide|steer|navigate|overcome|find|sell|target|research|discover|explore|investigate|analyze|craft|design|develop|formulate|optimize|refine|transform|convert|win|outmaneuver|outposition|differentiate|disqualify|displace|replace|adopt|embrace|prioritize|focus|shift|transition|move|turn|walk|listen|learn|study|master|practice|rehearse|drill|warm|cold|prospect|network|reach|contact|approach|invite|request|offer|provide|supply|equip|arm|enable|empower|motivate|inspire|convince|persuade|influence|educate|teach|train|inform|update|brief|debrief|report|communicate|convey|express|state|announce|declare|assert|insist|demand|require|expect|ensure|guarantee|promise|pledge|vow|swear|certify|attest|verify|check|audit|inspect|review|examine|scan|survey|poll|sample|score|rank|rate|grade|judge|weigh|consider|contemplate|reflect|ponder|brainstorm|ideate|innovate|iterate|experiment|prototype|pilot|launch|roll|scale|grow|expand|extend|broaden|widen|deepen|strengthen|reinforce|solidify|cement|anchor|ground|root|embed|integrate|incorporate|merge|blend|fuse|unify|harmonize|synchronize|balance|calibrate|fine-tune|tweak|modify|change|alter|revise|amend|correct|fix|repair|restore|recover|salvage|rescue|save|preserve|maintain|sustain|uphold|support|back|champion|advocate|promote|market|brand|advertise|publicize|broadcast|distribute|circulate|spread|propagate|disseminate|share|exchange|swap|trade|barter|negotiate|bargain|deal|transact|process|handle|manage|administer|govern|regulate|supervise|oversee|direct|command|instruct|order|assign|delegate|allocate|distribute|deploy|mobilize|activate|initiate|commence|begin|kick|jumpstart|bootstrap|catalyze|spark|ignite|fuel|power|charge|energize|invigorate|revitalize|rejuvenate|refresh|renew|reboot|restart|resume|continue|persist|persevere|endure|withstand|resist|fight|battle|combat|confront|face|tackle|attack|assault|storm|raid|ambush|trap|snare|lure|bait|hook|catch|grab|seize|claim|stake|mark|tag|label|categorize|classify|sort|organize|arrange|order|prioritize|rank|list|enumerate|count|tally|total|sum|add|subtract|multiply|divide|calculate|compute|estimate|forecast|predict|project|model|simulate|emulate|mimic|replicate|duplicate|copy|clone|reproduce|regenerate|recycle|reuse|repurpose|reinvent|reimagine|reconceptualize|rethink|reconsider|reevaluate|reassess|reexamine)\b/i;
  if (!verbPattern.test(item.title.trim())) return false;
  
  return true;
}

function deduplicateItems(items: any[]): any[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = (s: string) => new Set(norm(s).split(/\s+/).filter(w => w.length > 2));
  const result: any[] = [];
  for (const item of items) {
    const iw = words(item.title || '');
    let isDupe = false;
    for (const existing of result) {
      const ew = words(existing.title || '');
      const overlap = [...iw].filter(w => ew.has(w)).length / Math.min(iw.size, ew.size);
      if (overlap > 0.6) { isDupe = true; break; }
    }
    if (!isDupe) result.push(item);
  }
  return result;
}

async function extractFromResource(apiKey: string, r: any): Promise<any[]> {
  const rawItems = await callAI(apiKey, r.content, r.title, r.tags || []);
  console.log(`[batch-extract] ${r.title}: ${rawItems.length} raw items from AI`);
  if (rawItems.length > 0) {
    console.log(`[batch-extract] Sample title: "${rawItems[0].title}"`);
    console.log(`[batch-extract] Sample fields: tactic_summary=${rawItems[0].tactic_summary?.length || 0}, how_to_execute=${rawItems[0].how_to_execute?.length || 0}, when_to_use=${rawItems[0].when_to_use?.length || 0}, example=${(rawItems[0].example_usage || rawItems[0].example || '').length}, framework=${rawItems[0].framework}, who=${rawItems[0].who}`);
  }
  const validated = rawItems.filter((item: any) => {
    const ok = validateItem(item);
    if (!ok) console.log(`[batch-extract] REJECTED: "${(item.title || '').slice(0, 50)}" - verb check: ${/^(ask|use|open|start|say|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|respond|handle|counter|address|lead|drive|close|send|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|qualify|recap|summarize|apply|deploy|establish|negotiate|prepare|structure|deliver|align|engage|trigger|introduce|propose|define|prioritize|execute|implement|develop|assess|evaluate|document|track|measure|adapt|adjust|escalate|simplify|clarify|articulate|illustrate|connect|uncover|reveal|expose|surface|extract|capture|name|restate|mirror|acknowledge|interrupt|pause|reset|redirect|flip|plant|seed|earn|secure|protect|defend|block|pre-empt|anticipate|signal|commit|lock|tie|bundle|separate|isolate|stack|layer|combine|sequence|time|delay|accelerate|slow|speed|pace|control|manage|own|run|facilitate|orchestrate|coordinate|coach|mentor|advise|guide|steer|navigate|overcome)\b/i.test((item.title || '').trim())}`);
    return ok;
  });
  console.log(`[batch-extract] ${r.title}: ${validated.length} validated`);
  return deduplicateItems(validated).slice(0, 15);
}
