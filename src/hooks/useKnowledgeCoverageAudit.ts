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
  extraction_batch_status: string | null;
  content_length: number;
  ki_count_total: number;
  ki_count_active: number;
  ki_with_context_count: number;
  extraction_attempt_count: number;
  extraction_batches_completed: number;
  extraction_batch_total: number;
  extraction_is_resumable: boolean;
  kis_per_1k_chars: number;
  under_extracted_flag: boolean;
  extraction_depth_bucket: 'none' | 'shallow' | 'moderate' | 'strong';
  // Multi-pass fields
  extraction_mode: string;
  extraction_passes_run: string[];
  raw_candidate_counts: Record<string, number>;
  merged_candidate_count: number;
  last_extraction_summary: string | null;
  extraction_method: string | null;
  // Server-owned truth fields
  last_extraction_run_id: string | null;
  last_extraction_run_status: string | null;
  last_extraction_returned_ki_count: number | null;
  last_extraction_deduped_ki_count: number | null;
  last_extraction_validated_ki_count: number | null;
  last_extraction_saved_ki_count: number | null;
  last_extraction_error: string | null;
  last_extraction_duration_ms: number | null;
  last_extraction_model: string | null;
  // Chunk failure diagnostics (from latest extraction_run)
  last_extraction_chunks_failed: number | null;
  last_extraction_chunks_total: number | null;
  last_extraction_mode: string | null;
  // Per-resource operation progress
  active_job_type: string | null;
  active_job_step_label: string | null;
  active_job_progress_current: number | null;
  active_job_progress_total: number | null;
  active_job_progress_pct: number | null;
  active_job_updated_at: string | null;
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

function computeUnderExtracted(contentLength: number, kiCount: number, resourceType?: string): boolean {
  if (contentLength < 500) return false;
  if (contentLength >= 10000 && kiCount <= 6) return true;
  if (contentLength >= 5000 && kiCount <= 4) return true;
  if (contentLength >= 3000 && kiCount <= 3) return true;
  if (contentLength >= 1500 && kiCount <= 2) return true;
  const kisPer1k = contentLength > 0 ? (kiCount * 1000) / contentLength : 0;
  // Type-aware thresholds
  const isTranscript = ['transcript', 'podcast', 'audio', 'podcast_episode'].includes((resourceType || '').toLowerCase());
  const minDensity = isTranscript ? 0.5 : 0.75;
  if (kisPer1k < minDensity && kiCount > 0) return true;
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
      const PAGE_SIZE = 1000;
      const { data: resources, error: rErr } = await supabase
        .from('resources' as any)
        .select('id, title, resource_type, enrichment_status, active_job_status, extraction_batch_status, extraction_batches_completed, extraction_batch_total, extraction_is_resumable, content_length, extraction_attempt_count, extraction_mode, extraction_passes_run, raw_candidate_counts, merged_candidate_count, kis_per_1k_chars, extraction_depth_bucket, under_extracted_flag, last_extraction_summary, extraction_method, last_extraction_run_id, last_extraction_run_status, last_extraction_returned_ki_count, last_extraction_deduped_ki_count, last_extraction_validated_ki_count, last_extraction_saved_ki_count, last_extraction_error, last_extraction_duration_ms, last_extraction_model, current_resource_ki_count, current_resource_kis_per_1k')
        .order('content_length', { ascending: false });
      if (rErr) throw rErr;

      let allRuns: any[] = [];
      let runsFrom = 0;
      while (true) {
        const { data: runs, error: runsErr } = await supabase
          .from('extraction_runs' as any)
          .select('resource_id, status, started_at, completed_at, chunks_failed, chunks_total, extraction_mode')
          .range(runsFrom, runsFrom + PAGE_SIZE - 1);
        if (runsErr) throw runsErr;
        if (!runs || runs.length === 0) break;
        allRuns = allRuns.concat(runs);
        if (runs.length < PAGE_SIZE) break;
        runsFrom += PAGE_SIZE;
      }

      let allBatches: any[] = [];
      let batchesFrom = 0;
      while (true) {
        const { data: batches, error: batchesErr } = await supabase
          .from('extraction_batches' as any)
          .select('resource_id, batch_index, batch_total, status, started_at, completed_at, error')
          .range(batchesFrom, batchesFrom + PAGE_SIZE - 1);
        if (batchesErr) throw batchesErr;
        if (!batches || batches.length === 0) break;
        allBatches = allBatches.concat(batches);
        if (batches.length < PAGE_SIZE) break;
        batchesFrom += PAGE_SIZE;
      }

      // Paginate KIs — include extraction_method for method mix
      let allKIs: any[] = [];
      let from = 0;
      while (true) {
        const { data: kis, error: kErr } = await supabase
          .from('knowledge_items' as any)
          .select('source_resource_id, active, applies_to_contexts, extraction_method')
          .range(from, from + PAGE_SIZE - 1);
        if (kErr) throw kErr;
        if (!kis || kis.length === 0) break;
        allKIs = allKIs.concat(kis);
        if (kis.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const kiMap = new Map<string, { total: number; active: number; withCtx: number }>();
      const runCountMap = new Map<string, number>();
      const latestRunMap = new Map<string, { status: string; started_at: string | null; completed_at: string | null; chunks_failed?: number | null; chunks_total?: number | null; extraction_mode?: string | null }>();
      const batchMap = new Map<string, any[]>();
      // Method mix from KIs (source of truth)
      const methodMix = { llm: 0, heuristic: 0, hybrid: 0, unknown: 0 };

      for (const run of allRuns) {
        if (!run.resource_id) continue;
        runCountMap.set(run.resource_id, (runCountMap.get(run.resource_id) || 0) + 1);
        const existing = latestRunMap.get(run.resource_id);
        const existingTs = existing?.completed_at || existing?.started_at || '';
        const nextTs = run.completed_at || run.started_at || '';
        if (!existing || nextTs > existingTs) {
          latestRunMap.set(run.resource_id, run);
        }
      }

      for (const batch of allBatches) {
        if (!batch.resource_id) continue;
        const rows = batchMap.get(batch.resource_id) || [];
        rows.push(batch);
        batchMap.set(batch.resource_id, rows);
      }

      for (const ki of allKIs) {
        const rid = ki.source_resource_id;
        if (rid) {
          if (!kiMap.has(rid)) kiMap.set(rid, { total: 0, active: 0, withCtx: 0 });
          const entry = kiMap.get(rid)!;
          entry.total++;
          if (ki.active) entry.active++;
          if (ki.active && ki.applies_to_contexts && (ki.applies_to_contexts as string[]).length > 0) entry.withCtx++;
        }

        // Aggregate method mix from actual KIs
        const method = ki.extraction_method;
        if (method === 'llm') methodMix.llm++;
        else if (method === 'heuristic') methodMix.heuristic++;
        else if (method === 'hybrid') methodMix.hybrid++;
        else methodMix.unknown++;
      }

      const dbTotalKIs = allKIs.length;
      const dbActiveKIs = allKIs.filter((k: any) => k.active).length;

      const rows: ResourceAuditRow[] = (resources ?? []).map((r: any) => {
        const ki = kiMap.get(r.id) ?? { total: 0, active: 0, withCtx: 0 };
        const resourceBatches = batchMap.get(r.id) || [];
        const dedupedBatches = new Map<number, any>();
        for (const batch of resourceBatches) {
          const existing = dedupedBatches.get(batch.batch_index);
          const rank = { completed: 5, running: 4, failed: 3, pending: 2 } as const;
          if (!existing || (rank[batch.status as keyof typeof rank] ?? 0) >= (rank[existing.status as keyof typeof rank] ?? 0)) {
            dedupedBatches.set(batch.batch_index, batch);
          }
        }
        const batchEntries = Array.from(dedupedBatches.values()).sort((a, b) => a.batch_index - b.batch_index);
        const cl = Number(r.content_length) || 0;
        const latestRun = latestRunMap.get(r.id) ?? null;

        // Use server-persisted current_resource_ki_count if available, else use counted KIs
        const kiTotal = (r.current_resource_ki_count != null && Number(r.current_resource_ki_count) > 0)
          ? Number(r.current_resource_ki_count)
          : ki.total;

        // Compute KIs/1k from real counts — never trust a potentially stale DB field alone
        const computedKisPer1k = cl > 0 ? Math.round((kiTotal * 1000 / cl) * 100) / 100 : 0;

        // Use DB-persisted if available AND non-zero when we have KIs, otherwise computed
        const dbKisPer1k = (r.current_resource_kis_per_1k != null && Number(r.current_resource_kis_per_1k) > 0)
          ? Number(r.current_resource_kis_per_1k)
          : (r.kis_per_1k_chars != null && Number(r.kis_per_1k_chars) > 0)
            ? Number(r.kis_per_1k_chars)
            : computedKisPer1k;

        // If DB says 0 but we actually have KIs, use computed value
        const finalKisPer1k = (dbKisPer1k === 0 && kiTotal > 0 && cl > 0) ? computedKisPer1k : dbKisPer1k;

        // Always recompute depth bucket and under-extracted from real counts — DB values may be stale
        const dbDepth = computeDepthBucket(finalKisPer1k, kiTotal);
        const dbUnderExtracted = computeUnderExtracted(cl, kiTotal, r.resource_type);
        const method = r.extraction_method || null;
        const batchTotal = batchEntries.reduce((max, batch) => Math.max(max, Number(batch.batch_total) || 0, batch.batch_index + 1), Number(r.extraction_batch_total) || 0);
        const completedBatches = batchEntries.filter(batch => batch.status === 'completed').length;
        const runningBatch = batchEntries.find(batch => batch.status === 'running');
        const staleRunning = !!runningBatch && !!runningBatch.started_at && (Date.now() - new Date(runningBatch.started_at).getTime() > 10 * 60 * 1000);
        const hasIncompleteBatches = batchTotal > 0 && completedBatches < batchTotal;
        const latestRunStatus = latestRunMap.get(r.id)?.status || r.last_extraction_run_status || null;
        const reconciledRunStatus = hasIncompleteBatches
          ? staleRunning
            ? 'partial_complete_resumable'
            : runningBatch
              ? 'running_batched'
              : 'partial_complete_resumable'
          : latestRunStatus;

        return {
          resource_id: r.id,
          title: r.title ?? '(untitled)',
          resource_type: r.resource_type ?? 'unknown',
          enrichment_status: r.enrichment_status ?? 'unknown',
          active_job_status: hasIncompleteBatches ? 'partial' : r.active_job_status,
          extraction_batch_status: hasIncompleteBatches
            ? staleRunning
              ? 'stale_resumable'
              : runningBatch
                ? `running_batch_${runningBatch.batch_index + 1}_of_${batchTotal}`
                : `resume_from_batch_${completedBatches + 1}_of_${batchTotal}`
            : r.extraction_batch_status,
          content_length: cl,
          ki_count_total: kiTotal,
          ki_count_active: ki.active,
          ki_with_context_count: ki.withCtx,
          extraction_attempt_count: runCountMap.get(r.id) ?? r.extraction_attempt_count ?? 0,
          extraction_batches_completed: completedBatches,
          extraction_batch_total: batchTotal,
          extraction_is_resumable: hasIncompleteBatches,
          kis_per_1k_chars: finalKisPer1k,
          under_extracted_flag: dbUnderExtracted,
          extraction_depth_bucket: dbDepth,
          extraction_mode: r.extraction_mode || 'unknown',
          extraction_passes_run: r.extraction_passes_run || [],
          raw_candidate_counts: r.raw_candidate_counts || {},
          merged_candidate_count: r.merged_candidate_count || 0,
          last_extraction_summary: r.last_extraction_summary || null,
          extraction_method: method,
          // Server-owned truth fields
          last_extraction_run_id: r.last_extraction_run_id || null,
          last_extraction_run_status: reconciledRunStatus,
          last_extraction_returned_ki_count: r.last_extraction_returned_ki_count ?? null,
          last_extraction_deduped_ki_count: r.last_extraction_deduped_ki_count ?? null,
          last_extraction_validated_ki_count: r.last_extraction_validated_ki_count ?? null,
          last_extraction_saved_ki_count: r.last_extraction_saved_ki_count ?? null,
          last_extraction_error: r.last_extraction_error || null,
          last_extraction_duration_ms: r.last_extraction_duration_ms ?? null,
          last_extraction_model: r.last_extraction_model || null,
          // Chunk failure diagnostics (from latest extraction_run)
          last_extraction_chunks_failed: latestRun?.chunks_failed ?? null,
          last_extraction_chunks_total: latestRun?.chunks_total ?? null,
          last_extraction_mode: latestRun?.extraction_mode ?? r.extraction_mode ?? null,
          // Per-resource operation progress
          active_job_type: r.active_job_type || null,
          active_job_step_label: r.active_job_step_label || null,
          active_job_progress_current: r.active_job_progress_current ?? null,
          active_job_progress_total: r.active_job_progress_total ?? null,
          active_job_progress_pct: r.active_job_progress_pct ?? null,
          active_job_updated_at: r.active_job_updated_at || null,
        };
      });

      // Guardrail: detect measurement integrity issues
      const resourcesWithKIs = rows.filter(r => r.ki_count_total > 0);
      const zeroKisPer1kWithKIs = resourcesWithKIs.filter(r => r.kis_per_1k_chars === 0);
      if (zeroKisPer1kWithKIs.length > 5 && resourcesWithKIs.length > 0) {
        console.warn(`[Coverage Audit] GUARDRAIL: ${zeroKisPer1kWithKIs.length}/${resourcesWithKIs.length} resources have KIs but show 0 KIs/1k — likely mapping issue`);
      }

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
