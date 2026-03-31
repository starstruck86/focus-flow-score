import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

// ── Trust Validation (server-side mirror) ──────────────────

const GENERIC_PATTERNS = [
  /^(it is|this is|there are|we need|you should|they will)/i,
  /^(important|key|critical|essential|necessary)\b/i,
  /\b(in general|generally speaking|as a rule)\b/i,
  /\b(best practices?|industry standard)\b/i,
];

const AI_FILLER = [
  /\b(leverage|utilize|facilitate|synerg|paradigm|holistic)\b/i,
  /\b(comprehensive|robust|seamless|cutting.edge)\b/i,
];

function validateItem(item: any, existingTitles: Set<string>): { passed: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const summary = item.tactic_summary || item.what_to_do || '';
  const title = item.title || '';
  const when = item.when_to_use || '';
  const example = item.example_usage || item.example || '';

  // Gate 1: Specificity
  const genericHits = GENERIC_PATTERNS.filter(p => p.test(summary)).length;
  const specificity = Math.max(0, 0.5 - genericHits * 0.15 + (summary.length > 40 ? 0.1 : 0));
  if (specificity < 0.35) reasons.push('not_specific');
  score += specificity * 0.2;

  // Gate 2: Actionability
  const hasVerb = /^(ask|say|write|send|use|open|start|frame|position|challenge|respond|handle|probe|build|create|demonstrate|show|tailor|highlight|compare|qualify|recap)/i.test(title);
  const actionability = (hasVerb ? 0.5 : 0.2) + (example.length > 15 ? 0.25 : 0) + (/["'"]/.test(summary) ? 0.15 : 0);
  if (actionability < 0.4) reasons.push('not_actionable');
  score += Math.min(1, actionability) * 0.3;

  // Gate 3: Distinctness
  const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  let isDuplicate = false;
  for (const existing of existingTitles) {
    const words1 = new Set(normTitle.split(' '));
    const words2 = new Set(existing.split(' '));
    let overlap = 0;
    for (const w of words1) { if (words2.has(w)) overlap++; }
    const similarity = (2 * overlap) / (words1.size + words2.size);
    if (similarity > 0.6) { isDuplicate = true; break; }
  }
  if (isDuplicate) reasons.push('duplicate');
  score += (isDuplicate ? 0.1 : 0.8) * 0.2;

  // Gate 4: Use-case clarity
  const hasWhen = when.length >= 10 && /\b(when|after|before|during|if|once)\b/i.test(when);
  if (!hasWhen) reasons.push('vague_context');
  score += (hasWhen ? 0.7 : 0.2) * 0.15;

  // Gate 5: Phrasing quality
  const aiHits = AI_FILLER.filter(p => p.test(summary)).length;
  const phrasingOk = aiHits === 0;
  if (!phrasingOk) reasons.push('ai_sounding');
  score += (phrasingOk ? 0.7 : 0.3) * 0.15;

  return { passed: reasons.length === 0, score, reasons };
}

// ── Resource Routing ───────────────────────────────────────

function routeResource(content: string, title: string): string {
  const text = `${title} ${content}`;
  const templateSignals = [/subject\s*:/i, /dear\s/i, /\[.*name.*\]/i, /step\s*\d/i, /template/i, /agenda/i];
  const exampleSignals = [/follow.up|recap/i, /we discussed/i, /next steps?/i, /^(hi|hey|hello)\s/im];
  const tacticSignals = [/\b(ask|say|use|try|respond|handle|frame)\b/i, /when\s+(the|a|your|they)/i, /objection/i, /discovery/i, /talk\s*track/i];

  const tplScore = templateSignals.filter(p => p.test(text)).length;
  const exScore = exampleSignals.filter(p => p.test(text)).length;
  const tacScore = tacticSignals.filter(p => p.test(text)).length;

  if (tplScore >= 2 && content.length >= 200) return 'template';
  if (exScore >= 2 && content.length >= 150) return 'example';
  if (tacScore >= 2) return 'tactic';
  if (content.length >= 100) return 'tactic'; // default to tactic extraction
  return 'reference';
}

// ── Dedup helpers ──────────────────────────────────────────

function isDuplicateTemplate(title: string, existingTitles: Set<string>): boolean {
  const norm = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  for (const existing of existingTitles) {
    const words1 = new Set(norm.split(' '));
    const words2 = new Set(existing.split(' '));
    let overlap = 0;
    for (const w of words1) { if (words2.has(w)) overlap++; }
    if ((2 * overlap) / (words1.size + words2.size) > 0.7) return true;
  }
  return false;
}

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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const batchSize = Math.min(body.batchSize || 10, 25);

    // Get existing knowledge item titles for dedup
    const [existingKI, existingTpl, existingEx] = await Promise.all([
      supabaseAdmin.from('knowledge_items').select('source_resource_id, title').eq('user_id', user.id),
      supabaseAdmin.from('execution_templates').select('title').eq('user_id', user.id),
      supabaseAdmin.from('execution_outputs').select('title').eq('user_id', user.id).eq('is_strong_example', true),
    ]);

    const processedIds = new Set((existingKI.data || []).map((k: any) => k.source_resource_id).filter(Boolean));
    const existingKITitles = new Set((existingKI.data || []).map((k: any) => k.title?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()).filter(Boolean));
    const existingTplTitles = new Set((existingTpl.data || []).map((t: any) => t.title?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()).filter(Boolean));
    const existingExTitles = new Set((existingEx.data || []).map((e: any) => e.title?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()).filter(Boolean));

    const { data: resources } = await supabaseAdmin
      .from('resources')
      .select('id, title, content, description, tags, resource_type, content_length')
      .eq('user_id', user.id)
      .in('enrichment_status', ['enriched', 'deep_enriched', 'verified'])
      .gt('content_length', 150)
      .order('content_length', { ascending: false })
      .limit(300);

    const unprocessed = (resources || []).filter((r: any) => !processedIds.has(r.id));
    const batch = unprocessed.slice(0, batchSize);

    const results = {
      processed: 0,
      knowledge_created: 0,
      knowledge_activated: 0,
      templates_created: 0,
      examples_created: 0,
      duplicates_suppressed: 0,
      trust_rejected: 0,
      failed: 0,
      remaining: unprocessed.length - batch.length,
      routed: { template: 0, example: 0, tactic: 0, reference: 0 } as Record<string, number>,
      failures: [] as string[],
    };

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const resource of batch) {
      try {
        const content = resource.content || '';
        const route = routeResource(content, resource.title);
        results.routed[route] = (results.routed[route] || 0) + 1;

        if (route === 'reference') {
          results.processed++;
          continue;
        }

        // Template creation with dedup
        if (route === 'template') {
          if (!isDuplicateTemplate(resource.title, existingTplTitles)) {
            await supabaseAdmin.from('execution_templates').insert({
              user_id: user.id,
              title: resource.title,
              body: content.slice(0, 5000),
              template_type: 'email',
              output_type: 'custom',
              source_resource_id: resource.id,
              tags: resource.tags || [],
              template_origin: 'promoted_from_resource',
              status: 'active',
              created_by_user: false,
              confidence_score: 0.7,
            });
            results.templates_created++;
            existingTplTitles.add(resource.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
          } else {
            results.duplicates_suppressed++;
          }
        }

        // Example creation with dedup
        if (route === 'example') {
          if (!isDuplicateTemplate(resource.title, existingExTitles)) {
            await supabaseAdmin.from('execution_outputs').insert({
              user_id: user.id,
              title: resource.title,
              content: content.slice(0, 5000),
              output_type: 'custom',
              is_strong_example: true,
            });
            results.examples_created++;
            existingExTitles.add(resource.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
          } else {
            results.duplicates_suppressed++;
          }
        }

        // Extract tactics for template, example, and tactic routes
        const extractRes = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-tactics`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
            body: JSON.stringify({
              title: resource.title,
              content: content.slice(0, 12000),
              description: resource.description,
              tags: resource.tags,
              resourceType: resource.resource_type,
            }),
          }
        );

        if (!extractRes.ok) {
          results.failed++;
          results.failures.push(`${resource.title}: extraction HTTP ${extractRes.status}`);
          continue;
        }

        const extracted = await extractRes.json();
        const items = extracted.items || [];

        if (items.length === 0) {
          if (route === 'tactic') results.failed++;
          results.processed++;
          continue;
        }

        // Trust-validate each item
        const validItems = [];
        for (const item of items) {
          const validation = validateItem(item, existingKITitles);

          if (validation.reasons.includes('duplicate')) {
            results.duplicates_suppressed++;
            continue;
          }

          validItems.push({
            user_id: user.id,
            source_resource_id: resource.id,
            title: item.title,
            knowledge_type: item.knowledge_type || 'skill',
            chapter: item.chapter || 'messaging',
            sub_chapter: item.sub_chapter || null,
            tactic_summary: item.tactic_summary || item.what_to_do,
            when_to_use: item.when_to_use,
            when_not_to_use: item.when_not_to_use || null,
            example_usage: item.example_usage || item.example || null,
            why_it_matters: item.why_it_matters || null,
            confidence_score: validation.score,
            status: validation.passed ? 'active' : 'extracted',
            active: validation.passed,
            user_edited: false,
            applies_to_contexts: ['dave', 'roleplay', 'prep', 'playbooks'],
            tags: [...(resource.tags || []), item.knowledge_type || 'skill', item.chapter || 'messaging'],
          });

          existingKITitles.add(item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());

          if (!validation.passed) results.trust_rejected++;
        }

        if (validItems.length > 0) {
          const { error: insertErr } = await supabaseAdmin.from('knowledge_items').insert(validItems);
          if (insertErr) {
            results.failed++;
            results.failures.push(`${resource.title}: insert error`);
            continue;
          }
          results.knowledge_created += validItems.length;
          results.knowledge_activated += validItems.filter(v => v.active).length;
        }

        results.processed++;
      } catch (err) {
        results.failed++;
        results.failures.push(`${resource.title}: ${String(err).slice(0, 100)}`);
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('batch-actionize error:', error);
    return new Response(JSON.stringify({ error: 'Batch processing failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
