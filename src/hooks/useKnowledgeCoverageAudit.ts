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
  // New multi-pass fields
  extraction_mode: string;
  extraction_passes_run: string[];
  raw_candidate_counts: Record<string, number>;
  merged_candidate_count: number;
  last_extraction_summary: string | null;
  extraction_method: string | null;
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
  if (contentLength >= 5000 && kiCount <= 6) return true;
  if (contentLength >= 3000 && kiCount <= 4) return true;
  if (contentLength >= 1500 && kiCount <= 2) return true;
  const kisPer1k = contentLength > 0 ? (kiCount * 1000) / contentLength : 0;
  if (kisPer1k < 1.0 && kiCount > 0) return true;
  return false;
}

function computeDepthBucket(kisPer1k: number, kiCount: number): ResourceAuditRow['extraction_depth_bucket'] {
  if (kiCount === 0) return 'none';
  if (kisPer1k < 0.75) return 'shallow';
  if (kisPer1k < 1.5) return 'moderate';
  return 'strong';
}

export function useKnowledgeCoverageAudit() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['knowledge-coverage-audit', user?.id],
    queryFn: async () => {
      const { data: resources, error: rErr } = await supabase
        .from('resources' as any)
        .select('id, title, resource_type, enrichment_status, active_job_status, content_length, extraction_attempt_count, extraction_mode, extraction_passes_run, raw_candidate_counts, merged_candidate_count, kis_per_1k_chars, extraction_depth_bucket, under_extracted_flag, last_extraction_summary, extraction_method')
        .order('content_length', { ascending: false });
      if (rErr) throw rErr;

      // Paginate KIs
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

      // Method mix counters
      const methodMix = { llm: 0, heuristic: 0, hybrid: 0, unknown: 0 };

      const rows: ResourceAuditRow[] = (resources ?? []).map((r: any) => {
        const ki = kiMap.get(r.id) ?? { total: 0, active: 0, withCtx: 0 };
        const cl = r.content_length ?? 0;
        // Prefer DB-persisted metrics, fall back to computed
        const dbKisPer1k = r.kis_per_1k_chars != null ? Number(r.kis_per_1k_chars) : (cl > 0 ? Math.round((ki.total * 1000 / cl) * 100) / 100 : 0);
        const dbDepth = r.extraction_depth_bucket || computeDepthBucket(dbKisPer1k, ki.total);
        const dbUnderExtracted = r.under_extracted_flag ?? computeUnderExtracted(cl, ki.total);
        const method = r.extraction_method || null;

        if (method === 'llm') methodMix.llm++;
        else if (method === 'heuristic') methodMix.heuristic++;
        else if (method === 'hybrid') methodMix.hybrid++;
        else methodMix.unknown++;

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
          kis_per_1k_chars: dbKisPer1k,
          under_extracted_flag: dbUnderExtracted,
          extraction_depth_bucket: dbDepth,
          extraction_mode: r.extraction_mode || 'unknown',
          extraction_passes_run: r.extraction_passes_run || [],
          raw_candidate_counts: r.raw_candidate_counts || {},
          merged_candidate_count: r.merged_candidate_count || 0,
          last_extraction_summary: r.last_extraction_summary || null,
          extraction_method: method,
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
        methodMix,
        top20Weakest,
      } as CoverageAuditSummary;
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}
