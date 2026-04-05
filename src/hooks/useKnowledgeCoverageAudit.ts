/**
 * Knowledge Coverage Audit hook.
 * Queries real DB state for per-resource extraction density analysis.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ResourceAuditRow {
  resource_id: string;
  title: string;
  resource_type: string;
  enrichment_status: string;
  active_job_status: string | null;
  content_length: number;
  ki_count_total: number;
  ki_count_active: number;
  ki_with_context_count: number;
  extraction_attempt_count: number;
  kis_per_1k_chars: number;
  under_extracted_flag: boolean;
  extraction_depth_bucket: 'none' | 'shallow' | 'moderate' | 'strong';
}

export interface CoverageAuditSummary {
  resources: ResourceAuditRow[];
  dbTotalKIs: number;
  dbActiveKIs: number;
  resourcesFullyMined: number;
  resourcesShallowlyMined: number;
  resourcesUnderExtracted: number;
  resourcesZeroKIs: number;
  avgKisPer1k: number;
  methodMix: { llm: number; heuristic: number; hybrid: number; unknown: number };
  top20Weakest: ResourceAuditRow[];
}

function computeUnderExtracted(contentLength: number, kiCount: number): boolean {
  if (contentLength >= 5000 && kiCount <= 3) return true;
  if (contentLength >= 3000 && kiCount <= 2) return true;
  if (contentLength >= 1500 && kiCount <= 1) return true;
  return false;
}

function computeDepthBucket(kisPer1k: number, kiCount: number): ResourceAuditRow['extraction_depth_bucket'] {
  if (kiCount === 0) return 'none';
  if (kisPer1k < 0.3) return 'shallow';
  if (kisPer1k < 0.8) return 'moderate';
  return 'strong';
}

export function useKnowledgeCoverageAudit() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['knowledge-coverage-audit', user?.id],
    queryFn: async () => {
      // Fetch all resources
      const { data: resources, error: rErr } = await supabase
        .from('resources' as any)
        .select('id, title, resource_type, enrichment_status, active_job_status, content_length, extraction_attempt_count')
        .order('content_length', { ascending: false });
      if (rErr) throw rErr;

      // Fetch all KI counts grouped by resource — paginate to avoid 1000 limit
      const PAGE_SIZE = 1000;
      let allKIs: any[] = [];
      let from = 0;
      while (true) {
        const { data: kis, error: kErr } = await supabase
          .from('knowledge_items' as any)
          .select('source_resource_id, active, applies_to_contexts')
          .range(from, from + PAGE_SIZE - 1);
        if (kErr) throw kErr;
        if (!kis || kis.length === 0) break;
        allKIs = allKIs.concat(kis);
        if (kis.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      // Group KIs by resource
      const kiMap = new Map<string, { total: number; active: number; withCtx: number }>();
      for (const ki of allKIs) {
        const rid = ki.source_resource_id;
        if (!rid) continue;
        if (!kiMap.has(rid)) kiMap.set(rid, { total: 0, active: 0, withCtx: 0 });
        const entry = kiMap.get(rid)!;
        entry.total++;
        if (ki.active) entry.active++;
        if (ki.active && ki.applies_to_contexts && (ki.applies_to_contexts as string[]).length > 0) entry.withCtx++;
      }

      const dbTotalKIs = allKIs.length;
      const dbActiveKIs = allKIs.filter((k: any) => k.active).length;

      // Build audit rows
      const rows: ResourceAuditRow[] = (resources ?? []).map((r: any) => {
        const ki = kiMap.get(r.id) ?? { total: 0, active: 0, withCtx: 0 };
        const cl = r.content_length ?? 0;
        const kisPer1k = cl > 0 ? Math.round((ki.total * 1000 / cl) * 100) / 100 : 0;
        return {
          resource_id: r.id,
          title: r.title ?? '(untitled)',
          resource_type: r.resource_type ?? 'unknown',
          enrichment_status: r.enrichment_status ?? 'unknown',
          active_job_status: r.active_job_status,
          content_length: cl,
          ki_count_total: ki.total,
          ki_count_active: ki.active,
          ki_with_context_count: ki.withCtx,
          extraction_attempt_count: r.extraction_attempt_count ?? 0,
          kis_per_1k_chars: kisPer1k,
          under_extracted_flag: computeUnderExtracted(cl, ki.total),
          extraction_depth_bucket: computeDepthBucket(kisPer1k, ki.total),
        };
      });

      const resourcesZeroKIs = rows.filter(r => r.ki_count_total === 0).length;
      const resourcesUnderExtracted = rows.filter(r => r.under_extracted_flag).length;
      const resourcesShallowlyMined = rows.filter(r => r.extraction_depth_bucket === 'shallow').length;
      const resourcesFullyMined = rows.filter(r => r.extraction_depth_bucket === 'strong' || r.extraction_depth_bucket === 'moderate').length;

      const totalContentLength = rows.reduce((s, r) => s + r.content_length, 0);
      const avgKisPer1k = totalContentLength > 0
        ? Math.round((dbTotalKIs * 1000 / totalContentLength) * 100) / 100
        : 0;

      const top20Weakest = rows
        .filter(r => r.content_length >= 1500)
        .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
        .slice(0, 20);

      return {
        resources: rows,
        dbTotalKIs,
        dbActiveKIs,
        resourcesFullyMined,
        resourcesShallowlyMined,
        resourcesUnderExtracted,
        resourcesZeroKIs,
        avgKisPer1k,
        methodMix: { llm: 0, heuristic: 0, hybrid: 0, unknown: rows.length }, // TODO: track method per resource
        top20Weakest,
      } as CoverageAuditSummary;
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}
