import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
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
    const offset = body.offset || 0;

    // Get resources that have content but no knowledge items yet
    const { data: existingKI } = await supabaseAdmin
      .from('knowledge_items')
      .select('source_resource_id')
      .eq('user_id', user.id)
      .not('source_resource_id', 'is', null);

    const processedIds = new Set((existingKI || []).map((k: any) => k.source_resource_id));

    const { data: resources, error: resErr } = await supabaseAdmin
      .from('resources')
      .select('id, title, content, description, tags, resource_type, content_length')
      .eq('user_id', user.id)
      .in('enrichment_status', ['enriched', 'deep_enriched', 'verified'])
      .gt('content_length', 150)
      .order('content_length', { ascending: false })
      .range(offset, offset + 200);

    if (resErr) throw resErr;

    const unprocessed = (resources || []).filter((r: any) => !processedIds.has(r.id));
    const batch = unprocessed.slice(0, batchSize);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = {
      processed: 0,
      knowledge_created: 0,
      templates_created: 0,
      failed: 0,
      remaining: unprocessed.length - batch.length,
      failures: [] as string[],
    };

    for (const resource of batch) {
      try {
        // Call extract-tactics for each resource
        const extractRes = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-tactics`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader,
            },
            body: JSON.stringify({
              title: resource.title,
              content: resource.content?.slice(0, 12000),
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
          results.failed++;
          results.failures.push(`${resource.title}: no actionable units found`);
          continue;
        }

        // Insert knowledge items — auto-activated
        const knowledgeRows = items.map((item: any) => ({
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
          confidence_score: 0.65,
          status: 'active',
          active: true,
          user_edited: false,
          applies_to_contexts: ['dave', 'roleplay', 'prep', 'playbooks'],
          tags: [...(resource.tags || []), item.knowledge_type || 'skill', item.chapter || 'messaging'],
        }));

        const { error: insertErr } = await supabaseAdmin
          .from('knowledge_items')
          .insert(knowledgeRows);

        if (insertErr) {
          results.failed++;
          results.failures.push(`${resource.title}: insert error`);
          continue;
        }

        results.knowledge_created += knowledgeRows.length;

        // Auto-create template if structured
        const content = resource.content || '';
        const structureHits = [
          /subject\s*:/i, /dear\s/i, /hi\s\[/i, /step\s*\d/i,
          /agenda/i, /\[.*name.*\]/i, /template/i,
        ].filter(p => p.test(content)).length;

        if (structureHits >= 2 && content.length >= 200) {
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
