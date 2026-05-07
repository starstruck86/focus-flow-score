/**
 * Phase 4G-1 — Template Fidelity Analytics
 *
 * Aggregates missing sections, attributes failures to batches/providers/models,
 * and provides the getMostMissingSections query for the reliability dashboard.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseArtifactGate } from './queries';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MissingSectionEntry {
  section_id: string;
  count: number;
  task_types: string[];
}

export interface BatchAttributionEntry {
  run_id: string;
  task_type: string;
  batch_index: number;
  section_ids: string[];
  model_used: string | null;
  primary_status: string | null;
  fallback_status: string | null;
  error: string | null;
  duration_ms: number | null;
  failure_category: string | null;
}

export interface ProviderFailureSummary {
  provider: string;
  model: string;
  error_type: string;
  count: number;
  avg_duration_ms: number;
}

export interface BatchFailureHeatmapEntry {
  batch_index: number;
  section_ids: string[];
  total: number;
  failed: number;
  failure_rate: number;
  avg_duration_ms: number;
  fallback_rate: number;
}

export interface ProviderBatchSuccess {
  batch_index: number;
  section_ids: string[];
  claude_success: number;
  openai_success: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

/**
 * Get the most frequently missing sections from failed template_fidelity gates.
 */
export async function getMostMissingSections(userId: string): Promise<MissingSectionEntry[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('task_type, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const sectionCounts = new Map<string, { count: number; task_types: Set<string> }>();

  for (const row of (data ?? []) as { task_type: string; meta: unknown }[]) {
    const gate = parseArtifactGate(row.meta);
    if (!gate.failed_dimensions.includes('template_fidelity')) continue;

    // Extract sections_failed from gate
    const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>;
    const gateObj = (meta.artifact_gate && typeof meta.artifact_gate === 'object' ? meta.artifact_gate : {}) as Record<string, unknown>;
    const sectionsFailed = Array.isArray(gateObj.sections_failed) ? gateObj.sections_failed as string[] : [];

    for (const s of sectionsFailed) {
      const entry = sectionCounts.get(s) || { count: 0, task_types: new Set<string>() };
      entry.count++;
      entry.task_types.add(row.task_type);
      sectionCounts.set(s, entry);
    }
  }

  return Array.from(sectionCounts.entries())
    .map(([id, e]) => ({ section_id: id, count: e.count, task_types: [...e.task_types] }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get batch-level attribution for failures — which batch → provider → model → latency.
 */
export async function getBatchAttribution(userId: string, limit = 100): Promise<BatchAttributionEntry[]> {
  const { data, error } = await supabase
    .from('task_run_sections')
    .select('run_id, batch_index, section_ids, status, primary_status, fallback_status, model_used, error, started_at, completed_at')
    .eq('user_id', userId)
    .in('status', ['failed', 'completed'])
    .order('completed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Get task_types for these run_ids
  const runIds = [...new Set((data ?? []).map((r: any) => r.run_id))];
  const taskTypeMap = new Map<string, string>();
  if (runIds.length > 0) {
    const { data: runs } = await supabase
      .from('task_runs')
      .select('id, task_type')
      .in('id', runIds.slice(0, 50));
    for (const r of (runs ?? []) as { id: string; task_type: string }[]) {
      taskTypeMap.set(r.id, r.task_type);
    }
  }

  return (data ?? []).map((r: any) => {
    const startMs = r.started_at ? new Date(r.started_at).getTime() : 0;
    const endMs = r.completed_at ? new Date(r.completed_at).getTime() : 0;
    const durationMs = startMs && endMs ? endMs - startMs : null;
    return {
      run_id: r.run_id,
      task_type: taskTypeMap.get(r.run_id) || 'unknown',
      batch_index: r.batch_index ?? -1,
      section_ids: r.section_ids ?? [],
      model_used: r.model_used ?? null,
      primary_status: r.primary_status ?? null,
      fallback_status: r.fallback_status ?? null,
      error: r.error ?? null,
      duration_ms: durationMs,
      failure_category: r.error ? classifyBatchError(r.error) : null,
    };
  });
}

/**
 * Batch failure heatmap — which batch indices fail most frequently.
 */
export async function getBatchFailureHeatmap(userId: string): Promise<BatchFailureHeatmapEntry[]> {
  const { data, error } = await supabase
    .from('task_run_sections')
    .select('batch_index, section_ids, status, primary_status, fallback_status, started_at, completed_at')
    .eq('user_id', userId)
    .order('batch_index', { ascending: true })
    .limit(500);

  if (error) throw error;

  const byBatch = new Map<number, { section_ids: string[]; total: number; failed: number; fallback: number; durations: number[] }>();

  for (const r of (data ?? []) as any[]) {
    const idx = r.batch_index ?? -1;
    const entry = byBatch.get(idx) || { section_ids: r.section_ids ?? [], total: 0, failed: 0, fallback: 0, durations: [] };
    entry.total++;
    if (r.status === 'failed') entry.failed++;
    if (r.fallback_status === 'success') entry.fallback++;
    if (r.section_ids) entry.section_ids = r.section_ids;
    if (r.started_at && r.completed_at) {
      entry.durations.push(new Date(r.completed_at).getTime() - new Date(r.started_at).getTime());
    }
    byBatch.set(idx, entry);
  }

  return Array.from(byBatch.entries())
    .map(([idx, e]) => ({
      batch_index: idx,
      section_ids: e.section_ids,
      total: e.total,
      failed: e.failed,
      failure_rate: e.total > 0 ? e.failed / e.total : 0,
      avg_duration_ms: e.durations.length > 0 ? e.durations.reduce((a, b) => a + b, 0) / e.durations.length : 0,
      fallback_rate: e.total > 0 ? e.fallback / e.total : 0,
    }))
    .sort((a, b) => a.batch_index - b.batch_index);
}

/**
 * Provider success rate by batch — which providers succeed/fail per batch.
 */
export async function getProviderSuccessByBatch(userId: string): Promise<ProviderBatchSuccess[]> {
  const { data, error } = await supabase
    .from('task_run_sections')
    .select('batch_index, section_ids, model_used, primary_status, fallback_status')
    .eq('user_id', userId)
    .limit(500);

  if (error) throw error;

  const byBatch = new Map<number, { section_ids: string[]; claude: number; openai: number; total: number }>();

  for (const r of (data ?? []) as any[]) {
    const idx = r.batch_index ?? -1;
    const entry = byBatch.get(idx) || { section_ids: r.section_ids ?? [], claude: 0, openai: 0, total: 0 };
    entry.total++;
    if (r.model_used === 'claude' || r.primary_status === 'success') entry.claude++;
    if (r.model_used === 'openai_fallback' || r.fallback_status === 'success') entry.openai++;
    if (r.section_ids) entry.section_ids = r.section_ids;
    byBatch.set(idx, entry);
  }

  return Array.from(byBatch.entries())
    .map(([idx, e]) => ({
      batch_index: idx,
      section_ids: e.section_ids,
      claude_success: e.claude,
      openai_success: e.openai,
      total: e.total,
    }))
    .sort((a, b) => a.batch_index - b.batch_index);
}

/**
 * Provider failure summary from telemetry — ranked by count.
 */
export async function getProviderFailureSummary(userId: string, days = 7): Promise<ProviderFailureSummary[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('strategy_run_telemetry')
    .select('provider, model, duration_ms, error, metadata')
    .eq('user_id', userId)
    .eq('success', false)
    .gte('created_at', since)
    .order('started_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  const byKey = new Map<string, { count: number; durations: number[] }>();
  for (const r of (data ?? []) as any[]) {
    const errorType = classifyTelemetryError(r.error, r.metadata);
    const key = `${r.provider || 'unknown'}|${r.model || 'unknown'}|${errorType}`;
    const entry = byKey.get(key) || { count: 0, durations: [] };
    entry.count++;
    if (r.duration_ms) entry.durations.push(r.duration_ms);
    byKey.set(key, entry);
  }

  return Array.from(byKey.entries())
    .map(([key, e]) => {
      const [provider, model, error_type] = key.split('|');
      return {
        provider,
        model,
        error_type,
        count: e.count,
        avg_duration_ms: e.durations.length > 0 ? e.durations.reduce((a, b) => a + b, 0) / e.durations.length : 0,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Fallback frequency — how often each task type uses fallback providers.
 */
export async function getFallbackFrequency(userId: string): Promise<{
  task_type: string;
  total_batches: number;
  fallback_used: number;
  fallback_rate: number;
}[]> {
  const { data, error } = await supabase
    .from('task_run_sections')
    .select('run_id, fallback_status')
    .eq('user_id', userId)
    .limit(500);

  if (error) throw error;

  // Get task types
  const runIds = [...new Set((data ?? []).map((r: any) => r.run_id))];
  const taskTypeMap = new Map<string, string>();
  if (runIds.length > 0) {
    const { data: runs } = await supabase
      .from('task_runs')
      .select('id, task_type')
      .in('id', runIds.slice(0, 50));
    for (const r of (runs ?? []) as { id: string; task_type: string }[]) {
      taskTypeMap.set(r.id, r.task_type);
    }
  }

  const byType = new Map<string, { total: number; fallback: number }>();
  for (const r of (data ?? []) as any[]) {
    const tt = taskTypeMap.get(r.run_id) || 'unknown';
    const entry = byType.get(tt) || { total: 0, fallback: 0 };
    entry.total++;
    if (r.fallback_status === 'success') entry.fallback++;
    byType.set(tt, entry);
  }

  return Array.from(byType.entries())
    .map(([tt, e]) => ({
      task_type: tt,
      total_batches: e.total,
      fallback_used: e.fallback,
      fallback_rate: e.total > 0 ? e.fallback / e.total : 0,
    }));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function classifyBatchError(error: string): string {
  const e = error.toLowerCase();
  if (e.includes('timeout') || e.includes('timed out')) return 'timeout';
  if (e.includes('429') || e.includes('rate')) return 'rate_limited';
  if (e.includes('402') || e.includes('credit')) return 'credit_exhaustion';
  if (e.includes('400')) return 'bad_request';
  if (/\b5\d{2}\b/.test(e)) return 'server_error';
  if (e.includes('no sections')) return 'malformed_output';
  return 'unknown';
}

function classifyTelemetryError(error: string | null, metadata: any): string {
  if (!error) return 'unknown';
  const e = error.toLowerCase();
  if (e.includes('timeout') || e.includes('timed out')) return 'timeout';
  if (e.includes('429')) return '429';
  if (e.includes('400')) return '400';
  if (/\b5\d{2}\b/.test(e)) return '5xx';
  if (e.includes('no sections') || e.includes('invalid json')) return 'malformed_output';
  return 'other';
}

/* ------------------------------------------------------------------ */
/*  Phase 4G-2 — Section Loss Tree & Alias Drift                      */
/* ------------------------------------------------------------------ */

export interface SectionLossEntry {
  section_id: string;
  loss_count: number;
  task_types: string[];
  source: 'integrity' | 'gate' | 'both';
}

export interface AliasDriftEntry {
  source_name: string;
  canonical_id: string;
  remapped_count: number;
}

export interface CorruptedBatchEntry {
  batch_index: number;
  section_ids: string[];
  collision_count: number;
  missing_count: number;
}

/**
 * Get the section loss tree — which sections disappear most, from both
 * integrity analysis and gate failures.
 */
export async function getSectionLossTree(userId: string): Promise<SectionLossEntry[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('task_type, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const lossCounts = new Map<string, { count: number; task_types: Set<string>; sources: Set<string> }>();

  for (const row of (data ?? []) as { task_type: string; meta: unknown }[]) {
    const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>;
    
    // From section_integrity
    const integrity = meta.section_integrity as Record<string, unknown> | undefined;
    if (integrity) {
      for (const sid of (integrity.missing_sections as string[] ?? [])) {
        const e = lossCounts.get(sid) || { count: 0, task_types: new Set(), sources: new Set() };
        e.count++;
        e.task_types.add(row.task_type);
        e.sources.add('integrity');
        lossCounts.set(sid, e);
      }
    }

    // From artifact gate
    const gate = parseArtifactGate(row.meta);
    if (gate.failed_dimensions.includes('template_fidelity')) {
      const gateObj = (meta.artifact_gate as Record<string, unknown>) ?? {};
      for (const sid of (gateObj.sections_failed as string[] ?? [])) {
        const e = lossCounts.get(sid) || { count: 0, task_types: new Set(), sources: new Set() };
        e.count++;
        e.task_types.add(row.task_type);
        e.sources.add('gate');
        lossCounts.set(sid, e);
      }
    }
  }

  return Array.from(lossCounts.entries())
    .map(([id, e]) => ({
      section_id: id,
      loss_count: e.count,
      task_types: [...e.task_types],
      source: e.sources.size > 1 ? 'both' as const : ([...e.sources][0] as 'integrity' | 'gate'),
    }))
    .sort((a, b) => b.loss_count - a.loss_count);
}

/**
 * Get merge corruption data — which batches cause merge collisions.
 */
export async function getMostCorruptedBatches(userId: string): Promise<CorruptedBatchEntry[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const batchData = new Map<number, { section_ids: string[]; collisions: number; missing: number }>();

  for (const row of (data ?? []) as { meta: unknown }[]) {
    const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>;
    const merge = meta.merge_integrity as Record<string, unknown> | undefined;
    if (!merge) continue;

    const collisions = (merge.merge_collision_count as number) ?? 0;
    const missingAfter = Array.isArray(merge.missing_after_merge) ? (merge.missing_after_merge as string[]).length : 0;
    
    // Aggregate at batch level from authoring_progressive
    const prog = meta.authoring_progressive as Record<string, unknown> | undefined;
    const totalBatches = (prog?.batches_total as number) ?? 16;
    for (let i = 0; i < totalBatches; i++) {
      const e = batchData.get(i) || { section_ids: [], collisions: 0, missing: 0 };
      if (collisions > 0) e.collisions += collisions;
      if (missingAfter > 0) e.missing += missingAfter;
      batchData.set(i, e);
    }
  }

  return Array.from(batchData.entries())
    .filter(([_, e]) => e.collisions > 0 || e.missing > 0)
    .map(([idx, e]) => ({
      batch_index: idx,
      section_ids: e.section_ids,
      collision_count: e.collisions,
      missing_count: e.missing,
    }))
    .sort((a, b) => (b.collision_count + b.missing_count) - (a.collision_count + a.missing_count));
}
