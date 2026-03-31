import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

// ── Types ──────────────────────────────────────────────────

type ResourceFailureReason =
  | 'missing_content' | 'extraction_returned_zero' | 'extraction_too_generic'
  | 'trust_failed_specificity' | 'trust_failed_actionability' | 'trust_failed_distinctness'
  | 'trust_failed_use_case_clarity' | 'trust_failed_phrasing_quality'
  | 'duplicate_template' | 'duplicate_example' | 'duplicate_knowledge'
  | 'routed_reference_only' | 'stale_blocker_state' | 'malformed_source'
  | 'template_incomplete' | 'example_not_strong_enough' | 'tactic_not_atomic'
  | 'extraction_error';

type TerminalState =
  | 'operationalized' | 'operationalized_partial'
  | 'needs_review' | 'reference_supporting' | 'reference_needs_judgment'
  | 'reference_low_leverage' | 'content_missing';

interface AssetCounts {
  knowledge_items: number;
  knowledge_activated: number;
  templates: number;
  examples: number;
}

interface DiagnosisRow {
  resource_id: string;
  run_id: string;
  user_id: string;
  terminal_state: TerminalState;
  failure_reasons: string[];
  trust_failures: string[];
  recommended_fix: string;
  retryable: boolean;
  priority: string;
  human_review_required: boolean;
  most_similar_existing: string | null;
  assets_created: AssetCounts;
  route: string;
}

// ── Trust Validation ───────────────────────────────────────

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

function validateItem(item: any, existingTitles: Set<string>) {
  const failedGates: string[] = [];
  let score = 0;
  const summary = item.tactic_summary || item.what_to_do || '';
  const title = item.title || '';
  const when = item.when_to_use || '';
  const example = item.example_usage || item.example || '';

  const genericHits = GENERIC_PATTERNS.filter(p => p.test(summary)).length;
  const specificity = Math.max(0, 0.5 - genericHits * 0.15 + (summary.length > 40 ? 0.1 : 0));
  if (specificity < 0.35) failedGates.push('specificity');
  score += specificity * 0.2;

  const hasVerb = ACTION_VERBS.test(title) || ACTION_VERBS.test(summary);
  const actionability = (hasVerb ? 0.5 : 0.2) + (example.length > 15 ? 0.25 : 0) + (/["'"]/.test(summary) ? 0.15 : 0);
  if (actionability < 0.4) failedGates.push('actionability');
  score += Math.min(1, actionability) * 0.3;

  const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  let mostSimilar: string | undefined;
  let maxSim = 0;
  for (const existing of existingTitles) {
    const w1 = new Set(normTitle.split(' '));
    const w2 = new Set(existing.split(' '));
    let overlap = 0;
    for (const w of w1) { if (w2.has(w)) overlap++; }
    const sim = w1.size + w2.size > 0 ? (2 * overlap) / (w1.size + w2.size) : 0;
    if (sim > maxSim) { maxSim = sim; mostSimilar = existing; }
  }
  if (maxSim > 0.6) failedGates.push('distinctness');
  score += (maxSim > 0.6 ? 0.1 : 0.8) * 0.2;

  const hasWhen = when.length >= 10 && /\b(when|after|before|during|if|once)\b/i.test(when);
  if (!hasWhen) failedGates.push('use_case_clarity');
  score += (hasWhen ? 0.7 : 0.2) * 0.15;

  const aiHits = AI_FILLER.filter(p => p.test(summary)).length;
  if (aiHits > 0) failedGates.push('phrasing_quality');
  score += (aiHits === 0 ? 0.7 : 0.3) * 0.15;

  return { passed: failedGates.length === 0, score, failedGates, mostSimilar: maxSim > 0.4 ? mostSimilar : undefined };
}

// ── Routing ────────────────────────────────────────────────

function routeResource(content: string, title: string): string[] {
  const text = `${title} ${content}`;
  const routes: string[] = [];
  const tplSignals = [/subject\s*:/i, /dear\s/i, /\[.*name.*\]/i, /step\s*\d/i, /template/i, /agenda/i, /framework/i];
  const exSignals = [/follow.up|recap/i, /we discussed/i, /next steps?/i, /^(hi|hey|hello)\s/im, /looking forward/i];
  const tacSignals = [/\b(ask|say|use|try|respond|handle|frame)\b/i, /when\s+(the|a|your|they)/i, /objection/i, /discovery/i, /talk\s*track/i, /tactic/i];

  if (tplSignals.filter(p => p.test(text)).length >= 2 && content.length >= 200) routes.push('template');
  if (exSignals.filter(p => p.test(text)).length >= 2 && content.length >= 150) routes.push('example');
  if (tacSignals.filter(p => p.test(text)).length >= 2 || content.length >= 100) routes.push('tactic');
  if (routes.length === 0) routes.push('reference');
  return routes;
}

function classifyReferenceType(content: string, contentLen: number): TerminalState {
  if (contentLen < 100) return 'reference_low_leverage';
  const hasOpinionSignals = /\b(should|recommend|suggest|advise|consider)\b/i.test(content);
  if (hasOpinionSignals) return 'reference_needs_judgment';
  return 'reference_supporting';
}

// ── Dedup ──────────────────────────────────────────────────

function isDuplicate(title: string, existingTitles: Set<string>): boolean {
  const norm = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  for (const existing of existingTitles) {
    const w1 = new Set(norm.split(' '));
    const w2 = new Set(existing.split(' '));
    let overlap = 0;
    for (const w of w1) { if (w2.has(w)) overlap++; }
    if (w1.size + w2.size > 0 && (2 * overlap) / (w1.size + w2.size) > 0.7) return true;
  }
  return false;
}

// ── Remediation ────────────────────────────────────────────

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
    const mode = body.mode || 'standard';
    const resumeRunId = body.run_id || null;
    const strictMode = body.strict === true;
    const singleResourceId = body.resource_id || null; // for single-resource retry

    // Create or resume pipeline_run record
    let runId: string;
    if (resumeRunId) {
      runId = resumeRunId;
    } else {
      const { data: runRow, error: runErr } = await supabaseAdmin
        .from('pipeline_runs')
        .insert({ user_id: user.id, mode, status: 'running' })
        .select('id')
        .single();
      if (runErr || !runRow) {
        return new Response(JSON.stringify({ error: 'Failed to create pipeline run', details: String(runErr) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      runId = runRow.id;
    }

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

    // Check already-diagnosed resources in this run (for resume)
    const { data: existingDiagnoses } = await supabaseAdmin
      .from('pipeline_diagnoses')
      .select('resource_id')
      .eq('run_id', runId)
      .eq('user_id', user.id);
    const alreadyDiagnosed = new Set((existingDiagnoses || []).map((d: any) => d.resource_id));

    // Also exclude resources already resolved in prior runs
    const { data: resolvedDiags } = await supabaseAdmin
      .from('pipeline_diagnoses')
      .select('resource_id')
      .eq('user_id', user.id)
      .neq('resolution_status', 'unresolved');
    const alreadyResolved = new Set((resolvedDiags || []).map((d: any) => d.resource_id));

    // Fetch all eligible resources
    const { data: allResources } = await supabaseAdmin
      .from('resources')
      .select('id, title, content, description, tags, resource_type, content_length, enrichment_status, failure_reason, manual_input_required, content_status')
      .eq('user_id', user.id)
      .order('content_length', { ascending: false })
      .limit(500);

    const resources = allResources || [];

    // Results tracking
    const results = {
      run_id: runId,
      total_resources: resources.length,
      total_processed: 0,
      already_operationalized: processedResourceIds.size,
      remaining: 0,
      iterations_run: 0,
      converged: false,

      operationalized: 0,
      operationalized_partial: 0,
      needs_review: 0,
      reference_supporting: 0,
      reference_needs_judgment: 0,
      reference_low_leverage: 0,
      content_missing: 0,

      knowledge_created: 0,
      knowledge_activated: 0,
      templates_created: 0,
      examples_created: 0,
      duplicates_suppressed: 0,
      trust_rejected: 0,

      failure_breakdown: {} as Record<string, number>,
      trust_failure_breakdown: {} as Record<string, number>,
      diagnoses: [] as any[],
    };

    // Filter out already-processed, diagnosed, and resolved resources
    let unprocessedPool = resources.filter((r: any) =>
      !processedResourceIds.has(r.id) && !alreadyDiagnosed.has(r.id) && !alreadyResolved.has(r.id)
    );

    // Process one batch
    const batch = mode === 'full_backlog'
      ? unprocessedPool.slice(0, Math.min(unprocessedPool.length, 50))
      : unprocessedPool.slice(0, batchSize);

    const diagnosisRows: DiagnosisRow[] = [];

    for (const resource of batch) {
      const content = resource.content || '';
      const contentLen = content.length;
      const diag: DiagnosisRow = {
        resource_id: resource.id,
        run_id: runId,
        user_id: user.id,
        terminal_state: 'needs_review',
        failure_reasons: [],
        trust_failures: [],
        recommended_fix: '',
        retryable: false,
        priority: 'medium',
        human_review_required: false,
        most_similar_existing: null,
        assets_created: { knowledge_items: 0, knowledge_activated: 0, templates: 0, examples: 0 },
        route: '',
      };

      try {
        // STEP 0: Content check
        if (!content || contentLen < 50) {
          diag.terminal_state = 'content_missing';
          diag.failure_reasons = ['missing_content'];
          diag.recommended_fix = getRemediationPath('missing_content');
          diag.priority = 'low';
          diag.human_review_required = true;
          results.content_missing++;
          results.failure_breakdown['missing_content'] = (results.failure_breakdown['missing_content'] || 0) + 1;
          diagnosisRows.push(diag);
          results.diagnoses.push({ ...diag, title: resource.title });
          results.total_processed++;
          continue;
        }

        // STEP 1: Route
        const routes = routeResource(content, resource.title);
        diag.route = routes.join(', ');

        if (routes.length === 1 && routes[0] === 'reference') {
          diag.terminal_state = classifyReferenceType(content, contentLen);
          diag.failure_reasons = ['routed_reference_only'];
          diag.recommended_fix = getRemediationPath('routed_reference_only');
          diag.priority = 'low';
          const stateKey = diag.terminal_state as keyof typeof results;
          if (typeof results[stateKey] === 'number') (results as any)[stateKey]++;
          results.failure_breakdown['routed_reference_only'] = (results.failure_breakdown['routed_reference_only'] || 0) + 1;
          diagnosisRows.push(diag);
          results.diagnoses.push({ ...diag, title: resource.title });
          results.total_processed++;
          continue;
        }

        let createdSomething = false;
        const failureReasons: ResourceFailureReason[] = [];
        const trustFailures: string[] = [];
        let mostSimilar: string | null = null;

        // STEP 2a: Template route
        if (routes.includes('template')) {
          if (contentLen < 200) {
            failureReasons.push('template_incomplete');
            results.failure_breakdown['template_incomplete'] = (results.failure_breakdown['template_incomplete'] || 0) + 1;
          } else if (isDuplicate(resource.title, existingTplTitles)) {
            failureReasons.push('duplicate_template');
            results.duplicates_suppressed++;
            results.failure_breakdown['duplicate_template'] = (results.failure_breakdown['duplicate_template'] || 0) + 1;
          } else {
            const { error } = await supabaseAdmin.from('execution_templates').insert({
              user_id: user.id, title: resource.title, body: content.slice(0, 5000),
              template_type: 'email', output_type: 'custom', source_resource_id: resource.id,
              tags: resource.tags || [], template_origin: 'promoted_from_resource',
              status: 'active', created_by_user: false, confidence_score: 0.7,
            });
            if (!error) {
              diag.assets_created.templates++;
              results.templates_created++;
              existingTplTitles.add(resource.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
              createdSomething = true;
            }
          }
        }

        // STEP 2b: Example route
        if (routes.includes('example')) {
          if (contentLen < 150) {
            failureReasons.push('example_not_strong_enough');
            results.failure_breakdown['example_not_strong_enough'] = (results.failure_breakdown['example_not_strong_enough'] || 0) + 1;
          } else if (isDuplicate(resource.title, existingExTitles)) {
            failureReasons.push('duplicate_example');
            results.duplicates_suppressed++;
            results.failure_breakdown['duplicate_example'] = (results.failure_breakdown['duplicate_example'] || 0) + 1;
          } else {
            const { error } = await supabaseAdmin.from('execution_outputs').insert({
              user_id: user.id, title: resource.title, content: content.slice(0, 5000),
              output_type: 'custom', is_strong_example: true,
            });
            if (!error) {
              diag.assets_created.examples++;
              results.examples_created++;
              existingExTitles.add(resource.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
              createdSomething = true;
            }
          }
        }

        // STEP 2c: Tactic extraction
        if (routes.includes('tactic')) {
          try {
            const extractRes = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-tactics`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
                body: JSON.stringify({
                  title: resource.title, content: content.slice(0, 12000),
                  description: resource.description, tags: resource.tags,
                  resourceType: resource.resource_type,
                }),
              }
            );

            if (!extractRes.ok) {
              failureReasons.push('extraction_error');
              diag.retryable = true;
              results.failure_breakdown['extraction_error'] = (results.failure_breakdown['extraction_error'] || 0) + 1;
            } else {
              const extracted = await extractRes.json();
              const items = extracted.items || [];

              if (items.length === 0) {
                failureReasons.push('extraction_returned_zero');
                diag.retryable = true;
                results.failure_breakdown['extraction_returned_zero'] = (results.failure_breakdown['extraction_returned_zero'] || 0) + 1;
              } else {
                const validItems = [];
                let allGeneric = true;

                for (const item of items) {
                  const validation = validateItem(item, existingKITitles);
                  for (const gate of validation.failedGates) {
                    results.trust_failure_breakdown[gate] = (results.trust_failure_breakdown[gate] || 0) + 1;
                    if (!trustFailures.includes(gate)) trustFailures.push(gate);
                  }
                  if (validation.failedGates.includes('distinctness') && validation.mostSimilar) {
                    mostSimilar = validation.mostSimilar;
                  }
                  if (validation.failedGates.includes('distinctness')) {
                    results.duplicates_suppressed++;
                    continue;
                  }
                  if (item.tactic_summary && item.tactic_summary.length >= 20) allGeneric = false;

                  validItems.push({
                    user_id: user.id, source_resource_id: resource.id, title: item.title,
                    knowledge_type: item.knowledge_type || 'skill', chapter: item.chapter || 'messaging',
                    sub_chapter: item.sub_chapter || null,
                    tactic_summary: item.tactic_summary || item.what_to_do,
                    when_to_use: item.when_to_use, when_not_to_use: item.when_not_to_use || null,
                    example_usage: item.example_usage || item.example || null,
                    why_it_matters: item.why_it_matters || null,
                    confidence_score: validation.score,
                    status: validation.passed ? 'active' : 'extracted',
                    active: validation.passed, user_edited: false,
                    applies_to_contexts: ['dave', 'roleplay', 'prep', 'playbooks'],
                    tags: [...(resource.tags || []), item.knowledge_type || 'skill', item.chapter || 'messaging'],
                    activation_metadata: !validation.passed ? {
                      failed_gates: validation.failedGates, trust_score: validation.score,
                      most_similar: validation.mostSimilar || null, source_title: resource.title,
                      remediation: validation.failedGates.map((g: string) =>
                        getRemediationPath(`trust_failed_${g}` as ResourceFailureReason)
                      ),
                    } : null,
                  });
                  existingKITitles.add(item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
                  if (!validation.passed) results.trust_rejected++;
                }

                if (allGeneric && validItems.length > 0) {
                  failureReasons.push('extraction_too_generic');
                  results.failure_breakdown['extraction_too_generic'] = (results.failure_breakdown['extraction_too_generic'] || 0) + 1;
                }

                if (validItems.length > 0) {
                  const { error: insertErr } = await supabaseAdmin.from('knowledge_items').insert(validItems);
                  if (!insertErr) {
                    diag.assets_created.knowledge_items += validItems.length;
                    diag.assets_created.knowledge_activated += validItems.filter((v: any) => v.active).length;
                    results.knowledge_created += validItems.length;
                    results.knowledge_activated += validItems.filter((v: any) => v.active).length;
                    createdSomething = true;
                  }
                }
              }
            }
          } catch {
            failureReasons.push('extraction_error');
            diag.retryable = true;
            results.failure_breakdown['extraction_error'] = (results.failure_breakdown['extraction_error'] || 0) + 1;
          }
        }

        // STEP 6: Terminal state
        diag.failure_reasons = failureReasons;
        diag.trust_failures = trustFailures;
        diag.most_similar_existing = mostSimilar;

        if (createdSomething && failureReasons.length === 0) {
          diag.terminal_state = 'operationalized';
          results.operationalized++;
        } else if (createdSomething && failureReasons.length > 0) {
          diag.terminal_state = 'operationalized_partial';
          results.operationalized_partial++;
        } else if (failureReasons.length > 0) {
          diag.terminal_state = 'needs_review';
          diag.human_review_required = failureReasons.some(r =>
            ['extraction_returned_zero', 'extraction_too_generic', 'template_incomplete', 'example_not_strong_enough'].includes(r)
          );
          diag.retryable = failureReasons.some(r =>
            ['extraction_returned_zero', 'extraction_error', 'extraction_too_generic'].includes(r)
          );
          results.needs_review++;
        } else {
          diag.terminal_state = classifyReferenceType(content, contentLen);
          diag.failure_reasons = ['routed_reference_only'];
          const stateKey = diag.terminal_state as keyof typeof results;
          if (typeof results[stateKey] === 'number') (results as any)[stateKey]++;
        }

        diag.recommended_fix = failureReasons.length > 0
          ? failureReasons.map(r => getRemediationPath(r)).join(' | ')
          : '';
        diag.priority = getPriority(failureReasons, contentLen);

        for (const r of failureReasons) {
          results.failure_breakdown[r] = (results.failure_breakdown[r] || 0) + 1;
        }

        diagnosisRows.push(diag);
        results.diagnoses.push({ ...diag, title: resource.title });
        results.total_processed++;

      } catch (err) {
        diag.terminal_state = 'needs_review';
        diag.failure_reasons = ['extraction_error'];
        diag.recommended_fix = `Error: ${String(err).slice(0, 200)}. ${getRemediationPath('extraction_error')}`;
        diag.retryable = true;
        diag.priority = 'medium';
        results.needs_review++;
        results.total_processed++;
        results.failure_breakdown['extraction_error'] = (results.failure_breakdown['extraction_error'] || 0) + 1;
        diagnosisRows.push(diag);
        results.diagnoses.push({ ...diag, title: resource.title });
      }
    }

    // Persist diagnoses batch
    if (diagnosisRows.length > 0) {
      await supabaseAdmin.from('pipeline_diagnoses').upsert(diagnosisRows, {
        onConflict: 'resource_id,run_id',
      });
    }

    // Calculate remaining
    const processedIds = new Set(batch.map((r: any) => r.id));
    const remainingPool = unprocessedPool.filter((r: any) => !processedIds.has(r.id));
    results.remaining = remainingPool.length;
    results.converged = remainingPool.length === 0;
    results.iterations_run = 1;

    // Update pipeline_run record
    await supabaseAdmin.from('pipeline_runs').update({
      total_resources: resources.length,
      total_processed: results.total_processed,
      converged: results.converged,
      iterations_run: results.iterations_run,
      status: results.converged ? 'completed' : 'running',
      completed_at: results.converged ? new Date().toISOString() : null,
      summary_json: {
        operationalized: results.operationalized,
        operationalized_partial: results.operationalized_partial,
        needs_review: results.needs_review,
        reference_supporting: results.reference_supporting,
        reference_needs_judgment: results.reference_needs_judgment,
        reference_low_leverage: results.reference_low_leverage,
        content_missing: results.content_missing,
        knowledge_created: results.knowledge_created,
        templates_created: results.templates_created,
        examples_created: results.examples_created,
        duplicates_suppressed: results.duplicates_suppressed,
        trust_rejected: results.trust_rejected,
      },
    }).eq('id', runId);

    // Sort diagnoses: needs_review first, then by priority
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    results.diagnoses.sort((a: any, b: any) => {
      if (a.terminal_state === 'needs_review' && b.terminal_state !== 'needs_review') return -1;
      if (b.terminal_state === 'needs_review' && a.terminal_state !== 'needs_review') return 1;
      return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
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
