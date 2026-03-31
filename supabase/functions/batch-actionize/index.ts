import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

// ── Failure reason types ───────────────────────────────────

type ResourceFailureReason =
  | 'missing_content'
  | 'extraction_returned_zero'
  | 'extraction_too_generic'
  | 'trust_failed_specificity'
  | 'trust_failed_actionability'
  | 'trust_failed_distinctness'
  | 'trust_failed_use_case_clarity'
  | 'trust_failed_phrasing_quality'
  | 'duplicate_template'
  | 'duplicate_example'
  | 'duplicate_knowledge'
  | 'routed_reference_only'
  | 'stale_blocker_state'
  | 'malformed_source'
  | 'template_incomplete'
  | 'example_not_strong_enough'
  | 'tactic_not_atomic'
  | 'extraction_error';

interface ResourceDiagnosis {
  resource_id: string;
  title: string;
  route: string;
  terminal_state: 'operationalized' | 'needs_review' | 'reference_only' | 'content_missing';
  failure_reasons: ResourceFailureReason[];
  retryable: boolean;
  recommended_fix: string;
  priority: 'high' | 'medium' | 'low';
  human_review_required: boolean;
  assets_created: {
    knowledge_items: number;
    knowledge_activated: number;
    templates: number;
    examples: number;
  };
  trust_failures: string[];
  most_similar_existing?: string;
}

// ── Trust Validation (server-side) ─────────────────────────

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

const ACTION_VERBS = /^(ask|say|write|send|use|open|start|frame|position|challenge|respond|handle|probe|build|create|demonstrate|show|tailor|highlight|compare|qualify|recap)/i;

function validateItem(item: any, existingTitles: Set<string>): {
  passed: boolean; score: number; failedGates: string[]; mostSimilar?: string;
} {
  const failedGates: string[] = [];
  let score = 0;
  const summary = item.tactic_summary || item.what_to_do || '';
  const title = item.title || '';
  const when = item.when_to_use || '';
  const example = item.example_usage || item.example || '';

  // Gate 1: Specificity
  const genericHits = GENERIC_PATTERNS.filter(p => p.test(summary)).length;
  const specificity = Math.max(0, 0.5 - genericHits * 0.15 + (summary.length > 40 ? 0.1 : 0));
  if (specificity < 0.35) failedGates.push('specificity');
  score += specificity * 0.2;

  // Gate 2: Actionability
  const hasVerb = ACTION_VERBS.test(title) || ACTION_VERBS.test(summary);
  const actionability = (hasVerb ? 0.5 : 0.2) + (example.length > 15 ? 0.25 : 0) + (/["'"]/.test(summary) ? 0.15 : 0);
  if (actionability < 0.4) failedGates.push('actionability');
  score += Math.min(1, actionability) * 0.3;

  // Gate 3: Distinctness
  const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  let mostSimilar: string | undefined;
  let maxSim = 0;
  for (const existing of existingTitles) {
    const words1 = new Set(normTitle.split(' '));
    const words2 = new Set(existing.split(' '));
    let overlap = 0;
    for (const w of words1) { if (words2.has(w)) overlap++; }
    const sim = words1.size + words2.size > 0 ? (2 * overlap) / (words1.size + words2.size) : 0;
    if (sim > maxSim) { maxSim = sim; mostSimilar = existing; }
  }
  if (maxSim > 0.6) failedGates.push('distinctness');
  score += (maxSim > 0.6 ? 0.1 : 0.8) * 0.2;

  // Gate 4: Use-case clarity
  const hasWhen = when.length >= 10 && /\b(when|after|before|during|if|once)\b/i.test(when);
  if (!hasWhen) failedGates.push('use_case_clarity');
  score += (hasWhen ? 0.7 : 0.2) * 0.15;

  // Gate 5: Phrasing quality
  const aiHits = AI_FILLER.filter(p => p.test(summary)).length;
  if (aiHits > 0) failedGates.push('phrasing_quality');
  score += (aiHits === 0 ? 0.7 : 0.3) * 0.15;

  return {
    passed: failedGates.length === 0,
    score,
    failedGates,
    mostSimilar: maxSim > 0.4 ? mostSimilar : undefined,
  };
}

// ── Resource Routing (multi-route) ─────────────────────────

function routeResource(content: string, title: string): string[] {
  const text = `${title} ${content}`;
  const routes: string[] = [];

  const templateSignals = [/subject\s*:/i, /dear\s/i, /\[.*name.*\]/i, /step\s*\d/i, /template/i, /agenda/i, /framework/i];
  const exampleSignals = [/follow.up|recap/i, /we discussed/i, /next steps?/i, /^(hi|hey|hello)\s/im, /looking forward/i];
  const tacticSignals = [/\b(ask|say|use|try|respond|handle|frame)\b/i, /when\s+(the|a|your|they)/i, /objection/i, /discovery/i, /talk\s*track/i, /tactic/i];

  const tplScore = templateSignals.filter(p => p.test(text)).length;
  const exScore = exampleSignals.filter(p => p.test(text)).length;
  const tacScore = tacticSignals.filter(p => p.test(text)).length;

  if (tplScore >= 2 && content.length >= 200) routes.push('template');
  if (exScore >= 2 && content.length >= 150) routes.push('example');
  if (tacScore >= 2 || content.length >= 100) routes.push('tactic');

  if (routes.length === 0) routes.push('reference');
  return routes;
}

// ── Dedup ──────────────────────────────────────────────────

function isDuplicate(title: string, existingTitles: Set<string>): boolean {
  const norm = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  for (const existing of existingTitles) {
    const words1 = new Set(norm.split(' '));
    const words2 = new Set(existing.split(' '));
    let overlap = 0;
    for (const w of words1) { if (words2.has(w)) overlap++; }
    if (words1.size + words2.size > 0 && (2 * overlap) / (words1.size + words2.size) > 0.7) return true;
  }
  return false;
}

// ── Remediation recommendations ────────────────────────────

function getRemediationPath(reason: ResourceFailureReason): string {
  const paths: Record<ResourceFailureReason, string> = {
    missing_content: 'Re-enrich this resource, manually paste content, or upload a better source file.',
    extraction_returned_zero: 'Retry with LLM extraction, chunk the source differently, or expand context window.',
    extraction_too_generic: 'Re-extract with stricter prompt forcing exact phrasing and specific actions only.',
    trust_failed_specificity: 'Rewrite the title and summary to include specific names, numbers, or concrete details.',
    trust_failed_actionability: 'Convert the principle into an action: add "what to do" + "when to use" + example phrasing.',
    trust_failed_distinctness: 'Merge into the similar existing item, discard, or keep with differentiated angle.',
    trust_failed_use_case_clarity: 'Add a specific trigger: "When [situation], use this to [outcome]."',
    trust_failed_phrasing_quality: 'Rewrite in natural rep language — remove corporate jargon and AI filler words.',
    duplicate_template: 'Already exists as a template. Link to the existing one or differentiate the use case.',
    duplicate_example: 'Already exists as an example. Link to the existing one or archive this copy.',
    duplicate_knowledge: 'Already captured as a knowledge item. Merge additional insights or discard.',
    routed_reference_only: 'Low direct leverage — keep as background reference material or attempt manual promotion.',
    stale_blocker_state: 'Resource is stuck in a prior pipeline stage. Re-run enrichment or resolve the blocker.',
    malformed_source: 'Source content is corrupted or unreadable. Re-upload or paste clean content manually.',
    template_incomplete: 'Template lacks required structure (subject, body, variables). Complete the missing sections.',
    example_not_strong_enough: 'Example lacks realism or clarity. Edit to add specific account context and real phrasing.',
    tactic_not_atomic: 'Tactic is too broad. Break into 2-3 specific, single-action items.',
    extraction_error: 'Technical extraction failure. Retry — if persistent, flag for manual review.',
  };
  return paths[reason] || 'Review manually and decide: promote, extract, or archive.';
}

function getPriority(reasons: ResourceFailureReason[], contentLen: number): 'high' | 'medium' | 'low' {
  if (reasons.includes('missing_content') || reasons.includes('malformed_source')) return 'low';
  if (contentLen > 500 && reasons.length <= 2) return 'high';
  if (contentLen > 200) return 'medium';
  return 'low';
}

// ── Main handler ───────────────────────────────────────────

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
    const batchSize = Math.min(body.batchSize || 15, 50);
    const mode = body.mode || 'standard'; // 'standard' | 'full_backlog'

    // Fetch all existing assets for dedup
    const [existingKI, existingTpl, existingEx] = await Promise.all([
      supabaseAdmin.from('knowledge_items').select('id, source_resource_id, title, tactic_summary').eq('user_id', user.id),
      supabaseAdmin.from('execution_templates').select('id, title').eq('user_id', user.id),
      supabaseAdmin.from('execution_outputs').select('id, title').eq('user_id', user.id).eq('is_strong_example', true),
    ]);

    const processedResourceIds = new Set(
      (existingKI.data || []).map((k: any) => k.source_resource_id).filter(Boolean)
    );
    const existingKITitles = new Set(
      (existingKI.data || []).map((k: any) => k.title?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()).filter(Boolean)
    );
    const existingTplTitles = new Set(
      (existingTpl.data || []).map((t: any) => t.title?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()).filter(Boolean)
    );
    const existingExTitles = new Set(
      (existingEx.data || []).map((e: any) => e.title?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()).filter(Boolean)
    );

    // Fetch all eligible resources
    const { data: allResources } = await supabaseAdmin
      .from('resources')
      .select('id, title, content, description, tags, resource_type, content_length, enrichment_status, failure_reason, manual_input_required, content_status')
      .eq('user_id', user.id)
      .order('content_length', { ascending: false })
      .limit(500);

    const resources = allResources || [];

    // Classify ALL resources into terminal state candidates
    const unprocessed = resources.filter((r: any) => !processedResourceIds.has(r.id));
    const batch = mode === 'full_backlog' ? unprocessed : unprocessed.slice(0, batchSize);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    // ── Results tracking ─────────────────────────────────────

    const results = {
      total_resources: resources.length,
      total_processed: 0,
      already_operationalized: processedResourceIds.size,
      batch_size: batch.length,
      remaining: Math.max(0, unprocessed.length - batch.length),

      // Terminal state counts
      operationalized: 0,
      needs_review: 0,
      reference_only: 0,
      content_missing: 0,

      // Asset creation
      knowledge_created: 0,
      knowledge_activated: 0,
      templates_created: 0,
      examples_created: 0,

      // Quality
      duplicates_suppressed: 0,
      trust_rejected: 0,

      // Failure analysis
      failure_breakdown: {} as Record<string, number>,
      trust_failure_breakdown: {} as Record<string, number>,

      // Diagnoses for every resource
      diagnoses: [] as ResourceDiagnosis[],
    };

    for (const resource of batch) {
      const content = resource.content || '';
      const contentLen = content.length;
      const diagnosis: ResourceDiagnosis = {
        resource_id: resource.id,
        title: resource.title,
        route: '',
        terminal_state: 'needs_review',
        failure_reasons: [],
        retryable: false,
        recommended_fix: '',
        priority: 'medium',
        human_review_required: false,
        assets_created: { knowledge_items: 0, knowledge_activated: 0, templates: 0, examples: 0 },
        trust_failures: [],
      };

      try {
        // ── STEP 0: Content check ──────────────────────────────
        if (!content || contentLen < 50) {
          diagnosis.terminal_state = 'content_missing';
          diagnosis.failure_reasons.push('missing_content');
          diagnosis.recommended_fix = getRemediationPath('missing_content');
          diagnosis.priority = 'low';
          diagnosis.human_review_required = true;
          results.content_missing++;
          results.failure_breakdown['missing_content'] = (results.failure_breakdown['missing_content'] || 0) + 1;
          results.diagnoses.push(diagnosis);
          results.total_processed++;
          continue;
        }

        // ── STEP 1: Route (multi-route) ────────────────────────
        const routes = routeResource(content, resource.title);
        diagnosis.route = routes.join(', ');

        // If only reference
        if (routes.length === 1 && routes[0] === 'reference') {
          diagnosis.terminal_state = 'reference_only';
          diagnosis.failure_reasons.push('routed_reference_only');
          diagnosis.recommended_fix = getRemediationPath('routed_reference_only');
          diagnosis.priority = 'low';
          results.reference_only++;
          results.failure_breakdown['routed_reference_only'] = (results.failure_breakdown['routed_reference_only'] || 0) + 1;
          results.diagnoses.push(diagnosis);
          results.total_processed++;
          continue;
        }

        let createdSomething = false;

        // ── STEP 2a: Template route ────────────────────────────
        if (routes.includes('template')) {
          if (contentLen < 200) {
            diagnosis.failure_reasons.push('template_incomplete');
            results.failure_breakdown['template_incomplete'] = (results.failure_breakdown['template_incomplete'] || 0) + 1;
          } else if (isDuplicate(resource.title, existingTplTitles)) {
            diagnosis.failure_reasons.push('duplicate_template');
            results.duplicates_suppressed++;
            results.failure_breakdown['duplicate_template'] = (results.failure_breakdown['duplicate_template'] || 0) + 1;
          } else {
            const { error } = await supabaseAdmin.from('execution_templates').insert({
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
            if (!error) {
              diagnosis.assets_created.templates++;
              results.templates_created++;
              existingTplTitles.add(resource.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
              createdSomething = true;
            }
          }
        }

        // ── STEP 2b: Example route ─────────────────────────────
        if (routes.includes('example')) {
          if (contentLen < 150) {
            diagnosis.failure_reasons.push('example_not_strong_enough');
            results.failure_breakdown['example_not_strong_enough'] = (results.failure_breakdown['example_not_strong_enough'] || 0) + 1;
          } else if (isDuplicate(resource.title, existingExTitles)) {
            diagnosis.failure_reasons.push('duplicate_example');
            results.duplicates_suppressed++;
            results.failure_breakdown['duplicate_example'] = (results.failure_breakdown['duplicate_example'] || 0) + 1;
          } else {
            const { error } = await supabaseAdmin.from('execution_outputs').insert({
              user_id: user.id,
              title: resource.title,
              content: content.slice(0, 5000),
              output_type: 'custom',
              is_strong_example: true,
            });
            if (!error) {
              diagnosis.assets_created.examples++;
              results.examples_created++;
              existingExTitles.add(resource.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
              createdSomething = true;
            }
          }
        }

        // ── STEP 2c: Tactic extraction ─────────────────────────
        if (routes.includes('tactic') && LOVABLE_API_KEY) {
          try {
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
              diagnosis.failure_reasons.push('extraction_error');
              diagnosis.retryable = true;
              results.failure_breakdown['extraction_error'] = (results.failure_breakdown['extraction_error'] || 0) + 1;
            } else {
              const extracted = await extractRes.json();
              const items = extracted.items || [];

              if (items.length === 0) {
                diagnosis.failure_reasons.push('extraction_returned_zero');
                diagnosis.retryable = true;
                results.failure_breakdown['extraction_returned_zero'] = (results.failure_breakdown['extraction_returned_zero'] || 0) + 1;
              } else {
                // ── STEP 3 + 4: Validate + Dedup each item ────────
                const validItems = [];
                let allGeneric = true;

                for (const item of items) {
                  const validation = validateItem(item, existingKITitles);

                  // Track trust failures
                  for (const gate of validation.failedGates) {
                    const key = `trust_failed_${gate}`;
                    results.trust_failure_breakdown[gate] = (results.trust_failure_breakdown[gate] || 0) + 1;
                    if (!diagnosis.trust_failures.includes(gate)) diagnosis.trust_failures.push(gate);
                  }

                  if (validation.failedGates.includes('distinctness') && validation.mostSimilar) {
                    diagnosis.most_similar_existing = validation.mostSimilar;
                  }

                  if (validation.failedGates.includes('distinctness')) {
                    results.duplicates_suppressed++;
                    continue;
                  }

                  if (item.tactic_summary && item.tactic_summary.length >= 20) {
                    allGeneric = false;
                  }

                  // ── STEP 5: Save ───────────────────────────────────
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
                    activation_metadata: !validation.passed ? {
                      failed_gates: validation.failedGates,
                      trust_score: validation.score,
                      most_similar: validation.mostSimilar || null,
                      source_title: resource.title,
                      remediation: validation.failedGates.map((g: string) =>
                        getRemediationPath(`trust_failed_${g}` as ResourceFailureReason)
                      ),
                    } : null,
                  });

                  existingKITitles.add(item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
                  if (!validation.passed) results.trust_rejected++;
                }

                if (allGeneric && validItems.length > 0) {
                  diagnosis.failure_reasons.push('extraction_too_generic');
                  results.failure_breakdown['extraction_too_generic'] = (results.failure_breakdown['extraction_too_generic'] || 0) + 1;
                }

                if (validItems.length > 0) {
                  const { error: insertErr } = await supabaseAdmin.from('knowledge_items').insert(validItems);
                  if (!insertErr) {
                    diagnosis.assets_created.knowledge_items += validItems.length;
                    diagnosis.assets_created.knowledge_activated += validItems.filter((v: any) => v.active).length;
                    results.knowledge_created += validItems.length;
                    results.knowledge_activated += validItems.filter((v: any) => v.active).length;
                    createdSomething = true;
                  }
                }
              }
            }
          } catch {
            diagnosis.failure_reasons.push('extraction_error');
            diagnosis.retryable = true;
            results.failure_breakdown['extraction_error'] = (results.failure_breakdown['extraction_error'] || 0) + 1;
          }
        }

        // ── STEP 6: Determine terminal state ───────────────────
        if (createdSomething) {
          diagnosis.terminal_state = 'operationalized';
          results.operationalized++;
          // Set recommended fix for partial failures
          if (diagnosis.failure_reasons.length > 0) {
            diagnosis.recommended_fix = diagnosis.failure_reasons.map(r => getRemediationPath(r)).join(' | ');
          }
        } else if (diagnosis.failure_reasons.length > 0) {
          diagnosis.terminal_state = 'needs_review';
          diagnosis.recommended_fix = diagnosis.failure_reasons.map(r => getRemediationPath(r)).join(' | ');
          diagnosis.human_review_required = diagnosis.failure_reasons.some(r =>
            ['extraction_returned_zero', 'extraction_too_generic', 'template_incomplete', 'example_not_strong_enough'].includes(r)
          );
          diagnosis.retryable = diagnosis.failure_reasons.some(r =>
            ['extraction_returned_zero', 'extraction_error', 'extraction_too_generic'].includes(r)
          );
          results.needs_review++;
        } else {
          // No routes produced anything and no failures — shouldn't happen, but handle
          diagnosis.terminal_state = 'reference_only';
          diagnosis.failure_reasons.push('routed_reference_only');
          diagnosis.recommended_fix = getRemediationPath('routed_reference_only');
          results.reference_only++;
        }

        diagnosis.priority = getPriority(diagnosis.failure_reasons, contentLen);
        results.total_processed++;
        results.diagnoses.push(diagnosis);

      } catch (err) {
        diagnosis.terminal_state = 'needs_review';
        diagnosis.failure_reasons.push('extraction_error');
        diagnosis.recommended_fix = `Error: ${String(err).slice(0, 200)}. ${getRemediationPath('extraction_error')}`;
        diagnosis.retryable = true;
        diagnosis.priority = 'medium';
        results.needs_review++;
        results.total_processed++;
        results.failure_breakdown['extraction_error'] = (results.failure_breakdown['extraction_error'] || 0) + 1;
        results.diagnoses.push(diagnosis);
      }
    }

    // Sort diagnoses: needs_review first, then by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    results.diagnoses.sort((a, b) => {
      if (a.terminal_state === 'needs_review' && b.terminal_state !== 'needs_review') return -1;
      if (b.terminal_state === 'needs_review' && a.terminal_state !== 'needs_review') return 1;
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('batch-actionize error:', error);
    return new Response(JSON.stringify({ error: 'Pipeline failed', details: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
