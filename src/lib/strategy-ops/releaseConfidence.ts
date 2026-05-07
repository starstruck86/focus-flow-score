/**
 * Phase 4C — Release Confidence Scorer
 *
 * Computes a health/release-readiness score from recent telemetry.
 * Powers future deploy gating.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseCost, parseArtifactGate, parseAnomalyFlags, parseStageLats } from './queries';

export interface ReleaseConfidence {
  score: number;           // 0-100
  blockers: string[];
  warnings: string[];
  healthy: boolean;
  metrics: {
    success_rate: number;
    regen_rate: number;
    anomaly_rate: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
    evidence_freshness_hours: number | null;
    failed_dimension_trends: Record<string, number>;
    sample_size: number;
    // Phase 4G-1 additions
    provider_failure_rate: number;
    timeout_rate: number;
    batch_failure_rate: number;
    template_fidelity_rate: number;
  };
}

export async function computeReleaseConfidence(userId: string, days: number = 7): Promise<ReleaseConfidence> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('task_runs')
    .select('id, task_type, status, completed_at, meta')
    .eq('user_id', userId)
    .in('status', ['completed', 'failed'])
    .gte('created_at', since)
    .order('completed_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  const runs = (data ?? []) as { id: string; task_type: string; status: string; completed_at: string | null; meta: unknown }[];

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (runs.length === 0) {
    return {
      score: 0,
      blockers: ['No runs in evaluation window'],
      warnings: [],
      healthy: false,
      metrics: { success_rate: 0, regen_rate: 0, anomaly_rate: 0, avg_latency_ms: 0, avg_cost_usd: 0, evidence_freshness_hours: null, failed_dimension_trends: {}, sample_size: 0, provider_failure_rate: 0, timeout_rate: 0, batch_failure_rate: 0, template_fidelity_rate: 0 },
    };
  }

  const completed = runs.filter(r => r.status === 'completed');
  const successRate = completed.length / runs.length;
  let regenCount = 0;
  let anomalyCount = 0;
  let totalLatency = 0;
  let totalCost = 0;
  let latencyCount = 0;
  const failedDims: Record<string, number> = {};

  for (const r of runs) {
    const gate = parseArtifactGate(r.meta);
    if ((gate.regen_attempts ?? 0) > 0) regenCount++;
    const flags = parseAnomalyFlags(r.meta);
    if (flags.length > 0) anomalyCount++;
    const lats = parseStageLats(r.meta);
    const total = Object.values(lats).reduce((s, v) => s + v, 0);
    if (total > 0) { totalLatency += total; latencyCount++; }
    totalCost += parseCost(r.meta) ?? 0;
    for (const d of gate.failed_dimensions) {
      failedDims[d] = (failedDims[d] ?? 0) + 1;
    }
  }

  const regenRate = regenCount / runs.length;
  const anomalyRate = anomalyCount / runs.length;
  const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
  const avgCost = totalCost / runs.length;

  // Evidence freshness: hours since last completed run
  const lastCompleted = completed[0]?.completed_at;
  const freshness = lastCompleted ? (Date.now() - new Date(lastCompleted).getTime()) / 3_600_000 : null;

  // Scoring
  let score = 100;

  // Success rate impact (most important)
  if (successRate < 0.5) { score -= 40; blockers.push(`Success rate critically low: ${(successRate * 100).toFixed(0)}%`); }
  else if (successRate < 0.7) { score -= 25; blockers.push(`Success rate below threshold: ${(successRate * 100).toFixed(0)}%`); }
  else if (successRate < 0.85) { score -= 10; warnings.push(`Success rate marginal: ${(successRate * 100).toFixed(0)}%`); }

  // Regen rate
  if (regenRate > 0.5) { score -= 15; warnings.push(`High regen rate: ${(regenRate * 100).toFixed(0)}%`); }
  else if (regenRate > 0.3) { score -= 5; }

  // Anomaly rate
  if (anomalyRate > 0.3) { score -= 15; warnings.push(`Elevated anomaly rate: ${(anomalyRate * 100).toFixed(0)}%`); }
  else if (anomalyRate > 0.1) { score -= 5; }

  // Latency
  if (avgLatency > 120_000) { score -= 10; warnings.push(`Avg latency high: ${(avgLatency / 1000).toFixed(0)}s`); }

  // Freshness
  if (freshness != null && freshness > 168) { score -= 10; warnings.push('No successful runs in 7+ days'); }
  else if (freshness != null && freshness > 48) { score -= 5; warnings.push('Last success >48h ago'); }

  // Sample size
  if (runs.length < 5) { score -= 10; warnings.push(`Small sample size: ${runs.length} runs`); }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    blockers,
    warnings,
    healthy: score >= 70 && blockers.length === 0,
    metrics: {
      success_rate: successRate,
      regen_rate: regenRate,
      anomaly_rate: anomalyRate,
      avg_latency_ms: avgLatency,
      avg_cost_usd: avgCost,
      evidence_freshness_hours: freshness != null ? Math.round(freshness * 10) / 10 : null,
      failed_dimension_trends: failedDims,
      sample_size: runs.length,
    },
  };
}
