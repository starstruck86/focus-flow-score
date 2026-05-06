/**
 * Phase 4C — Latency Analytics Layer
 *
 * All latency queries use existing strategy_run_telemetry + task_runs tables.
 * No derived tables. Read-only. Defensive.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseStageLats, parseCost, parseArtifactGate } from './queries';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LatencySummary {
  total_runs: number;
  avg_total_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  slowest_stage: string | null;
  slowest_stage_avg_ms: number;
}

export interface StageLatency {
  stage: string;
  count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  contribution_pct: number;
}

export interface SlowestRun {
  id: string;
  task_type: string;
  status: string;
  completed_at: string | null;
  total_ms: number;
  cost_usd: number;
  stage_breakdown: Record<string, number>;
  regen_attempts: number;
}

export interface LatencyTrendPoint {
  date: string;
  avg_ms: number;
  p95_ms: number;
  run_count: number;
}

export interface BatchAnalytics {
  batch_index: number;
  count: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  avg_attempts: number;
  fallback_rate: number;
  failure_rate: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/* ------------------------------------------------------------------ */
/*  1. getLatencySummary                                               */
/* ------------------------------------------------------------------ */

export async function getLatencySummary(userId: string, days: number = 7): Promise<LatencySummary> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('task_runs')
    .select('meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .gte('created_at', since)
    .limit(500);

  if (error) throw error;

  const totals: number[] = [];
  const stageAccum = new Map<string, number[]>();

  for (const r of (data ?? []) as { meta: unknown }[]) {
    const lats = parseStageLats(r.meta);
    const total = Object.values(lats).reduce((s, v) => s + v, 0);
    if (total > 0) totals.push(total);
    for (const [stage, ms] of Object.entries(lats)) {
      const arr = stageAccum.get(stage) ?? [];
      arr.push(ms);
      stageAccum.set(stage, arr);
    }
  }

  totals.sort((a, b) => a - b);

  let slowestStage: string | null = null;
  let slowestAvg = 0;
  for (const [stage, vals] of stageAccum.entries()) {
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    if (avg > slowestAvg) { slowestAvg = avg; slowestStage = stage; }
  }

  return {
    total_runs: totals.length,
    avg_total_ms: totals.length > 0 ? totals.reduce((s, v) => s + v, 0) / totals.length : 0,
    p50_ms: percentile(totals, 0.5),
    p95_ms: percentile(totals, 0.95),
    p99_ms: percentile(totals, 0.99),
    max_ms: totals[totals.length - 1] ?? 0,
    slowest_stage: slowestStage,
    slowest_stage_avg_ms: slowestAvg,
  };
}

/* ------------------------------------------------------------------ */
/*  2. getLatencyByTaskType                                            */
/* ------------------------------------------------------------------ */

export async function getLatencyByTaskType(userId: string, days: number = 7): Promise<StageLatency[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('task_runs')
    .select('task_type, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .gte('created_at', since)
    .limit(500);

  if (error) throw error;

  const map = new Map<string, number[]>();
  let grandTotal = 0;

  for (const r of (data ?? []) as { task_type: string; meta: unknown }[]) {
    const lats = parseStageLats(r.meta);
    const total = Object.values(lats).reduce((s, v) => s + v, 0);
    if (total > 0) {
      const arr = map.get(r.task_type) ?? [];
      arr.push(total);
      map.set(r.task_type, arr);
      grandTotal += total;
    }
  }

  return Array.from(map.entries()).map(([stage, vals]) => {
    vals.sort((a, b) => a - b);
    const sum = vals.reduce((s, v) => s + v, 0);
    return {
      stage,
      count: vals.length,
      avg_ms: sum / vals.length,
      p50_ms: percentile(vals, 0.5),
      p95_ms: percentile(vals, 0.95),
      p99_ms: percentile(vals, 0.99),
      max_ms: vals[vals.length - 1],
      contribution_pct: grandTotal > 0 ? (sum / grandTotal) * 100 : 0,
    };
  }).sort((a, b) => b.avg_ms - a.avg_ms);
}

/* ------------------------------------------------------------------ */
/*  3. getLatencyByStage                                               */
/* ------------------------------------------------------------------ */

export async function getLatencyByStage(userId: string, days: number = 7): Promise<StageLatency[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('strategy_run_telemetry')
    .select('stage, duration_ms')
    .eq('user_id', userId)
    .gte('created_at', since)
    .not('duration_ms', 'is', null)
    .limit(1000);

  if (error) throw error;

  const map = new Map<string, number[]>();
  let grandTotal = 0;

  for (const r of (data ?? []) as { stage: string; duration_ms: number }[]) {
    const arr = map.get(r.stage) ?? [];
    arr.push(r.duration_ms);
    map.set(r.stage, arr);
    grandTotal += r.duration_ms;
  }

  return Array.from(map.entries()).map(([stage, vals]) => {
    vals.sort((a, b) => a - b);
    const sum = vals.reduce((s, v) => s + v, 0);
    return {
      stage,
      count: vals.length,
      avg_ms: sum / vals.length,
      p50_ms: percentile(vals, 0.5),
      p95_ms: percentile(vals, 0.95),
      p99_ms: percentile(vals, 0.99),
      max_ms: vals[vals.length - 1],
      contribution_pct: grandTotal > 0 ? (sum / grandTotal) * 100 : 0,
    };
  }).sort((a, b) => b.avg_ms - a.avg_ms);
}

/* ------------------------------------------------------------------ */
/*  4. getLatencyPercentiles                                           */
/* ------------------------------------------------------------------ */

export async function getLatencyPercentiles(userId: string, stage: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('strategy_run_telemetry')
    .select('duration_ms')
    .eq('user_id', userId)
    .eq('stage', stage)
    .gte('created_at', since)
    .not('duration_ms', 'is', null)
    .limit(500);

  if (error) throw error;
  const vals = ((data ?? []) as { duration_ms: number }[]).map(r => r.duration_ms).sort((a, b) => a - b);

  return {
    count: vals.length,
    avg: vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0,
    p50: percentile(vals, 0.5),
    p95: percentile(vals, 0.95),
    p99: percentile(vals, 0.99),
    max: vals[vals.length - 1] ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/*  5. getSlowestRuns                                                  */
/* ------------------------------------------------------------------ */

export async function getSlowestRuns(userId: string, limit: number = 10): Promise<SlowestRun[]> {
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, status, completed_at, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  return (data ?? [])
    .map((r: any) => {
      const lats = parseStageLats(r.meta);
      const total = Object.values(lats).reduce((s: number, v: number) => s + v, 0);
      const gate = parseArtifactGate(r.meta);
      return {
        id: r.id,
        task_type: r.task_type,
        status: r.status,
        completed_at: r.completed_at,
        total_ms: total,
        cost_usd: parseCost(r.meta) ?? 0,
        stage_breakdown: lats,
        regen_attempts: gate.regen_attempts ?? 0,
      };
    })
    .sort((a, b) => b.total_ms - a.total_ms)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/*  6. getLatencyTrend                                                 */
/* ------------------------------------------------------------------ */

export async function getLatencyTrend(userId: string, days: number = 30): Promise<LatencyTrendPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('task_runs')
    .select('created_at, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) throw error;

  const byDate = new Map<string, number[]>();
  for (const r of (data ?? []) as { created_at: string; meta: unknown }[]) {
    const date = r.created_at.slice(0, 10);
    const lats = parseStageLats(r.meta);
    const total = Object.values(lats).reduce((s, v) => s + v, 0);
    if (total > 0) {
      const arr = byDate.get(date) ?? [];
      arr.push(total);
      byDate.set(date, arr);
    }
  }

  return Array.from(byDate.entries()).map(([date, vals]) => {
    vals.sort((a, b) => a - b);
    return {
      date,
      avg_ms: vals.reduce((s, v) => s + v, 0) / vals.length,
      p95_ms: percentile(vals, 0.95),
      run_count: vals.length,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  7. getBatchExecutionAnalytics                                      */
/* ------------------------------------------------------------------ */

export async function getBatchExecutionAnalytics(userId: string, days: number = 30): Promise<BatchAnalytics[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Get runs to identify run IDs
  const { data: runs, error: runErr } = await supabase
    .from('task_runs')
    .select('id')
    .eq('user_id', userId)
    .eq('task_type', 'discovery_prep')
    .in('status', ['completed', 'failed'])
    .gte('created_at', since)
    .limit(100);

  if (runErr) throw runErr;
  const runIds = (runs ?? []).map((r: any) => r.id);
  if (runIds.length === 0) return [];

  const { data: sections, error: secErr } = await supabase
    .from('task_run_sections')
    .select('batch_index, status, primary_status, fallback_status, attempts, started_at, completed_at')
    .in('run_id', runIds)
    .limit(500);

  if (secErr) throw secErr;

  const map = new Map<number, {
    count: number;
    durations: number[];
    totalAttempts: number;
    fallbacks: number;
    failures: number;
  }>();

  for (const s of (sections ?? []) as any[]) {
    const idx = s.batch_index ?? 0;
    const agg = map.get(idx) ?? { count: 0, durations: [], totalAttempts: 0, fallbacks: 0, failures: 0 };
    agg.count++;
    if (s.started_at && s.completed_at) {
      agg.durations.push(new Date(s.completed_at).getTime() - new Date(s.started_at).getTime());
    }
    agg.totalAttempts += s.attempts ?? 1;
    if (s.fallback_status && s.fallback_status !== 'skipped') agg.fallbacks++;
    if (s.status === 'failed') agg.failures++;
    map.set(idx, agg);
  }

  return Array.from(map.entries())
    .map(([batch_index, v]) => ({
      batch_index,
      count: v.count,
      avg_duration_ms: v.durations.length > 0 ? v.durations.reduce((s, d) => s + d, 0) / v.durations.length : 0,
      max_duration_ms: v.durations.length > 0 ? Math.max(...v.durations) : 0,
      avg_attempts: v.count > 0 ? v.totalAttempts / v.count : 0,
      fallback_rate: v.count > 0 ? v.fallbacks / v.count : 0,
      failure_rate: v.count > 0 ? v.failures / v.count : 0,
    }))
    .sort((a, b) => a.batch_index - b.batch_index);
}
