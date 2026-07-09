/**
 * Phase 4C — Cost Analytics Layer
 *
 * All cost queries use existing strategy_run_telemetry + task_runs tables.
 * No derived tables. Read-only. Defensive.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseCost, parseTokenUsage, parseArtifactGate } from './queries';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CostSummary {
  total_usd: number;
  run_count: number;
  successful_runs: number;
  failed_runs: number;
  avg_per_run: number;
  avg_per_successful_run: number;
  failed_run_waste_usd: number;
  regen_waste_usd: number;
}

export interface CostByDimension {
  key: string;
  total_usd: number;
  count: number;
  avg_usd: number;
}

export interface ExpensiveRun {
  id: string;
  task_type: string;
  status: string;
  completed_at: string | null;
  cost_usd: number;
  tokens_in: number | null;
  tokens_out: number | null;
  gate_pass: boolean | undefined;
  regen_attempts: number;
}

export interface FailedRunWaste {
  total_waste_usd: number;
  by_task_type: CostByDimension[];
  by_failed_dimension: CostByDimension[];
  regen_waste_usd: number;
  regen_waste_pct: number;
}

/* ------------------------------------------------------------------ */
/*  Internal data loader                                               */
/* ------------------------------------------------------------------ */

interface RunCostRow {
  id: string;
  task_type: string;
  status: string;
  completed_at: string | null;
  meta: Record<string, unknown> | null;
}

async function loadRuns(userId: string, days: number): Promise<RunCostRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, status, completed_at, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as RunCostRow[];
}

async function loadTelemetry(userId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('strategy_run_telemetry')
    .select('run_id, task_type, stage, provider, model, duration_ms, input_tokens, output_tokens, total_tokens, success')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('started_at', { ascending: false })
    .limit(1000);

  if (error) throw error;
  return data ?? [];
}

/* ------------------------------------------------------------------ */
/*  1. getCostSummary                                                  */
/* ------------------------------------------------------------------ */

export async function getCostSummary(userId: string, days: number = 7): Promise<CostSummary> {
  const runs = await loadRuns(userId, days);

  let totalUsd = 0;
  let successfulRuns = 0;
  let failedRuns = 0;
  let successCost = 0;
  let failedCost = 0;
  let regenCost = 0;

  for (const r of runs) {
    const cost = parseCost(r.meta) ?? 0;
    totalUsd += cost;
    const gate = parseArtifactGate(r.meta);
    if (r.status === 'completed') {
      successfulRuns++;
      successCost += cost;
      if ((gate.regen_attempts ?? 0) > 0) {
        // Rough estimate: regen cost ≈ cost × (regen_attempts / (regen_attempts + 1))
        const regenFraction = (gate.regen_attempts ?? 0) / ((gate.regen_attempts ?? 0) + 1);
        regenCost += cost * regenFraction;
      }
    } else {
      failedRuns++;
      failedCost += cost;
    }
  }

  return {
    total_usd: totalUsd,
    run_count: runs.length,
    successful_runs: successfulRuns,
    failed_runs: failedRuns,
    avg_per_run: runs.length > 0 ? totalUsd / runs.length : 0,
    avg_per_successful_run: successfulRuns > 0 ? successCost / successfulRuns : 0,
    failed_run_waste_usd: failedCost,
    regen_waste_usd: Math.round(regenCost * 10000) / 10000,
  };
}

/* ------------------------------------------------------------------ */
/*  2. getCostByTaskType                                               */
/* ------------------------------------------------------------------ */

export async function getCostByTaskType(userId: string, days: number = 7): Promise<CostByDimension[]> {
  const runs = await loadRuns(userId, days);
  const map = new Map<string, { total: number; count: number }>();

  for (const r of runs) {
    const cost = parseCost(r.meta) ?? 0;
    const agg = map.get(r.task_type) ?? { total: 0, count: 0 };
    agg.total += cost;
    agg.count++;
    map.set(r.task_type, agg);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({ key, total_usd: v.total, count: v.count, avg_usd: v.count > 0 ? v.total / v.count : 0 }))
    .sort((a, b) => b.total_usd - a.total_usd);
}

/* ------------------------------------------------------------------ */
/*  3. getCostByProvider                                               */
/* ------------------------------------------------------------------ */

export async function getCostByProvider(userId: string, days: number = 7): Promise<CostByDimension[]> {
  const telemetry = await loadTelemetry(userId, days);
  const map = new Map<string, { total: number; count: number }>();

  // Use same cost estimation as telemetryWriter
  const COST_PER_1K: Record<string, { input: number; output: number }> = {
    "gpt-5": { input: 0.01, output: 0.03 },
    "gpt-5-mini": { input: 0.003, output: 0.012 },
    "gpt-4o": { input: 0.005, output: 0.015 },
    "claude-sonnet-4-5-20250929": { input: 0.003, output: 0.015 },
    "sonar-pro": { input: 0.003, output: 0.015 },
  };

  for (const r of telemetry) {
    const key = `${r.provider ?? 'unknown'}/${r.model ?? 'unknown'}`;
    const rates = COST_PER_1K[r.model ?? ''];
    let cost = 0;
    if (rates) {
      cost = ((r.input_tokens ?? 0) / 1000) * rates.input + ((r.output_tokens ?? 0) / 1000) * rates.output;
    }
    const agg = map.get(key) ?? { total: 0, count: 0 };
    agg.total += cost;
    agg.count++;
    map.set(key, agg);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({ key, total_usd: v.total, count: v.count, avg_usd: v.count > 0 ? v.total / v.count : 0 }))
    .sort((a, b) => b.total_usd - a.total_usd);
}

/* ------------------------------------------------------------------ */
/*  4. getCostByStage                                                  */
/* ------------------------------------------------------------------ */

export async function getCostByStage(userId: string, days: number = 7): Promise<CostByDimension[]> {
  const telemetry = await loadTelemetry(userId, days);
  const COST_PER_1K: Record<string, { input: number; output: number }> = {
    "gpt-5": { input: 0.01, output: 0.03 },
    "gpt-5-mini": { input: 0.003, output: 0.012 },
    "gpt-4o": { input: 0.005, output: 0.015 },
    "claude-sonnet-4-5-20250929": { input: 0.003, output: 0.015 },
    "sonar-pro": { input: 0.003, output: 0.015 },
  };

  const map = new Map<string, { total: number; count: number }>();
  for (const r of telemetry) {
    const rates = COST_PER_1K[r.model ?? ''];
    let cost = 0;
    if (rates) {
      cost = ((r.input_tokens ?? 0) / 1000) * rates.input + ((r.output_tokens ?? 0) / 1000) * rates.output;
    }
    const agg = map.get(r.stage) ?? { total: 0, count: 0 };
    agg.total += cost;
    agg.count++;
    map.set(r.stage, agg);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({ key, total_usd: v.total, count: v.count, avg_usd: v.count > 0 ? v.total / v.count : 0 }))
    .sort((a, b) => b.total_usd - a.total_usd);
}

/* ------------------------------------------------------------------ */
/*  5. getMostExpensiveRuns                                             */
/* ------------------------------------------------------------------ */

export async function getMostExpensiveRuns(userId: string, limit: number = 10): Promise<ExpensiveRun[]> {
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
      const tokens = parseTokenUsage(r.meta);
      const gate = parseArtifactGate(r.meta);
      return {
        id: r.id,
        task_type: r.task_type,
        status: r.status,
        completed_at: r.completed_at,
        cost_usd: parseCost(r.meta) ?? 0,
        tokens_in: tokens.input,
        tokens_out: tokens.output,
        gate_pass: gate.pass,
        regen_attempts: gate.regen_attempts ?? 0,
      };
    })
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/*  6. getAverageCostPerSuccessfulRun                                  */
/* ------------------------------------------------------------------ */

export async function getAverageCostPerSuccessfulRun(userId: string, taskType?: string): Promise<number> {
  let query = supabase
    .from('task_runs')
    .select('meta')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(100);

  if (taskType) query = query.eq('task_type', taskType);
  const { data, error } = await query;
  if (error) throw error;

  const costs = (data ?? []).map((r: any) => parseCost(r.meta) ?? 0);
  if (costs.length === 0) return 0;
  return costs.reduce((s, v) => s + v, 0) / costs.length;
}

/* ------------------------------------------------------------------ */
/*  7. getFailedRunCostWaste                                           */
/* ------------------------------------------------------------------ */

export async function getFailedRunCostWaste(userId: string, days: number = 30): Promise<FailedRunWaste> {
  const runs = await loadRuns(userId, days);
  const failedRuns = runs.filter(r => r.status === 'failed');
  const allCost = runs.reduce((s, r) => s + (parseCost(r.meta) ?? 0), 0);

  let totalWaste = 0;
  const byType = new Map<string, { total: number; count: number }>();
  const byDim = new Map<string, { total: number; count: number }>();

  for (const r of failedRuns) {
    const cost = parseCost(r.meta) ?? 0;
    totalWaste += cost;

    const typeAgg = byType.get(r.task_type) ?? { total: 0, count: 0 };
    typeAgg.total += cost;
    typeAgg.count++;
    byType.set(r.task_type, typeAgg);

    const gate = parseArtifactGate(r.meta);
    for (const dim of gate.failed_dimensions) {
      const dimAgg = byDim.get(dim) ?? { total: 0, count: 0 };
      dimAgg.total += cost;
      dimAgg.count++;
      byDim.set(dim, dimAgg);
    }
  }

  // Regen waste from successful runs
  const successRuns = runs.filter(r => r.status === 'completed');
  let regenWaste = 0;
  for (const r of successRuns) {
    const cost = parseCost(r.meta) ?? 0;
    const gate = parseArtifactGate(r.meta);
    if ((gate.regen_attempts ?? 0) > 0) {
      regenWaste += cost * ((gate.regen_attempts ?? 0) / ((gate.regen_attempts ?? 0) + 1));
    }
  }

  return {
    total_waste_usd: totalWaste,
    by_task_type: Array.from(byType.entries())
      .map(([key, v]) => ({ key, total_usd: v.total, count: v.count, avg_usd: v.count > 0 ? v.total / v.count : 0 }))
      .sort((a, b) => b.total_usd - a.total_usd),
    by_failed_dimension: Array.from(byDim.entries())
      .map(([key, v]) => ({ key, total_usd: v.total, count: v.count, avg_usd: v.count > 0 ? v.total / v.count : 0 }))
      .sort((a, b) => b.total_usd - a.total_usd),
    regen_waste_usd: Math.round(regenWaste * 10000) / 10000,
    regen_waste_pct: allCost > 0 ? (regenWaste / allCost) * 100 : 0,
  };
}
