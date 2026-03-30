/**
 * Sales Brain — Full System Audit
 *
 * Pipeline integrity, knowledge utilization, and system metrics.
 * Provides actionable diagnostics for the entire resource → knowledge → usage chain.
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

  // Index KI by resource
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
      // Check if any active KI has been recently created (proxy for "used")
      result.fully_utilized.push(entry);
    }

    // Inconsistency: has active KI but resource is marked failed/junk
    if (activeKIs.length > 0 && (r.enrichment_status === 'failed' || r.enrichment_status === 'not_enriched')) {
      result.inconsistent_state.push({
        id: r.id,
        title: r.title,
        stage,
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
      never_used: 0,
      rarely_used: 0,
      used_in_prep_only: 0,
      used_in_roleplay_only: 0,
      used_by_dave_only: 0,
      fully_utilized: 0,
      not_retrievable: 0,
      low_confidence: 0,
      by_chapter: {},
      unused_reasons: {},
      most_used: [],
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
      id: ki.id,
      title: ki.title,
      chapter: ki.chapter,
      confidence_score: conf,
      knowledge_type: ki.knowledge_type,
      competitor_name: ki.competitor_name,
      applies_to_contexts: contexts,
      tags,
      classification,
      issue,
      recommendation,
      usage,
    });
  }

  // Most-used items
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
    coverage_pct: number; // % of content-backed resources that are operationalized
  };
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  // Fetch resources
  const { data: resources } = await supabase
    .from('resources')
    .select('id, content_length, manual_content_present, tags, enrichment_status, content');

  // Fetch knowledge items
  const { data: allKI } = await supabase
    .from(KI_TABLE)
    .select('id, source_resource_id, active, status, confidence_score, chapter, knowledge_type, applies_to_contexts, tags, activation_metadata');

  const rList = (resources ?? []) as any[];
  const kiList = (allKI ?? []) as any[];

  // Index KI by resource
  const kiByResource = new Map<string, any[]>();
  for (const ki of kiList) {
    if (ki.source_resource_id) {
      if (!kiByResource.has(ki.source_resource_id)) kiByResource.set(ki.source_resource_id, []);
      kiByResource.get(ki.source_resource_id)!.push(ki);
    }
  }

  // Resource metrics
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

  // Knowledge metrics
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
    resources: {
      total: rList.length,
      content_backed: contentBacked,
      enriched,
      tagged,
      with_knowledge: withKnowledge,
      operationalized,
      stalled,
      by_stage: byStage,
    },
    knowledge: {
      total: kiList.length,
      active: activeKIs.length,
      extracted_pending: extractedPending,
      review_needed: reviewNeeded,
      stale: staleKI,
      retrievable,
      by_chapter: byChapter,
      by_type: byType,
    },
    pipeline: {
      auto_activated_count: autoActivated,
      avg_confidence: Math.round(avgConfidence * 100) / 100,
      coverage_pct: Math.round(coveragePct * 10) / 10,
    },
  };
}
