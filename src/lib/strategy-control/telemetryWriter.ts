// ════════════════════════════════════════════════════════════════
// Phase 4A — Telemetry Writer (client-side mirror)
//
// Identical logic to supabase/functions/_shared/strategy-orchestrator/telemetryWriter.ts
// for use in vitest tests. Kept in sync manually.
// ════════════════════════════════════════════════════════════════

/** Shape of a single telemetry row to be written. */
export interface TelemetryRow {
  run_id: string;
  user_id: string;
  task_type: string;
  stage: string;
  provider?: string;
  model?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  success: boolean;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-5":       { input: 0.01, output: 0.03 },
  "gpt-5-mini":  { input: 0.003, output: 0.012 },
  "gpt-4o":      { input: 0.005, output: 0.015 },
  "claude-sonnet-4-5-20250929": { input: 0.003, output: 0.015 },
  "sonar-pro":   { input: 0.003, output: 0.015 },
};

export function estimateCostUsd(model: string | undefined, usage: ProviderUsage | undefined): number {
  if (!model || !usage) return 0;
  const rates = COST_PER_1K[model];
  if (!rates) return 0;
  const inputCost = ((usage.input_tokens ?? 0) / 1000) * rates.input;
  const outputCost = ((usage.output_tokens ?? 0) / 1000) * rates.output;
  return Math.round((inputCost + outputCost) * 10000) / 10000;
}

export interface StageTelemetry {
  finish: (result: {
    success: boolean;
    usage?: ProviderUsage;
    error?: string;
    metadata?: Record<string, unknown>;
  }) => TelemetryRow;
}

export class TelemetryCollector {
  private rows: TelemetryRow[] = [];
  private readonly runId: string;
  private readonly userId: string;
  private readonly taskType: string;

  constructor(runId: string, userId: string, taskType: string) {
    this.runId = runId;
    this.userId = userId;
    this.taskType = taskType;
  }

  record(stage: string, data: Omit<TelemetryRow, "run_id" | "user_id" | "task_type" | "stage">): TelemetryRow {
    const row: TelemetryRow = {
      run_id: this.runId,
      user_id: this.userId,
      task_type: this.taskType,
      stage,
      ...data,
    };
    this.rows.push(row);
    return row;
  }

  startStage(stage: string, opts?: { provider?: string; model?: string }): StageTelemetry {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    return {
      finish: (result) => {
        const durationMs = Date.now() - startMs;
        return this.record(stage, {
          provider: opts?.provider,
          model: opts?.model,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
          success: result.success,
          input_tokens: result.usage?.input_tokens,
          output_tokens: result.usage?.output_tokens,
          total_tokens: result.usage?.total_tokens,
          error: result.error?.slice(0, 500),
          metadata: result.metadata,
        });
      },
    };
  }

  getRows(): readonly TelemetryRow[] {
    return [...this.rows];
  }

  aggregateTokens() {
    let totalInput = 0;
    let totalOutput = 0;
    const byStage: Record<string, { input: number; output: number }> = {};
    for (const row of this.rows) {
      const inp = row.input_tokens ?? 0;
      const out = row.output_tokens ?? 0;
      totalInput += inp;
      totalOutput += out;
      if (!byStage[row.stage]) byStage[row.stage] = { input: 0, output: 0 };
      byStage[row.stage].input += inp;
      byStage[row.stage].output += out;
    }
    return { total_input: totalInput, total_output: totalOutput, by_stage: byStage };
  }

  aggregateLatencies(): Record<string, number> {
    const latencies: Record<string, number> = {};
    for (const row of this.rows) {
      if (row.duration_ms != null) {
        latencies[row.stage] = (latencies[row.stage] ?? 0) + row.duration_ms;
      }
    }
    return latencies;
  }

  providerOutcomes() {
    return this.rows
      .filter((r) => r.provider)
      .map((r) => ({
        stage: r.stage,
        provider: r.provider!,
        model: r.model ?? "unknown",
        success: r.success,
        duration_ms: r.duration_ms ?? 0,
      }));
  }

  estimateTotalCost(): number {
    let total = 0;
    for (const row of this.rows) {
      total += estimateCostUsd(row.model, {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
      });
    }
    return Math.round(total * 10000) / 10000;
  }

  buildMetaEnrichment(): Record<string, unknown> {
    return {
      stage_latencies: this.aggregateLatencies(),
      token_usage: this.aggregateTokens(),
      cost_estimate_usd: this.estimateTotalCost(),
      provider_outcomes: this.providerOutcomes(),
    };
  }

  async flush(supabase: any): Promise<{ written: number; error?: string }> {
    if (this.rows.length === 0) return { written: 0 };
    try {
      const payload = this.rows.map((r) => ({
        run_id: r.run_id,
        user_id: r.user_id,
        task_type: r.task_type,
        stage: r.stage,
        provider: r.provider ?? null,
        model: r.model ?? null,
        started_at: r.started_at,
        completed_at: r.completed_at ?? null,
        duration_ms: r.duration_ms ?? null,
        success: r.success,
        input_tokens: r.input_tokens ?? null,
        output_tokens: r.output_tokens ?? null,
        total_tokens: r.total_tokens ?? null,
        error: r.error ?? null,
        metadata: r.metadata ?? {},
      }));
      const { error } = await supabase
        .from("strategy_run_telemetry")
        .insert(payload);
      if (error) {
        console.warn(`[telemetry:flush] insert failed (non-fatal): ${String(error.message || error).slice(0, 200)}`);
        return { written: 0, error: String(error.message || error).slice(0, 200) };
      }
      return { written: payload.length };
    } catch (e: any) {
      console.warn(`[telemetry:flush] exception (non-fatal): ${String(e?.message || e).slice(0, 200)}`);
      return { written: 0, error: String(e?.message || e).slice(0, 200) };
    }
  }
}
