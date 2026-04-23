import { createClient } from "npm:@supabase/supabase-js@2";
import { logServiceRoleUsage, logCrossUserAccess, logValidationWarnings, logAuthMethod } from '../_shared/securityLog.ts';
import { logEnforcementEvent } from '../_shared/enforcementLog.ts';

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

// ── Multi-Slice Content Similarity (content-first) ─────────

function normalizeSlice(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalizeSlice(text).split(' ').filter((w: string) => w.length > 2));
}

function diceCoeff(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) { if (b.has(w)) inter++; }
  return (2 * inter) / (a.size + b.size);
}

function getSlices(content: string): { opening: string; middle: string; closing: string } {
  const len = content.length;
  const sl = Math.min(300, Math.floor(len / 3));
  return {
    opening: content.slice(0, sl),
    middle: content.slice(Math.floor(len / 2) - Math.floor(sl / 2), Math.floor(len / 2) + Math.floor(sl / 2)),
    closing: content.slice(Math.max(0, len - sl)),
  };
}

const STRUCT_MARKERS = [/\[.*?\]/g, /\{.*?\}/g, /^[-•*]\s+/gm, /^\d+\.\s+/gm, /^#{1,3}\s+/gm, /subject\s*:/gi, /agenda\s*:/gi, /step\s*\d/gi];

function structSim(a: string, b: string): number {
  const extract = (t: string) => {
    const m: string[] = [];
    for (const p of STRUCT_MARKERS) { const r = t.match(p); if (r) m.push(...r.map(x => x.toLowerCase().trim())); }
    return new Set(m);
  };
  const sa = extract(a), sb = extract(b);
  if (sa.size === 0 && sb.size === 0) return 0.5;
  if (sa.size === 0 || sb.size === 0) return 0.2;
  return diceCoeff(sa, sb);
}

function contentSimilarity(a: string | null, b: string | null): number {
  if (!a || !b || a.length < 20 || b.length < 20) return 0;
  const sa = getSlices(a), sb = getSlices(b);
  return diceCoeff(tokenize(sa.opening), tokenize(sb.opening)) * 0.35
    + diceCoeff(tokenize(sa.middle), tokenize(sb.middle)) * 0.25
    + diceCoeff(tokenize(sa.closing), tokenize(sb.closing)) * 0.25
    + structSim(a, b) * 0.15;
}

function isContentDuplicate(newContent: string, existingContents: string[], threshold = 0.65): { dup: boolean; similar?: string } {
  let maxSim = 0;
  let best: string | undefined;
  for (const existing of existingContents) {
    const sim = contentSimilarity(newContent, existing);
    if (sim > maxSim) { maxSim = sim; best = existing; }
  }
  return { dup: maxSim > threshold, similar: maxSim > 0.4 ? best?.slice(0, 100) : undefined };
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

function validateItem(item: any, existingContents: string[]) {
  const failedGates: string[] = [];
  let score = 0;
  const summary = item.tactic_summary || item.what_to_do || '';
  const title = item.title || '';
  const when = item.when_to_use || '';
  const example = item.example_usage || item.example || '';

  // Gate 1: Specificity (content-based)
  const genericHits = GENERIC_PATTERNS.filter(p => p.test(summary)).length;
  const specificity = Math.max(0, 0.5 - genericHits * 0.15 + (summary.length > 40 ? 0.1 : 0));
  if (specificity < 0.35) failedGates.push('specificity');
  score += specificity * 0.2;

  // Gate 2: Actionability (content-based)
  const hasVerb = ACTION_VERBS.test(summary);
  const actionability = (hasVerb ? 0.5 : 0.2) + (example.length > 15 ? 0.25 : 0) + (/["'"]/.test(summary) ? 0.15 : 0);
  if (actionability < 0.4) failedGates.push('actionability');
  score += Math.min(1, actionability) * 0.3;

  // Gate 3: Distinctness — CONTENT-FIRST (not title)
  const itemContent = `${summary} ${when} ${example}`;
  const { dup, similar } = isContentDuplicate(itemContent, existingContents);
  if (dup) failedGates.push('distinctness');
  score += (dup ? 0.1 : 0.8) * 0.2;

  // Gate 4: Use-case clarity
  const hasWhen = when.length >= 10 && /\b(when|after|before|during|if|once)\b/i.test(when);
  if (!hasWhen) failedGates.push('use_case_clarity');
  score += (hasWhen ? 0.7 : 0.2) * 0.15;

  // Gate 5: Phrasing quality
  const aiHits = AI_FILLER.filter(p => p.test(summary)).length;
  if (aiHits > 0) failedGates.push('phrasing_quality');
  score += (aiHits === 0 ? 0.7 : 0.3) * 0.15;

  return { passed: failedGates.length === 0, score, failedGates, mostSimilar: similar };
}

// ── Content-Based Routing ──────────────────────────────────

const TPL_STRUCTURE = [
  /\[.*?(name|company|title|role|date|amount|product).*?\]/i,
  /\{.*?(name|company|title|role|date|amount|product).*?\}/i,
  /step\s*\d|phase\s*\d|part\s*\d/i,
  /^[-•*]\s+/m,
  /subject\s*:/i,
  /agenda\s*:/i,
  /\d+\.\s+[A-Z]/m,
];
const EX_STRUCTURE = [
  /^(hi|hey|hello|dear|good morning|good afternoon)\s/im,
  /we (discussed|talked|agreed|reviewed|covered)/i,
  /thank you for|thanks for|appreciate your/i,
  /I (wanted|wanted to|am writing|am reaching|am following)/i,
  /best regards|sincerely|cheers|thanks,?\s*$/im,
  /next steps?\s*:/i,
];
const TAC_STRUCTURE = [
  /\bwhen\s+(the|a|your|they|you|it)\b/i,
  /\binstead of\b.*\btry\b/i,
  /\b(respond|handle|counter|address)\s+(by|with|using)\b/i,
  /\bif\s+(they|the prospect|the buyer|your)\b/i,
  /\b(technique|approach|method)\s*:/i,
  /["'""].{10,}["'""]$/m,
];

const DESCRIPTIVE_SIGNALS = [
  /\b(overview|introduction|background|context|summary)\b/i,
  /\b(in general|generally speaking|typically|usually|often)\b/i,
  /\b(various|several|many|numerous) (ways|methods|approaches)\b/i,
  /\b(history|evolution|landscape|ecosystem|industry)\b/i,
  /\b(according to|research shows|studies indicate)\b/i,
];

function routeResource(content: string): string[] {
  if (!content || content.length < 50) return ['reference'];
  const routes: string[] = [];
  if (TPL_STRUCTURE.filter(p => p.test(content)).length >= 2 && content.length >= 200) routes.push('template');
  if (EX_STRUCTURE.filter(p => p.test(content)).length >= 2 && content.length >= 150) routes.push('example');
  // Hardened tactic routing: require stronger evidence, penalize descriptive content
  const tacHits = TAC_STRUCTURE.filter(p => p.test(content)).length;
  const descHits = DESCRIPTIVE_SIGNALS.filter(p => p.test(content)).length;
  if (tacHits >= 2 && descHits < tacHits) routes.push('tactic');
  else if (tacHits >= 3 && content.length >= 200) routes.push('tactic');
  if (routes.length === 0) routes.push('reference');
  return routes;
}

// ── Content Transformation ─────────────────────────────────

function shapeAsTemplate(content: string): string {
  let s = content;
  s = s.replace(/\{(\w+)\}/g, (_, n: string) => `[${n.charAt(0).toUpperCase() + n.slice(1)}]`);
  s = s.replace(/^(note|comment|explanation|context|background|tip|reminder)\s*:.*$/gim, '');
  s = s.replace(/^\/\/.*$/gm, '');
  s = s.replace(/^\(.*?\)\s*$/gm, '');
  s = s.replace(/^(template|email template|draft|version \d+)\s*:?\s*$/gim, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function shapeAsExample(content: string): string {
  let s = content;
  s = s.replace(/^(note|comment|internal|draft note|meta|context)\s*:.*$/gim, '');
  s = s.replace(/^\/\/.*$/gm, '');
  s = s.replace(/^\[?(internal|draft|wip|todo)\]?\s*$/gim, '');
  s = s.replace(/^(version|v\d+|last updated|status)\s*:.*$/gim, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function classifyReferenceType(content: string, contentLen: number): TerminalState {
  if (contentLen < 100) return 'reference_low_leverage';
  if (/\b(should|recommend|suggest|advise|consider)\b/i.test(content)) return 'reference_needs_judgment';
  return 'reference_supporting';
}

// ── Segment-Level Routing ──────────────────────────────────

interface ContentSegmentEF {
  index: number;
  content: string;
  heading?: string;
  charRange: [number, number];
}

function segmentContent(content: string): ContentSegmentEF[] {
  if (!content || content.length < 200) {
    return [{ index: 0, content, charRange: [0, content?.length || 0] }];
  }
  const headingPattern = /^(#{1,3})\s+(.+)$/gm;
  const headings: Array<{ title: string; pos: number }> = [];
  let m;
  while ((m = headingPattern.exec(content)) !== null) {
    headings.push({ title: m[2], pos: m.index });
  }
  if (headings.length < 2) {
    return [{ index: 0, content, charRange: [0, content.length] }];
  }
  const segs: ContentSegmentEF[] = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].pos;
    const end = i + 1 < headings.length ? headings[i + 1].pos : content.length;
    const segContent = content.slice(start, end).trim();
    if (segContent.length >= 50) {
      segs.push({ index: segs.length, content: segContent, heading: headings[i].title, charRange: [start, end] });
    }
  }
  if (headings[0].pos > 80) {
    const pre = content.slice(0, headings[0].pos).trim();
    if (pre.length >= 50) segs.unshift({ index: -1, content: pre, charRange: [0, headings[0].pos] });
  }
  // Re-index
  segs.forEach((s, i) => s.index = i);
  return segs.length > 0 ? segs : [{ index: 0, content, charRange: [0, content.length] }];
}


function getRemediationPath(reason: ResourceFailureReason): string {
  const paths: Record<ResourceFailureReason, string> = {
    missing_content: 'Re-enrich this resource, manually paste content, or upload a better source file.',
    extraction_returned_zero: 'Retry with LLM extraction, chunk the source differently, or expand context window.',
    extraction_too_generic: 'Re-extract with stricter prompt forcing exact phrasing and specific actions only.',
    trust_failed_specificity: 'Rewrite the summary to include specific names, numbers, or concrete details.',
    trust_failed_actionability: 'Convert the principle into an action: add "what to do" + "when to use" + example phrasing.',
    trust_failed_distinctness: 'Merge into the similar existing item, discard, or keep with differentiated content.',
    trust_failed_use_case_clarity: 'Add a specific trigger: "When [situation], use this to [outcome]."',
    trust_failed_phrasing_quality: 'Rewrite in natural rep language — remove corporate jargon and AI filler words.',
    duplicate_template: 'Content matches an existing template. Link to the existing one or differentiate the content.',
    duplicate_example: 'Content matches an existing example. Link to the existing one or archive this copy.',
    duplicate_knowledge: 'Content already captured. Merge additional insights or discard.',
    routed_reference_only: 'Low direct leverage — keep as background reference material or attempt manual promotion.',
    stale_blocker_state: 'Resource is stuck in a prior pipeline stage. Re-run enrichment or resolve the blocker.',
    malformed_source: 'Source content is corrupted or unreadable. Re-upload or paste clean content manually.',
    template_incomplete: 'Template lacks required structure (placeholders, steps, sections). Complete the missing sections.',
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
    console.log('batch-actionize: request received', req.method);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    );
    logServiceRoleUsage('batch-actionize', 'single_user', { reason: 'pipeline_operations' });

    // Parse body early so we can check for user_id
    const bodyText = await req.text();
    const body = JSON.parse(bodyText);
    logValidationWarnings('batch-actionize', body, ['user_id']);

    const isProtectedMode = body.mode === 'protected';
    let supabaseUserScoped: ReturnType<typeof createClient> | null = null;

    // ── Protected Path Enforcement (Phase 3, Slice 3) ──────────
    if (isProtectedMode) {
      logEnforcementEvent('batch-actionize', 'fn:protected_path_used', {
        hasAuth: !!authHeader,
        hasUserId: !!body.user_id,
        hasBatchKey: !!req.headers.get('x-batch-key'),
        resourceCount: Array.isArray(body.resourceIds) ? body.resourceIds.length : (body.resource_id ? 1 : 0),
      });

      // 1. Auth: require JWT — reject x-batch-key-only
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: claimsData, error: claimsErr } = await supabaseUser.auth.getClaims(authHeader.replace('Bearer ', ''));
      const callerUserId = claimsData?.claims?.sub as string | undefined;

      if (claimsErr || !callerUserId) {
        logEnforcementEvent('batch-actionize', 'fn:request_rejected_protected_path', {
          reason: 'auth_required', hasAuth: !!authHeader,
        });
        return new Response(JSON.stringify({ error: 'Protected path requires authenticated user' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      logEnforcementEvent('batch-actionize', 'fn:auth_enforced', { callerPresent: true });

      // 2. Shape: require user_id
      if (!body.user_id) {
        logEnforcementEvent('batch-actionize', 'fn:request_rejected_protected_path', {
          reason: 'missing_user_id',
        });
        return new Response(JSON.stringify({ error: 'Protected path requires user_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 3. Scope: callerUserId must match body.user_id
      if (callerUserId !== body.user_id) {
        logEnforcementEvent('batch-actionize', 'fn:cross_user_detected', {
          callerPresent: true, targetPresent: true, match: false,
        });
        logEnforcementEvent('batch-actionize', 'fn:request_rejected_protected_path', {
          reason: 'user_scope_mismatch',
        });
        return new Response(JSON.stringify({ error: 'User scope mismatch' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      logEnforcementEvent('batch-actionize', 'fn:scope_enforced', {
        callerPresent: true, targetPresent: true, match: true,
      });

      // Phase D, Slice 6: Hoist user-scoped client for selective reads
      supabaseUserScoped = supabaseUser;
    }

    // ── Legacy Path Telemetry ──────────────────────────────────
    if (!isProtectedMode) {
      logEnforcementEvent('batch-actionize', 'fn:legacy_path_used', {
        mode: body.mode || 'standard',
        hasAuth: !!authHeader,
        hasBatchKey: !!req.headers.get('x-batch-key'),
      });
    }

    let userId: string;

    // Check for service-role invocation via x-batch-key header
    const batchKey = req.headers.get('x-batch-key');
    const isServiceRole = batchKey != null && batchKey === serviceRoleKey;

    if (isProtectedMode) {
      // Protected mode: userId already validated above via JWT scope guard
      userId = body.user_id;
    } else if (isServiceRole && body.user_id) {
      // Service-role caller — trust body.user_id directly
      logAuthMethod('batch-actionize', 'x-batch-key', { bodyUserId: !!body.user_id });
      console.log('batch-actionize: service-role auth via x-batch-key, user_id:', body.user_id);
      userId = body.user_id;
    } else {
      // Try JWT auth
      logAuthMethod('batch-actionize', 'jwt');
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
      console.log('batch-actionize: auth result', user?.id || 'no user', authErr?.message || 'no error', 'body.user_id:', body.user_id);
      
      if (user) {
        userId = user.id;
      } else if (body.user_id) {
        // Fallback: validate user exists via admin client
        const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(body.user_id);
        if (!targetUser?.user) {
          return new Response(JSON.stringify({ error: 'Invalid user_id' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        userId = body.user_id;
      } else {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const batchSize = Math.min(body.batchSize || 15, 50);
    const mode = body.mode || 'standard';
    const resumeRunId = body.run_id || null;
    const strictMode = body.strict === true;
    const singleResourceId = body.resource_id || null;

    // Create or resume pipeline_run record
    let runId: string;
    if (resumeRunId) {
      runId = resumeRunId;
    } else {
      const { data: runRow, error: runErr } = await supabaseAdmin
        .from('pipeline_runs')
        .insert({ user_id: userId, mode, status: 'running' })
        .select('id')
        .single();
      if (runErr || !runRow) {
        return new Response(JSON.stringify({ error: 'Failed to create pipeline run', details: String(runErr) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      runId = runRow.id;
    }

    // Fetch all existing assets for CONTENT-BASED dedup
    // Phase D, Slice 7: Use user-scoped client on protected path for dedup reads
    const dedupClient = (isProtectedMode && supabaseUserScoped) ? supabaseUserScoped : supabaseAdmin;
    if (isProtectedMode && supabaseUserScoped) {
      logEnforcementEvent('batch-actionize', 'fn:service_role_reduced_path' as any, {
        operation: 'dedup_pool_fetch',
        reason: 'protected_path_user_scoped',
        path: 'protected',
      });
    } else {
      logEnforcementEvent('batch-actionize', 'fn:service_role_retained' as any, {
        operation: 'dedup_pool_fetch',
        reason: isProtectedMode ? 'no_user_scoped_client' : 'legacy_or_batch_path',
        path: isProtectedMode ? 'protected' : (body.mode || 'standard'),
      });
    }
    const [existingKI, existingTpl, existingEx] = await Promise.all([
      dedupClient.from('knowledge_items').select('id, source_resource_id, title, tactic_summary, when_to_use, example_usage').eq('user_id', userId),
      dedupClient.from('execution_templates').select('id, title, body').eq('user_id', userId),
      dedupClient.from('execution_outputs').select('id, title, content').eq('user_id', userId).eq('is_strong_example', true),
    ]);

    const processedResourceIds = new Set(
      (existingKI.data || []).map((k: any) => k.source_resource_id).filter(Boolean)
    );

    // Content pools for dedup (content-first, not title)
    const existingKIContents = (existingKI.data || []).map((k: any) =>
      `${k.tactic_summary || ''} ${k.when_to_use || ''} ${k.example_usage || ''}`
    ).filter((c: string) => c.trim().length > 10);

    const existingTplContents = (existingTpl.data || []).map((t: any) => t.body || '').filter((c: string) => c.length > 10);
    const existingExContents = (existingEx.data || []).map((e: any) => e.content || '').filter((c: string) => c.length > 10);

    // Check already-diagnosed resources
    const { data: existingDiagnoses } = await supabaseAdmin
      .from('pipeline_diagnoses')
      .select('resource_id')
      .eq('run_id', runId)
      .eq('user_id', userId);
    const alreadyDiagnosed = new Set((existingDiagnoses || []).map((d: any) => d.resource_id));

    const { data: resolvedDiags } = await supabaseAdmin
      .from('pipeline_diagnoses')
      .select('resource_id')
      .eq('user_id', userId)
      .neq('resolution_status', 'unresolved');
    const alreadyResolved = new Set((resolvedDiags || []).map((d: any) => d.resource_id));

    // Fetch all eligible resources
    // Phase D, Slice 6: Use user-scoped client on protected path
    const resourceClient = (isProtectedMode && supabaseUserScoped) ? supabaseUserScoped : supabaseAdmin;
    if (isProtectedMode && supabaseUserScoped) {
      logEnforcementEvent('batch-actionize', 'fn:service_role_reduced_path' as any, {
        operation: 'resource_list_fetch',
        reason: 'protected_path_user_scoped',
        path: 'protected',
      });
    } else {
      logEnforcementEvent('batch-actionize', 'fn:service_role_retained' as any, {
        operation: 'resource_list_fetch',
        reason: isProtectedMode ? 'no_user_scoped_client' : 'legacy_or_batch_path',
        path: isProtectedMode ? 'protected' : (body.mode || 'standard'),
      });
    }
    const { data: allResources } = await resourceClient
      .from('resources')
      .select('id, title, content, description, tags, resource_type, content_length, enrichment_status, failure_reason, manual_input_required, content_status')
      .eq('user_id', userId)
      .order('content_length', { ascending: false })
      .limit(500);

    const resources = allResources || [];

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

    let unprocessedPool: any[];
    if (singleResourceId) {
      await supabaseAdmin.from('pipeline_diagnoses')
        .delete()
        .eq('resource_id', singleResourceId)
        .eq('user_id', userId);
      unprocessedPool = resources.filter((r: any) => r.id === singleResourceId);
    } else {
      unprocessedPool = resources.filter((r: any) =>
        !processedResourceIds.has(r.id) && !alreadyDiagnosed.has(r.id) && !alreadyResolved.has(r.id)
      );
    }

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
        user_id: userId,
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
        // STEP 0: Content check — length + quality validation
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

        // STEP 0b: Reject HTML/CSS/bot content
        const htmlPattern = /<(div|meta|style|script|span|link|head|body|html|nav|footer|header|iframe)\b/i;
        const cssPattern = /(::after|::before|font-family:|display:\s*(?:flex|block|grid|none)|@media\s|{color:|background-color:)/i;
        const botPattern = /(recaptcha|captcha|install.app|sign.in.to|cookie.consent|create.an.account|subscribe.to.continue|verify.you.are.human|access.denied|403.forbidden)/i;
        const htmlTagCount = (content.match(/<[a-z][^>]*>/gi) || []).length;

        if (htmlTagCount > 5 || cssPattern.test(content) || botPattern.test(content)) {
          const failReason = htmlTagCount > 5 ? 'content_invalid_html'
            : cssPattern.test(content) ? 'content_invalid_css'
            : 'content_bot_or_login_wall';
          diag.terminal_state = 'content_missing';
          diag.failure_reasons = [failReason];
          diag.recommended_fix = 'Content appears to be scraped HTML/CSS or a login wall, not readable text. Re-enrich from the original source or provide a clean transcript.';
          diag.priority = 'low';
          diag.retryable = false;
          diag.human_review_required = true;
          results.content_missing++;
          results.failure_breakdown[failReason] = (results.failure_breakdown[failReason] || 0) + 1;
          diagnosisRows.push(diag);
          results.diagnoses.push({ ...diag, title: resource.title });
          results.total_processed++;
          continue;
        }

        // STEP 1: Segment-level routing — split document into chunks,
        // route each independently, then aggregate routes
        const segments = segmentContent(content);
        const aggregatedRoutes = new Set<string>();
        const segmentProvenance: Array<{ index: number; route: string; charRange: [number, number]; heading?: string; content: string }> = [];
        
        for (const seg of segments) {
          const segRoutes = routeResource(seg.content);
          for (const r of segRoutes) aggregatedRoutes.add(r);
          segmentProvenance.push({
            index: seg.index,
            route: segRoutes[0],
            charRange: seg.charRange,
            heading: seg.heading,
            content: seg.content,
          });
        }
        
        // Use aggregated routes (union of all segment routes)
        const routes = Array.from(aggregatedRoutes);
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
          results.diagnoses.push({ ...diag, title: resource.title, segment_provenance: segmentProvenance });
          results.total_processed++;
          continue;
        }

        let createdSomething = false;
        const failureReasons: ResourceFailureReason[] = [];
        const trustFailures: string[] = [];
        let mostSimilar: string | null = null;

        // STEP 2a: Template route — CONTENT-BASED dedup
        // Find the best template segment for provenance
        const tplSegment = segmentProvenance.find(s => s.route === 'template') || segmentProvenance[0];
        if (routes.includes('template')) {
          if (contentLen < 200) {
            failureReasons.push('template_incomplete');
            results.failure_breakdown['template_incomplete'] = (results.failure_breakdown['template_incomplete'] || 0) + 1;
          } else {
            const { dup, similar } = isContentDuplicate(content, existingTplContents);
            if (dup) {
              failureReasons.push('duplicate_template');
              results.duplicates_suppressed++;
              results.failure_breakdown['duplicate_template'] = (results.failure_breakdown['duplicate_template'] || 0) + 1;
              if (similar) mostSimilar = similar;
            } else {
              const shapedBody = shapeAsTemplate(content);
              const { data: tplData, error } = await supabaseAdmin.from('execution_templates').insert({
                user_id: userId, title: resource.title, body: shapedBody,
                template_type: 'email', output_type: 'custom', source_resource_id: resource.id,
                tags: resource.tags || [], template_origin: 'promoted_from_resource',
                status: 'active', created_by_user: false, confidence_score: 0.7,
              }).select('id').single();
              if (!error) {
                diag.assets_created.templates++;
                results.templates_created++;
                existingTplContents.push(content.slice(0, 500));
                createdSomething = true;
                // Persist provenance
                if (tplData) {
                  await supabaseAdmin.from('asset_provenance').insert({
                    user_id: userId,
                    asset_type: 'template',
                    asset_id: tplData.id,
                    source_resource_id: resource.id,
                    source_segment_index: tplSegment.index,
                    source_char_range: tplSegment.charRange,
                    source_heading: tplSegment.heading || null,
                    original_content: tplSegment.content,
                    transformed_content: shapedBody,
                  });
                }
              }
            }
          }
        }

        // STEP 2b: Example route — CONTENT-BASED dedup
        const exSegment = segmentProvenance.find(s => s.route === 'example') || segmentProvenance[0];
        if (routes.includes('example')) {
          if (contentLen < 150) {
            failureReasons.push('example_not_strong_enough');
            results.failure_breakdown['example_not_strong_enough'] = (results.failure_breakdown['example_not_strong_enough'] || 0) + 1;
          } else {
            const { dup, similar } = isContentDuplicate(content, existingExContents);
            if (dup) {
              failureReasons.push('duplicate_example');
              results.duplicates_suppressed++;
              results.failure_breakdown['duplicate_example'] = (results.failure_breakdown['duplicate_example'] || 0) + 1;
              if (similar) mostSimilar = similar;
            } else {
              const shapedContent = shapeAsExample(content);
              const { data: exData, error } = await supabaseAdmin.from('execution_outputs').insert({
                user_id: userId, title: resource.title, content: shapedContent,
                output_type: 'custom', is_strong_example: true,
              }).select('id').single();
              if (!error) {
                diag.assets_created.examples++;
                results.examples_created++;
                existingExContents.push(content.slice(0, 500));
                createdSomething = true;
                // Persist provenance
                if (exData) {
                  await supabaseAdmin.from('asset_provenance').insert({
                    user_id: userId,
                    asset_type: 'example',
                    asset_id: exData.id,
                    source_resource_id: resource.id,
                    source_segment_index: exSegment.index,
                    source_char_range: exSegment.charRange,
                    source_heading: exSegment.heading || null,
                    original_content: exSegment.content,
                    transformed_content: shapedContent,
                  });
                }
              }
            }
          }
        }

        // STEP 2c: Tactic extraction
        if (routes.includes('tactic')) {
          try {
            const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

            // ── Slice 4: Controlled downstream propagation ─────────
            // Safe condition: protected mode + single-resource execution only
            const shouldPropagate = isProtectedMode && !!singleResourceId;

            if (shouldPropagate) {
              logEnforcementEvent('batch-actionize', 'fn:downstream_protected_call' as any, {
                target: 'extract-tactics',
                reason: 'single_resource_protected_rerun',
                resourceCount: 1,
              });
            } else if (isProtectedMode) {
              // Protected parent but propagation skipped (multi-resource or batch)
              logEnforcementEvent('batch-actionize', 'fn:downstream_propagation_skipped' as any, {
                target: 'extract-tactics',
                reason: singleResourceId ? 'unknown' : 'multi_resource_batch',
                resourceCount: resourceQueue.length,
              });
            } else {
              logEnforcementEvent('batch-actionize', 'fn:downstream_legacy_call' as any, {
                target: 'extract-tactics',
                modePropagated: false,
                resourceCount: 1,
                parentMode: body.mode || 'standard',
              });
            }

            // Build downstream headers and body based on propagation decision
            const downstreamHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            const downstreamBody: Record<string, unknown> = {
              title: resource.title,
              content: content.slice(0, resource.resource_type === 'transcript' ? 60000 : 12000),
              description: resource.description,
              tags: resource.tags,
              resourceType: resource.resource_type,
              resourceId: resource.id,
              userId,
              persist: true,
              strict: strictMode,
            };

            if (shouldPropagate) {
              // Propagated: forward original user JWT so extract-tactics can validate
              downstreamHeaders['Authorization'] = authHeader!;
              downstreamBody.mode = 'protected';
            } else {
              // Legacy: service-role auth as before
              downstreamHeaders['Authorization'] = `Bearer ${serviceRoleKey}`;
              downstreamHeaders['x-batch-key'] = serviceRoleKey;
            }

            const extractRes = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-tactics`,
              {
                method: 'POST',
                headers: downstreamHeaders,
                body: JSON.stringify(downstreamBody),
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
                  // Content-first validation (uses content pools, not title sets)
                  const validation = validateItem(item, existingKIContents);
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

                  // Find best matching tactic segment for provenance
                  const tacSegment = segmentProvenance.find(s => s.route === 'tactic') || segmentProvenance[0];
                  validItems.push({
                    user_id: userId, source_resource_id: resource.id, title: item.title,
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
                    who: item.who || null,
                    framework: item.framework || null,
                    // Segment provenance for knowledge items
                    source_segment_index: tacSegment.index,
                    source_char_range: tacSegment.charRange,
                    source_heading: tacSegment.heading || null,
                    source_excerpt: (item.tactic_summary || item.what_to_do || '').slice(0, 500),
                    activation_metadata: !validation.passed ? {
                      failed_gates: validation.failedGates, trust_score: validation.score,
                      most_similar: validation.mostSimilar || null, source_title: resource.title,
                      remediation: validation.failedGates.map((g: string) =>
                        getRemediationPath(`trust_failed_${g}` as ResourceFailureReason)
                      ),
                    } : null,
                  });
                  // Add to content pool for intra-batch dedup
                  existingKIContents.push(`${item.tactic_summary || ''} ${item.when_to_use || ''} ${item.example_usage || ''}`);
                  if (!validation.passed) results.trust_rejected++;
                }

                if (allGeneric && validItems.length > 0) {
                  failureReasons.push('extraction_too_generic');
                  results.failure_breakdown['extraction_too_generic'] = (results.failure_breakdown['extraction_too_generic'] || 0) + 1;
                }

                if (validItems.length > 0) {
                  const { data: insertedKIs, error: insertErr } = await supabaseAdmin.from('knowledge_items').insert(validItems).select('id, source_resource_id, source_segment_index, source_char_range, source_heading, tactic_summary');
                  if (!insertErr) {
                    diag.assets_created.knowledge_items += validItems.length;
                    diag.assets_created.knowledge_activated += validItems.filter((v: any) => v.active).length;
                    results.knowledge_created += validItems.length;
                    results.knowledge_activated += validItems.filter((v: any) => v.active).length;
                    createdSomething = true;
                    // Persist provenance for each knowledge item
                    if (insertedKIs && insertedKIs.length > 0) {
                      const provRecords = insertedKIs.map((ki: any) => {
                        const seg = segmentProvenance.find(s => s.index === (ki.source_segment_index ?? 0)) || segmentProvenance[0];
                        return {
                          user_id: userId,
                          asset_type: 'knowledge',
                          asset_id: ki.id,
                          source_resource_id: resource.id,
                          source_segment_index: ki.source_segment_index,
                          source_char_range: ki.source_char_range,
                          source_heading: ki.source_heading,
                          original_content: seg.content,
                          transformed_content: ki.tactic_summary || '',
                        };
                      });
                      await supabaseAdmin.from('asset_provenance').insert(provRecords);
                    }
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
