/**
 * Sales Brain — Full System Audit
 *
 * Pipeline integrity, knowledge utilization, system metrics,
 * invariant checks, resource/KI funnels, usage proof, root cause grouping.
 */

import { supabase } from '@/integrations/supabase/client';
import { createLogger } from '@/lib/logger';
import { derivePipelineStage, type PipelineStage } from '@/lib/autoOperationalize';
import { getKnowledgeUsageStats, type KnowledgeUsageStats } from '@/lib/knowledgeUsageLogger';

const log = createLogger('SalesBrainAudit');

const KI_TABLE = 'knowledge_items' as any;

// ── Pipeline Integrity Audit ───────────────────────────────

export interface PipelineIntegrityResult {
  stalled_before_tagging: AuditedResource[];
  stalled_before_extraction: AuditedResource[];
  stalled_before_activation: AuditedResource[];
  activated_but_not_retrievable: AuditedResource[];
  operationalized_but_unused: AuditedResource[];
  fully_utilized: AuditedResource[];
  inconsistent_state: AuditedResource[];
  summary: {
    total: number;
    byStage: Record<PipelineStage, number>;
    stalledCount: number;
    fullyUtilizedCount: number;
  };
}

export interface AuditedResource {
  id: string;
  title: string;
  stage: PipelineStage;
  issue?: string;
  recommendation?: string;
}

export async function auditPipelineIntegrity(): Promise<PipelineIntegrityResult> {
  const { data: resources } = await supabase
    .from('resources')
    .select('id, title, content_length, manual_content_present, tags, enrichment_status, content')
    .order('created_at', { ascending: false });

  const { data: allKI } = await supabase
    .from(KI_TABLE)
    .select('id, source_resource_id, active, applies_to_contexts, confidence_score, status');

  const items = (resources ?? []) as any[];
  const kiList = (allKI ?? []) as any[];

  const kiByResource = new Map<string, any[]>();
  for (const ki of kiList) {
    if (!ki.source_resource_id) continue;
    if (!kiByResource.has(ki.source_resource_id)) kiByResource.set(ki.source_resource_id, []);
    kiByResource.get(ki.source_resource_id)!.push(ki);
  }

  const result: PipelineIntegrityResult = {
    stalled_before_tagging: [],
    stalled_before_extraction: [],
    stalled_before_activation: [],
    activated_but_not_retrievable: [],
    operationalized_but_unused: [],
    fully_utilized: [],
    inconsistent_state: [],
    summary: {
      total: items.length,
      byStage: { uploaded: 0, content_ready: 0, tagged: 0, knowledge_extracted: 0, activated: 0, operationalized: 0 },
      stalledCount: 0,
      fullyUtilizedCount: 0,
    },
  };

  for (const r of items) {
    const kis = kiByResource.get(r.id) ?? [];
    const activeKIs = kis.filter((k: any) => k.active);
    const hasContexts = activeKIs.some((k: any) =>
      Array.isArray(k.applies_to_contexts) && k.applies_to_contexts.length > 0
    );

    const stage = derivePipelineStage(
      { content_length: r.content_length ?? (r.content?.length ?? 0), manual_content_present: r.manual_content_present, tags: r.tags, enrichment_status: r.enrichment_status },
      { total: kis.length, active: activeKIs.length, hasContexts },
    );

    result.summary.byStage[stage]++;

    const entry: AuditedResource = { id: r.id, title: r.title, stage };
    const contentLen = r.content_length ?? (r.content?.length ?? 0);
    const isContentBacked = contentLen >= 200 || r.manual_content_present;

    if (stage === 'content_ready') {
      entry.issue = 'Content-backed but missing required tags (skill/context)';
      entry.recommendation = 'Run auto-operationalize or tag manually';
      result.stalled_before_tagging.push(entry);
    } else if (stage === 'tagged' && isContentBacked && contentLen >= 300) {
      entry.issue = 'Tagged but no knowledge extracted';
      entry.recommendation = 'Run auto-operationalize to extract knowledge';
      result.stalled_before_extraction.push(entry);
    } else if (stage === 'knowledge_extracted') {
      entry.issue = `${kis.length} KI(s) extracted but none active`;
      entry.recommendation = 'Review and activate or lower confidence threshold';
      result.stalled_before_activation.push(entry);
    } else if (stage === 'activated' && !hasContexts) {
      entry.issue = 'Active KI but none have applies_to_contexts';
      entry.recommendation = 'Add contexts (dave, roleplay, prep) to active items';
      result.activated_but_not_retrievable.push(entry);
    } else if (stage === 'operationalized') {
      result.fully_utilized.push(entry);
    }

    if (activeKIs.length > 0 && (r.enrichment_status === 'failed' || r.enrichment_status === 'not_enriched')) {
      result.inconsistent_state.push({
        id: r.id, title: r.title, stage,
        issue: `Resource status is '${r.enrichment_status}' but has ${activeKIs.length} active KI(s)`,
        recommendation: 'Update enrichment_status to reflect actual state',
      });
    }
  }

  result.summary.stalledCount =
    result.stalled_before_tagging.length +
    result.stalled_before_extraction.length +
    result.stalled_before_activation.length +
    result.activated_but_not_retrievable.length;
  result.summary.fullyUtilizedCount = result.fully_utilized.length;

  log.info('Pipeline integrity audit complete', result.summary);
  return result;
}

// ── Knowledge Utilization Audit ────────────────────────────

export type KnowledgeUtilClass =
  | 'never_used'
  | 'rarely_used'
  | 'used_in_prep_only'
  | 'used_in_roleplay_only'
  | 'used_by_dave_only'
  | 'fully_utilized'
  | 'not_retrievable'
  | 'low_confidence';

export interface KnowledgeUtilItem {
  id: string;
  title: string;
  chapter: string;
  confidence_score: number;
  knowledge_type: string;
  competitor_name: string | null;
  applies_to_contexts: string[];
  tags: string[];
  classification: KnowledgeUtilClass;
  issue?: string;
  recommendation?: string;
  usage?: KnowledgeUsageStats;
}

export interface KnowledgeUtilResult {
  items: KnowledgeUtilItem[];
  summary: {
    total_active: number;
    never_used: number;
    rarely_used: number;
    used_in_prep_only: number;
    used_in_roleplay_only: number;
    used_by_dave_only: number;
    fully_utilized: number;
    not_retrievable: number;
    low_confidence: number;
    by_chapter: Record<string, { active: number; used: number }>;
    unused_reasons: Record<string, number>;
    most_used: Array<{ id: string; title: string; total_count: number }>;
  };
}

export async function auditKnowledgeUtilization(): Promise<KnowledgeUtilResult> {
  const [{ data: activeKI }, usageStats] = await Promise.all([
    supabase.from(KI_TABLE).select('*').eq('active', true),
    getKnowledgeUsageStats(),
  ]);

  const items = (activeKI ?? []) as any[];
  const result: KnowledgeUtilResult = {
    items: [],
    summary: {
      total_active: items.length,
      never_used: 0, rarely_used: 0, used_in_prep_only: 0,
      used_in_roleplay_only: 0, used_by_dave_only: 0,
      fully_utilized: 0, not_retrievable: 0, low_confidence: 0,
      by_chapter: {}, unused_reasons: {}, most_used: [],
    },
  };

  for (const ki of items) {
    const contexts: string[] = ki.applies_to_contexts ?? [];
    const tags: string[] = ki.tags ?? [];
    const conf = ki.confidence_score ?? 0;
    const usage = usageStats.get(ki.id);

    if (!result.summary.by_chapter[ki.chapter]) {
      result.summary.by_chapter[ki.chapter] = { active: 0, used: 0 };
    }
    result.summary.by_chapter[ki.chapter].active++;
    if (usage && usage.total_count > 0) result.summary.by_chapter[ki.chapter].used++;

    let classification: KnowledgeUtilClass;
    let issue: string | undefined;
    let recommendation: string | undefined;

    if (contexts.length === 0) {
      classification = 'not_retrievable';
      issue = 'Active but applies_to_contexts is empty — invisible to Dave, prep, roleplay';
      recommendation = 'Add contexts: dave, roleplay, prep, coaching';
      const reason = 'missing_contexts';
      result.summary.unused_reasons[reason] = (result.summary.unused_reasons[reason] ?? 0) + 1;
    } else if (conf < 0.5) {
      classification = 'low_confidence';
      issue = `Low confidence (${(conf * 100).toFixed(0)}%) — may be ranked below others`;
      recommendation = 'Review and either boost confidence or deactivate';
    } else if (!usage || usage.total_count === 0) {
      const hasSkillTag = tags.some(t => t.startsWith('skill:'));
      const hasContextTag = tags.some(t => t.startsWith('context:'));
      classification = 'never_used';

      if (!hasSkillTag && !hasContextTag) {
        issue = 'Never used — missing skill/context tags prevents tag-based retrieval';
        recommendation = 'Add skill: and context: tags';
        result.summary.unused_reasons['missing_tags'] = (result.summary.unused_reasons['missing_tags'] ?? 0) + 1;
      } else if (!hasContextTag) {
        issue = 'Never used — missing context tags limits retrieval to chapter-only queries';
        recommendation = 'Add context: tags (cold_call, discovery_call, etc.)';
        result.summary.unused_reasons['missing_context_tags'] = (result.summary.unused_reasons['missing_context_tags'] ?? 0) + 1;
      } else {
        issue = 'Never used — structurally valid but no matching workflow demand yet';
        recommendation = 'Run prep or roleplay in matching context to verify retrieval';
        result.summary.unused_reasons['no_matching_demand'] = (result.summary.unused_reasons['no_matching_demand'] ?? 0) + 1;
      }
    } else if (usage.total_count <= 2) {
      classification = 'rarely_used';
      issue = `Only used ${usage.total_count} time(s) — last: ${usage.last_used_at ? new Date(usage.last_used_at).toLocaleDateString() : 'unknown'}`;
      recommendation = 'Check if chapter/tags align with common workflows';
    } else {
      const hasPrep = usage.prep_count > 0;
      const hasRoleplay = usage.roleplay_count > 0;
      const hasDave = usage.dave_count > 0;
      const channels = [hasPrep, hasRoleplay, hasDave].filter(Boolean).length;

      if (channels >= 2) {
        classification = 'fully_utilized';
      } else if (hasPrep && !hasRoleplay && !hasDave) {
        classification = 'used_in_prep_only';
        issue = `Used ${usage.prep_count}x in prep but never in roleplay or Dave`;
        recommendation = 'Verify roleplay/Dave contexts are set';
      } else if (hasRoleplay && !hasPrep && !hasDave) {
        classification = 'used_in_roleplay_only';
        issue = `Used ${usage.roleplay_count}x in roleplay but never in prep or Dave`;
        recommendation = 'Verify prep context is set';
      } else if (hasDave && !hasPrep && !hasRoleplay) {
        classification = 'used_by_dave_only';
        issue = `Used ${usage.dave_count}x by Dave but never in prep or roleplay`;
        recommendation = 'Verify prep/roleplay contexts are set';
      } else {
        classification = 'fully_utilized';
      }
    }

    result.summary[classification]++;

    result.items.push({
      id: ki.id, title: ki.title, chapter: ki.chapter,
      confidence_score: conf, knowledge_type: ki.knowledge_type,
      competitor_name: ki.competitor_name, applies_to_contexts: contexts,
      tags, classification, issue, recommendation, usage,
    });
  }

  result.summary.most_used = result.items
    .filter(i => i.usage && i.usage.total_count > 0)
    .sort((a, b) => (b.usage?.total_count ?? 0) - (a.usage?.total_count ?? 0))
    .slice(0, 10)
    .map(i => ({ id: i.id, title: i.title, total_count: i.usage!.total_count }));

  log.info('Knowledge utilization audit complete', result.summary);
  return result;
}

// ── System Metrics ─────────────────────────────────────────

export interface SystemMetrics {
  resources: {
    total: number;
    content_backed: number;
    enriched: number;
    tagged: number;
    with_knowledge: number;
    operationalized: number;
    stalled: number;
    by_stage: Record<PipelineStage, number>;
  };
  knowledge: {
    total: number;
    active: number;
    extracted_pending: number;
    review_needed: number;
    stale: number;
    retrievable: number;
    by_chapter: Record<string, number>;
    by_type: Record<string, number>;
  };
  pipeline: {
    auto_activated_count: number;
    avg_confidence: number;
    coverage_pct: number;
  };
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const { data: resources } = await supabase
    .from('resources')
    .select('id, content_length, manual_content_present, tags, enrichment_status, content');

  const { data: allKI } = await supabase
    .from(KI_TABLE)
    .select('id, source_resource_id, active, status, confidence_score, chapter, knowledge_type, applies_to_contexts, tags, activation_metadata');

  const rList = (resources ?? []) as any[];
  const kiList = (allKI ?? []) as any[];

  const kiByResource = new Map<string, any[]>();
  for (const ki of kiList) {
    if (ki.source_resource_id) {
      if (!kiByResource.has(ki.source_resource_id)) kiByResource.set(ki.source_resource_id, []);
      kiByResource.get(ki.source_resource_id)!.push(ki);
    }
  }

  let contentBacked = 0, enriched = 0, tagged = 0, withKnowledge = 0, operationalized = 0, stalled = 0;
  const byStage: Record<PipelineStage, number> = { uploaded: 0, content_ready: 0, tagged: 0, knowledge_extracted: 0, activated: 0, operationalized: 0 };

  for (const r of rList) {
    const contentLen = r.content_length ?? (r.content?.length ?? 0);
    const isCB = contentLen >= 200 || r.manual_content_present;
    if (isCB) contentBacked++;
    if (['enriched', 'deep_enriched', 'verified'].includes(r.enrichment_status)) enriched++;

    const tags: string[] = r.tags ?? [];
    const dims = new Set(tags.filter((t: string) => t.includes(':')).map((t: string) => t.split(':')[0]));
    if (dims.has('skill') || dims.has('context')) tagged++;

    const kis = kiByResource.get(r.id) ?? [];
    if (kis.length > 0) withKnowledge++;

    const activeKIs = kis.filter((k: any) => k.active);
    const hasContexts = activeKIs.some((k: any) => Array.isArray(k.applies_to_contexts) && k.applies_to_contexts.length > 0);

    const stage = derivePipelineStage(
      { content_length: contentLen, manual_content_present: r.manual_content_present, tags: r.tags, enrichment_status: r.enrichment_status },
      { total: kis.length, active: activeKIs.length, hasContexts },
    );
    byStage[stage]++;

    if (stage === 'operationalized') operationalized++;
    if (isCB && stage !== 'operationalized' && stage !== 'uploaded') stalled++;
  }

  const activeKIs = kiList.filter((k: any) => k.active);
  const extractedPending = kiList.filter((k: any) => k.status === 'extracted').length;
  const reviewNeeded = kiList.filter((k: any) => k.status === 'review_needed').length;
  const staleKI = kiList.filter((k: any) => k.status === 'stale').length;
  const retrievable = activeKIs.filter((k: any) =>
    Array.isArray(k.applies_to_contexts) && k.applies_to_contexts.length > 0 &&
    (k.tags ?? []).some((t: string) => t.startsWith('skill:') || t.startsWith('context:'))
  ).length;

  const byChapter: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const ki of activeKIs) {
    byChapter[ki.chapter] = (byChapter[ki.chapter] ?? 0) + 1;
    byType[ki.knowledge_type] = (byType[ki.knowledge_type] ?? 0) + 1;
  }

  const autoActivated = kiList.filter((k: any) => k.activation_metadata?.activation_source === 'auto_pipeline').length;
  const avgConfidence = activeKIs.length > 0
    ? activeKIs.reduce((sum: number, k: any) => sum + (k.confidence_score ?? 0), 0) / activeKIs.length
    : 0;
  const coveragePct = contentBacked > 0 ? (operationalized / contentBacked) * 100 : 0;

  return {
    resources: { total: rList.length, content_backed: contentBacked, enriched, tagged, with_knowledge: withKnowledge, operationalized, stalled, by_stage: byStage },
    knowledge: { total: kiList.length, active: activeKIs.length, extracted_pending: extractedPending, review_needed: reviewNeeded, stale: staleKI, retrievable, by_chapter: byChapter, by_type: byType },
    pipeline: { auto_activated_count: autoActivated, avg_confidence: Math.round(avgConfidence * 100) / 100, coverage_pct: Math.round(coveragePct * 10) / 10 },
  };
}

// ══════════════════════════════════════════════════════════════
// ── INVARIANT CHECK ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

export type InvariantClass =
  | 'operationalized'
  | 'blocked_by_empty_content'
  | 'blocked_by_no_extraction'
  | 'blocked_by_activation_criteria'
  | 'blocked_by_missing_contexts'
  | 'blocked_by_stale_blocker_state'
  | 'invariant_violation';

export interface InvariantExample {
  id: string;
  title: string;
  contentLengthField: number;
  actualContentLength: number;
  kiCount: number;
  activeKiCount: number;
  activeWithContextsCount: number;
  assignedClasses: string[];
  reason: string;
}

export interface InvariantCheckResult {
  totalContentBackedEnriched: number;
  byClass: Record<InvariantClass, number>;
  violations: InvariantExample[];
  healthy: boolean;
}

export async function runInvariantCheck(): Promise<InvariantCheckResult> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { totalContentBackedEnriched: 0, byClass: emptyInvariantCounts(), violations: [], healthy: true };

  const { data: res } = await supabase.from('resources')
    .select('id, title, content_length, content, enrichment_status, manual_input_required, recovery_queue_bucket, failure_reason')
    .eq('user_id', userId);

  const { data: kiData } = await supabase.from(KI_TABLE)
    .select('source_resource_id, active, applies_to_contexts')
    .eq('user_id', userId);

  const resList = (res ?? []) as any[];
  const kiList = (kiData ?? []) as any[];
  const enrichedStatuses = ['enriched', 'deep_enriched', 'verified'];

  const kiByResource = new Map<string, any[]>();
  for (const ki of kiList) {
    if (ki.source_resource_id) {
      const arr = kiByResource.get(ki.source_resource_id) ?? [];
      arr.push(ki);
      kiByResource.set(ki.source_resource_id, arr);
    }
  }

  const counts = emptyInvariantCounts();
  const violations: InvariantExample[] = [];

  // Only check enriched, content-backed resources
  const eligible = resList.filter(r => {
    if (!enrichedStatuses.includes(r.enrichment_status)) return false;
    const actualLen = r.content?.length ?? 0;
    const fieldLen = r.content_length ?? 0;
    return Math.max(actualLen, fieldLen) >= 200;
  });

  for (const r of eligible) {
    const actualLen = r.content?.length ?? 0;
    const fieldLen = r.content_length ?? 0;
    const items = kiByResource.get(r.id) ?? [];
    const activeItems = items.filter((k: any) => k.active);
    const activeWithCtx = activeItems.filter((k: any) => Array.isArray(k.applies_to_contexts) && k.applies_to_contexts.length > 0);
    const isStaleBlocker = r.manual_input_required || r.recovery_queue_bucket || r.enrichment_status === 'failed';

    const classes: InvariantClass[] = [];

    // Classify
    if (fieldLen > 300 && actualLen < 100) {
      classes.push('blocked_by_empty_content');
    } else if (isStaleBlocker) {
      classes.push('blocked_by_stale_blocker_state');
    } else if (items.length === 0) {
      classes.push('blocked_by_no_extraction');
    } else if (activeItems.length === 0) {
      classes.push('blocked_by_activation_criteria');
    } else if (activeWithCtx.length === 0) {
      classes.push('blocked_by_missing_contexts');
    } else {
      classes.push('operationalized');
    }

    if (classes.length === 0) {
      classes.push('invariant_violation');
    } else if (classes.length > 1) {
      // Multi-class = violation
      counts['invariant_violation']++;
      if (violations.length < 10) {
        violations.push({
          id: r.id, title: r.title ?? '(untitled)',
          contentLengthField: fieldLen, actualContentLength: actualLen,
          kiCount: items.length, activeKiCount: activeItems.length,
          activeWithContextsCount: activeWithCtx.length,
          assignedClasses: classes, reason: `Assigned to multiple classes: ${classes.join(', ')}`,
        });
      }
      continue;
    }

    counts[classes[0]]++;
  }

  return {
    totalContentBackedEnriched: eligible.length,
    byClass: counts,
    violations,
    healthy: violations.length === 0,
  };
}

function emptyInvariantCounts(): Record<InvariantClass, number> {
  return {
    operationalized: 0, blocked_by_empty_content: 0, blocked_by_no_extraction: 0,
    blocked_by_activation_criteria: 0, blocked_by_missing_contexts: 0,
    blocked_by_stale_blocker_state: 0, invariant_violation: 0,
  };
}

// ══════════════════════════════════════════════════════════════
// ── RESOURCE FUNNEL ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

export interface FunnelStage {
  label: string;
  count: number;
  pct: number; // pct of total
  dropoffPct: number; // dropoff from previous stage
}

export interface ResourceFunnel {
  stages: FunnelStage[];
  usedInPrep: number;
  usedInRoleplay: number;
  usedByDave: number;
  fullyUtilized: number;
}

export interface KnowledgeFunnel {
  stages: FunnelStage[];
  avgConfidence: number;
  autoActivatedCount: number;
  manuallyActivatedCount: number;
  userEditedCount: number;
  usedInPrep: number;
  usedInRoleplay: number;
  usedByDave: number;
  fullyUtilized: number;
  neverUsed: number;
}

export async function buildResourceFunnel(): Promise<ResourceFunnel> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { stages: [], usedInPrep: 0, usedInRoleplay: 0, usedByDave: 0, fullyUtilized: 0 };

  const { data: res } = await supabase.from('resources')
    .select('id, content_length, content, enrichment_status, manual_content_present, tags')
    .eq('user_id', userId);
  const { data: kiData } = await supabase.from(KI_TABLE)
    .select('source_resource_id, active, applies_to_contexts, tags')
    .eq('user_id', userId);

  const rList = (res ?? []) as any[];
  const kiList = (kiData ?? []) as any[];
  const usageStats = await getKnowledgeUsageStats();

  const kiByResource = new Map<string, any[]>();
  for (const ki of kiList) {
    if (ki.source_resource_id) {
      const arr = kiByResource.get(ki.source_resource_id) ?? [];
      arr.push(ki);
      kiByResource.set(ki.source_resource_id, arr);
    }
  }

  const enrichedStatuses = ['enriched', 'deep_enriched', 'verified'];
  const total = rList.length;
  const enriched = rList.filter(r => enrichedStatuses.includes(r.enrichment_status));
  const contentBacked = enriched.filter(r => {
    const len = Math.max(r.content_length ?? 0, r.content?.length ?? 0);
    return len >= 200 || r.manual_content_present;
  });
  const withKI = contentBacked.filter(r => (kiByResource.get(r.id) ?? []).length > 0);
  const withActiveKI = withKI.filter(r => (kiByResource.get(r.id) ?? []).some((k: any) => k.active));
  const withActiveCtx = withActiveKI.filter(r =>
    (kiByResource.get(r.id) ?? []).some((k: any) => k.active && Array.isArray(k.applies_to_contexts) && k.applies_to_contexts.length > 0)
  );

  // Usage by resource — check if any KI from this resource was used
  let usedInPrep = 0, usedInRoleplay = 0, usedByDave = 0, fullyUtilized = 0;
  for (const r of withActiveCtx) {
    const kis = kiByResource.get(r.id) ?? [];
    let rPrep = false, rRole = false, rDave = false;
    for (const ki of kis) {
      const u = usageStats.get(ki.id);
      if (!u) continue;
      if (u.prep_count > 0) rPrep = true;
      if (u.roleplay_count > 0) rRole = true;
      if (u.dave_count > 0) rDave = true;
    }
    if (rPrep) usedInPrep++;
    if (rRole) usedInRoleplay++;
    if (rDave) usedByDave++;
    const channels = [rPrep, rRole, rDave].filter(Boolean).length;
    if (channels >= 2) fullyUtilized++;
  }

  const usedInAny = new Set<string>();
  for (const r of withActiveCtx) {
    const kis = kiByResource.get(r.id) ?? [];
    for (const ki of kis) {
      const u = usageStats.get(ki.id);
      if (u && u.total_count > 0) { usedInAny.add(r.id); break; }
    }
  }

  function stage(label: string, count: number, prev: number): FunnelStage {
    return { label, count, pct: total > 0 ? Math.round((count / total) * 100) : 0, dropoffPct: prev > 0 ? Math.round(((prev - count) / prev) * 100) : 0 };
  }

  return {
    stages: [
      stage('Total resources', total, total),
      stage('Enriched', enriched.length, total),
      stage('Content-backed enriched', contentBacked.length, enriched.length),
      stage('With knowledge items', withKI.length, contentBacked.length),
      stage('With active KI', withActiveKI.length, withKI.length),
      stage('Active KI + contexts', withActiveCtx.length, withActiveKI.length),
      stage('Actually used', usedInAny.size, withActiveCtx.length),
      stage('Fully utilized (2+ channels)', fullyUtilized, usedInAny.size),
    ],
    usedInPrep, usedInRoleplay, usedByDave, fullyUtilized,
  };
}

export async function buildKnowledgeFunnel(): Promise<KnowledgeFunnel> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return emptyKIFunnel();

  const { data: kiData } = await supabase.from(KI_TABLE)
    .select('id, active, status, confidence_score, applies_to_contexts, tags, user_edited, activation_metadata')
    .eq('user_id', userId);

  const kiList = (kiData ?? []) as any[];
  const usageStats = await getKnowledgeUsageStats();

  const total = kiList.length;
  const extracted = kiList.filter(k => k.status === 'extracted' || k.status === 'review_needed' || k.status === 'active' || k.active);
  const reviewNeeded = kiList.filter(k => k.status === 'review_needed');
  const approved = kiList.filter(k => k.status === 'active' || k.active);
  const active = kiList.filter(k => k.active);
  const activeWithCtx = active.filter(k => Array.isArray(k.applies_to_contexts) && k.applies_to_contexts.length > 0);
  const taggedSkillCtx = activeWithCtx.filter(k => (k.tags ?? []).some((t: string) => t.startsWith('skill:') || t.startsWith('context:')));

  let usedInPrep = 0, usedInRoleplay = 0, usedByDave = 0, fullyUtilized = 0, neverUsed = 0;
  for (const ki of active) {
    const u = usageStats.get(ki.id);
    if (!u || u.total_count === 0) { neverUsed++; continue; }
    if (u.prep_count > 0) usedInPrep++;
    if (u.roleplay_count > 0) usedInRoleplay++;
    if (u.dave_count > 0) usedByDave++;
    const ch = [u.prep_count > 0, u.roleplay_count > 0, u.dave_count > 0].filter(Boolean).length;
    if (ch >= 2) fullyUtilized++;
  }

  const confs = active.map(k => k.confidence_score ?? 0);
  const avg = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const autoActivated = kiList.filter(k => k.activation_metadata?.activation_source === 'auto_pipeline').length;
  const manuallyActivated = active.length - autoActivated;
  const userEdited = kiList.filter(k => k.user_edited).length;

  function stage(label: string, count: number, prev: number): FunnelStage {
    return { label, count, pct: total > 0 ? Math.round((count / total) * 100) : 0, dropoffPct: prev > 0 ? Math.round(((prev - count) / prev) * 100) : 0 };
  }

  return {
    stages: [
      stage('Total KI', total, total),
      stage('Extracted', extracted.length, total),
      stage('Review needed', reviewNeeded.length, extracted.length),
      stage('Approved/active', approved.length, extracted.length),
      stage('Active', active.length, approved.length),
      stage('Active + contexts', activeWithCtx.length, active.length),
      stage('Tagged (skill/context)', taggedSkillCtx.length, activeWithCtx.length),
      stage('Used in prep', usedInPrep, taggedSkillCtx.length),
      stage('Used in roleplay', usedInRoleplay, taggedSkillCtx.length),
      stage('Used by Dave', usedByDave, taggedSkillCtx.length),
      stage('Fully utilized', fullyUtilized, taggedSkillCtx.length),
      stage('Never used', neverUsed, active.length),
    ],
    avgConfidence: Math.round(avg * 100) / 100,
    autoActivatedCount: autoActivated,
    manuallyActivatedCount: Math.max(0, manuallyActivated),
    userEditedCount: userEdited,
    usedInPrep, usedInRoleplay, usedByDave, fullyUtilized, neverUsed,
  };
}

function emptyKIFunnel(): KnowledgeFunnel {
  return { stages: [], avgConfidence: 0, autoActivatedCount: 0, manuallyActivatedCount: 0, userEditedCount: 0, usedInPrep: 0, usedInRoleplay: 0, usedByDave: 0, fullyUtilized: 0, neverUsed: 0 };
}

// ══════════════════════════════════════════════════════════════
// ── USAGE PROOF ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

export interface UsageProofResource {
  id: string;
  title: string;
  kiCount: number;
  activeKiCount: number;
  prepCount: number;
  roleplayCount: number;
  daveCount: number;
  lastUsedAt: string | null;
}

export interface UsageProofKI {
  id: string;
  title: string;
  chapter: string;
  confidence: number;
  contexts: string[];
  prepCount: number;
  roleplayCount: number;
  daveCount: number;
  lastUsedAt: string | null;
}

export interface NeverUsedKI {
  id: string;
  title: string;
  chapter: string;
  confidence: number;
  contexts: string[];
  tags: string[];
  issue: string;
  recommendation: string;
}

export interface UsageProof {
  topResources: UsageProofResource[];
  topKI: UsageProofKI[];
  neverUsedKI: NeverUsedKI[];
}

export async function buildUsageProof(): Promise<UsageProof> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { topResources: [], topKI: [], neverUsedKI: [] };

  const [{ data: res }, { data: kiData }, usageStats] = await Promise.all([
    supabase.from('resources').select('id, title').eq('user_id', userId),
    supabase.from(KI_TABLE).select('id, title, source_resource_id, active, chapter, confidence_score, applies_to_contexts, tags').eq('user_id', userId),
    getKnowledgeUsageStats(),
  ]);

  const rList = (res ?? []) as any[];
  const kiList = (kiData ?? []) as any[];

  const kiByResource = new Map<string, any[]>();
  for (const ki of kiList) {
    if (ki.source_resource_id) {
      const arr = kiByResource.get(ki.source_resource_id) ?? [];
      arr.push(ki);
      kiByResource.set(ki.source_resource_id, arr);
    }
  }

  // Top resources by total usage
  const resourceUsage: UsageProofResource[] = [];
  for (const r of rList) {
    const kis = kiByResource.get(r.id) ?? [];
    if (kis.length === 0) continue;
    let prep = 0, role = 0, dave = 0;
    let lastUsed: string | null = null;
    for (const ki of kis) {
      const u = usageStats.get(ki.id);
      if (!u) continue;
      prep += u.prep_count;
      role += u.roleplay_count;
      dave += u.dave_count;
      if (u.last_used_at && (!lastUsed || u.last_used_at > lastUsed)) lastUsed = u.last_used_at;
    }
    if (prep + role + dave > 0) {
      resourceUsage.push({
        id: r.id, title: r.title ?? '(untitled)',
        kiCount: kis.length, activeKiCount: kis.filter((k: any) => k.active).length,
        prepCount: prep, roleplayCount: role, daveCount: dave, lastUsedAt: lastUsed,
      });
    }
  }
  resourceUsage.sort((a, b) => (b.prepCount + b.roleplayCount + b.daveCount) - (a.prepCount + a.roleplayCount + a.daveCount));

  // Top KI by usage
  const kiUsage: UsageProofKI[] = [];
  const neverUsedItems: NeverUsedKI[] = [];
  for (const ki of kiList) {
    if (!ki.active) continue;
    const u = usageStats.get(ki.id);
    const contexts: string[] = ki.applies_to_contexts ?? [];
    const tags: string[] = ki.tags ?? [];

    if (!u || u.total_count === 0) {
      if (neverUsedItems.length < 15) {
        const hasSkill = tags.some(t => t.startsWith('skill:'));
        const hasCtxTag = tags.some(t => t.startsWith('context:'));
        let issue = 'Structurally valid but no demand yet';
        let recommendation = 'Run prep/roleplay in matching context';
        if (contexts.length === 0) { issue = 'No applies_to_contexts'; recommendation = 'Add contexts: dave, prep, roleplay'; }
        else if (!hasSkill && !hasCtxTag) { issue = 'Missing skill/context tags'; recommendation = 'Add structured tags'; }
        neverUsedItems.push({
          id: ki.id, title: ki.title, chapter: ki.chapter,
          confidence: ki.confidence_score ?? 0, contexts, tags, issue, recommendation,
        });
      }
      continue;
    }

    kiUsage.push({
      id: ki.id, title: ki.title, chapter: ki.chapter,
      confidence: ki.confidence_score ?? 0, contexts,
      prepCount: u.prep_count, roleplayCount: u.roleplay_count, daveCount: u.dave_count,
      lastUsedAt: u.last_used_at,
    });
  }
  kiUsage.sort((a, b) => (b.prepCount + b.roleplayCount + b.daveCount) - (a.prepCount + a.roleplayCount + a.daveCount));

  return {
    topResources: resourceUsage.slice(0, 10),
    topKI: kiUsage.slice(0, 10),
    neverUsedKI: neverUsedItems.slice(0, 10),
  };
}

// ══════════════════════════════════════════════════════════════
// ── ROOT CAUSE GROUPING ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════

export interface RootCauseGroup {
  label: string;
  count: number;
  examples: Array<{ id: string; title: string }>;
}

export interface RootCauseReport {
  resourceCauses: RootCauseGroup[];
  knowledgeCauses: RootCauseGroup[];
}

export function buildRootCauses(
  invariant: InvariantCheckResult,
  knowledgeUtil: KnowledgeUtilResult,
): RootCauseReport {
  const resCauses: RootCauseGroup[] = [];

  const addResGroup = (label: string, cls: InvariantClass) => {
    if (invariant.byClass[cls] > 0) {
      resCauses.push({ label, count: invariant.byClass[cls], examples: [] });
    }
  };

  addResGroup('Empty actual content', 'blocked_by_empty_content');
  addResGroup('Extraction returned zero', 'blocked_by_no_extraction');
  addResGroup('Extracted but none activated', 'blocked_by_activation_criteria');
  addResGroup('Active but no contexts', 'blocked_by_missing_contexts');
  addResGroup('Stale blocker state', 'blocked_by_stale_blocker_state');
  if (invariant.violations.length > 0) {
    resCauses.push({ label: 'Invariant violation', count: invariant.violations.length, examples: invariant.violations.slice(0, 5).map(v => ({ id: v.id, title: v.title })) });
  }

  // Knowledge causes
  const kiCauses: RootCauseGroup[] = [];
  const addKIGroup = (label: string, filter: (i: KnowledgeUtilItem) => boolean) => {
    const matching = knowledgeUtil.items.filter(filter);
    if (matching.length > 0) {
      kiCauses.push({ label, count: matching.length, examples: matching.slice(0, 5).map(i => ({ id: i.id, title: i.title })) });
    }
  };

  addKIGroup('Missing contexts', i => i.classification === 'not_retrievable');
  addKIGroup('Missing skill/context tags', i => i.classification === 'never_used' && !(i.tags ?? []).some(t => t.startsWith('skill:') || t.startsWith('context:')));
  addKIGroup('Low confidence', i => i.classification === 'low_confidence');
  addKIGroup('Never used (retrievable)', i => i.classification === 'never_used' && i.applies_to_contexts.length > 0 && (i.tags ?? []).some(t => t.startsWith('skill:') || t.startsWith('context:')));
  addKIGroup('Single-channel usage', i => ['used_in_prep_only', 'used_in_roleplay_only', 'used_by_dave_only'].includes(i.classification));

  return { resourceCauses: resCauses, knowledgeCauses: kiCauses };
}

// ══════════════════════════════════════════════════════════════
// ── NOTHING SLIPS THROUGH SUMMARY ────────────────────────────
// ══════════════════════════════════════════════════════════════

export interface NothingSlipsSummary {
  lines: string[];
  nextSteps: string[];
  biggestLeak: string;
}

export function buildNothingSlipsSummary(
  metrics: SystemMetrics,
  invariant: InvariantCheckResult,
  resFunnel: ResourceFunnel,
  kiFunnel: KnowledgeFunnel,
): NothingSlipsSummary {
  const lines = [
    `${metrics.resources.total} total resources`,
    `${metrics.resources.enriched} enriched`,
    `${metrics.resources.content_backed} content-backed`,
    `${metrics.resources.with_knowledge} with knowledge items`,
    `${metrics.resources.operationalized} operationalized`,
    `${resFunnel.usedInPrep + resFunnel.usedInRoleplay + resFunnel.usedByDave > 0 ? `${new Set([...Array(resFunnel.usedInPrep), ...Array(resFunnel.usedInRoleplay), ...Array(resFunnel.usedByDave)]).size} actually used` : '0 actually used'}`,
    `${invariant.violations.length} invariant violations`,
  ];

  // Find biggest leak
  const leaks: Array<[string, number]> = [
    ['empty content', invariant.byClass.blocked_by_empty_content],
    ['no extraction', invariant.byClass.blocked_by_no_extraction],
    ['activation criteria', invariant.byClass.blocked_by_activation_criteria],
    ['missing contexts', invariant.byClass.blocked_by_missing_contexts],
    ['stale blocker', invariant.byClass.blocked_by_stale_blocker_state],
    ['never-used active KI', kiFunnel.neverUsed],
  ];
  leaks.sort((a, b) => b[1] - a[1]);
  const biggestLeak = leaks[0][1] > 0 ? `${leaks[0][0]} (${leaks[0][1]} resources/items)` : 'No significant leaks detected';

  const nextSteps: string[] = [];
  if (invariant.byClass.blocked_by_empty_content > 0) nextSteps.push(`Fix ${invariant.byClass.blocked_by_empty_content} resources with empty content (re-enrich)`);
  if (invariant.byClass.blocked_by_no_extraction > 0) nextSteps.push(`Force extract ${invariant.byClass.blocked_by_no_extraction} resources with no KI`);
  if (invariant.byClass.blocked_by_activation_criteria > 0) nextSteps.push(`Review ${invariant.byClass.blocked_by_activation_criteria} extracted-but-inactive resources`);
  if (invariant.byClass.blocked_by_missing_contexts > 0) nextSteps.push(`Repair contexts on ${invariant.byClass.blocked_by_missing_contexts} active-but-unreachable items`);
  if (kiFunnel.neverUsed > 0) nextSteps.push(`Investigate ${kiFunnel.neverUsed} never-used active KI`);
  if (invariant.byClass.blocked_by_stale_blocker_state > 0) nextSteps.push(`Clear ${invariant.byClass.blocked_by_stale_blocker_state} stale blockers`);
  if (nextSteps.length === 0) nextSteps.push('Pipeline is healthy — continue using prep, roleplay, and Dave to generate usage proof');

  return { lines, nextSteps, biggestLeak };
}
