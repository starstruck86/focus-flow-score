/**
 * Strategy Operations Dashboard — Query Layer
 *
 * All queries for the /admin/ops dashboard. Read-only, typed, defensive.
 * Uses SQL aggregations where possible to avoid large client-side scans.
 */
import { supabase } from '@/integrations/supabase/client';

/* ------------------------------------------------------------------ */
/*  Shared types                                                       */
/* ------------------------------------------------------------------ */

export interface EvidenceRow {
  id: string;
  task_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  meta: Record<string, unknown> | null;
  draft_output: unknown;
  review_output: unknown;
}

export interface TelemetryRow {
  id: string;
  run_id: string;
  task_type: string;
  stage: string;
  provider: string | null;
  model: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  success: boolean | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface TaskRunSectionRow {
  id: string;
  run_id: string;
  batch_index: number | null;
  section_ids: string[] | null;
  status: string | null;
  primary_status: string | null;
  fallback_status: string | null;
  attempts: number | null;
  model_used: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface RunListRow {
  id: string;
  task_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  meta: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeMeta(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) return meta as Record<string, unknown>;
  return {};
}

export function parseArtifactGate(meta: unknown) {
  const m = safeMeta(meta);
  const gate = safeMeta(m.artifact_gate);
  return {
    pass: gate.pass as boolean | undefined,
    failed_dimensions: (gate.failed_dimensions as string[]) ?? [],
    sections_passed: gate.sections_passed as number | undefined,
    sections_failed: gate.sections_failed as number | undefined,
    regen_attempts: gate.regen_attempts as number | undefined,
    gate_latency_ms: gate.gate_latency_ms as number | undefined,
  };
}

export function parseReadability(meta: unknown) {
  const m = safeMeta(meta);
  return m.readability_normalization as Record<string, unknown> | undefined;
}

export function parseAnomalyFlags(meta: unknown): string[] {
  const m = safeMeta(meta);
  const flags = m.anomaly_flags;
  if (Array.isArray(flags)) return flags as string[];
  return [];
}

export function parseStageLats(meta: unknown): Record<string, number> {
  const m = safeMeta(meta);
  const sl = m.stage_latencies;
  if (sl && typeof sl === 'object') return sl as Record<string, number>;
  return {};
}

export function parseCost(meta: unknown): number | null {
  const m = safeMeta(meta);
  const c = m.cost_estimate_usd;
  if (typeof c === 'number') return c;
  if (typeof c === 'string') { const n = parseFloat(c); return isNaN(n) ? null : n; }
  return null;
}

export function parseTokenUsage(meta: unknown) {
  const m = safeMeta(meta);
  const t = safeMeta(m.token_usage);
  return {
    input: (t.input_tokens as number) ?? null,
    output: (t.output_tokens as number) ?? null,
    total: (t.total_tokens as number) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  1. Evidence — latest successful run per task_type                  */
/* ------------------------------------------------------------------ */

export async function fetchEvidenceByType(userId: string): Promise<EvidenceRow[]> {
  // Get latest 50 completed runs, then dedupe client-side per task_type (small set)
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, status, created_at, completed_at, meta, draft_output, review_output')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  const rows = (data ?? []) as EvidenceRow[];

  // Dedupe: keep newest per task_type
  const seen = new Set<string>();
  return rows.filter(r => {
    if (seen.has(r.task_type)) return false;
    seen.add(r.task_type);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  2. Gates — aggregate gate stats from recent runs                   */
/* ------------------------------------------------------------------ */

export interface GateAggRow {
  task_type: string;
  total: number;
  passed: number;
  failed: number;
  regen_triggered: number;
  regen_succeeded: number;
  failed_dimensions: Record<string, number>;
  readability_normalized: number;
}

export async function fetchGateAggregates(userId: string): Promise<GateAggRow[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('task_type, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const byType = new Map<string, GateAggRow>();
  for (const r of (data ?? []) as { task_type: string; meta: unknown }[]) {
    let agg = byType.get(r.task_type);
    if (!agg) {
      agg = { task_type: r.task_type, total: 0, passed: 0, failed: 0, regen_triggered: 0, regen_succeeded: 0, failed_dimensions: {}, readability_normalized: 0 };
      byType.set(r.task_type, agg);
    }
    agg.total++;
    const gate = parseArtifactGate(r.meta);
    if (gate.pass === true) agg.passed++;
    if (gate.pass === false) agg.failed++;
    if ((gate.regen_attempts ?? 0) > 0) {
      agg.regen_triggered++;
      if (gate.pass === true) agg.regen_succeeded++;
    }
    for (const d of gate.failed_dimensions) {
      agg.failed_dimensions[d] = (agg.failed_dimensions[d] ?? 0) + 1;
    }
    if (parseReadability(r.meta)) agg.readability_normalized++;
  }

  return Array.from(byType.values());
}

/* ------------------------------------------------------------------ */
/*  3. Latency — from strategy_run_telemetry                           */
/* ------------------------------------------------------------------ */

export async function fetchLatencyData(userId: string, days: number = 7): Promise<TelemetryRow[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('strategy_run_telemetry')
    .select('id, run_id, task_type, stage, provider, model, duration_ms, input_tokens, output_tokens, total_tokens, success, error, started_at, completed_at, metadata')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('started_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as TelemetryRow[];
}

/* ------------------------------------------------------------------ */
/*  4. Costs — from telemetry + task_runs.meta                         */
/* ------------------------------------------------------------------ */

export interface CostRow {
  id: string;
  task_type: string;
  completed_at: string | null;
  cost_estimate_usd: number | null;
  token_input: number | null;
  token_output: number | null;
}

export async function fetchCostData(userId: string): Promise<CostRow[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, completed_at, meta')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const tokens = parseTokenUsage(r.meta);
    return {
      id: r.id,
      task_type: r.task_type,
      completed_at: r.completed_at,
      cost_estimate_usd: parseCost(r.meta),
      token_input: tokens.input,
      token_output: tokens.output,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  5. Anomalies — runs with anomaly_flags                             */
/* ------------------------------------------------------------------ */

export interface AnomalyRow {
  id: string;
  task_type: string;
  status: string;
  completed_at: string | null;
  flags: string[];
  meta: Record<string, unknown> | null;
}

export async function fetchAnomalyRuns(userId: string): Promise<AnomalyRow[]> {
  // Fetch recent runs and filter client-side for those with anomaly_flags
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, status, completed_at, meta')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? [])
    .map((r: any) => ({
      id: r.id,
      task_type: r.task_type,
      status: r.status,
      completed_at: r.completed_at,
      flags: parseAnomalyFlags(r.meta),
      meta: r.meta,
    }))
    .filter(r => r.flags.length > 0);
}

/* ------------------------------------------------------------------ */
/*  6. Run Drilldown                                                   */
/* ------------------------------------------------------------------ */

export async function fetchRunDetail(runId: string) {
  const [runRes, telRes, secRes] = await Promise.all([
    supabase.from('task_runs')
      .select('id, task_type, status, created_at, completed_at, meta, draft_output, review_output, error, progress_step')
      .eq('id', runId)
      .maybeSingle(),
    supabase.from('strategy_run_telemetry')
      .select('*')
      .eq('run_id', runId)
      .order('started_at', { ascending: true })
      .limit(50),
    supabase.from('task_run_sections')
      .select('id, run_id, batch_index, section_ids, status, primary_status, fallback_status, attempts, model_used, error, started_at, completed_at')
      .eq('run_id', runId)
      .order('batch_index', { ascending: true })
      .limit(50),
  ]);

  return {
    run: runRes.data as (EvidenceRow & { error: string | null; progress_step: string | null }) | null,
    telemetry: (telRes.data ?? []) as TelemetryRow[],
    sections: (secRes.data ?? []) as TaskRunSectionRow[],
    errors: [runRes.error, telRes.error, secRes.error].filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/*  7. Run list for drilldown selector                                 */
/* ------------------------------------------------------------------ */

export async function fetchRecentRuns(userId: string, limit = 30): Promise<RunListRow[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, status, created_at, completed_at, meta')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as RunListRow[];
}
