import { describe, it, expect, vi } from "vitest";
import { TelemetryCollector, estimateCostUsd } from "../telemetryWriter";

describe("TelemetryCollector", () => {
  const RUN_ID = "run-001";
  const USER_ID = "user-001";
  const TASK_TYPE = "account_brief";

  it("records stage telemetry with correct shape", () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    const row = tc.record("synthesis", {
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:05Z",
      duration_ms: 5000,
      success: true,
      input_tokens: 1000,
      output_tokens: 2000,
      provider: "openai",
      model: "gpt-5-mini",
    });

    expect(row.run_id).toBe(RUN_ID);
    expect(row.user_id).toBe(USER_ID);
    expect(row.task_type).toBe(TASK_TYPE);
    expect(row.stage).toBe("synthesis");
    expect(row.success).toBe(true);
    expect(tc.getRows()).toHaveLength(1);
  });

  it("startStage captures timing automatically", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
      const stage = tc.startStage("research", { provider: "perplexity", model: "sonar-pro" });

      vi.advanceTimersByTime(10);

      const row = stage.finish({
        success: true,
        usage: { input_tokens: 500, output_tokens: 800, total_tokens: 1300 },
      });

      expect(row.duration_ms).toBe(10);
      expect(row.provider).toBe("perplexity");
      expect(row.model).toBe("sonar-pro");
      expect(row.input_tokens).toBe(500);
      expect(row.output_tokens).toBe(800);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aggregateTokens sums across stages", () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    tc.record("research", { started_at: "2026-01-01T00:00:00Z", success: true, input_tokens: 1000, output_tokens: 500 });
    tc.record("synthesis", { started_at: "2026-01-01T00:00:05Z", success: true, input_tokens: 2000, output_tokens: 3000 });

    const agg = tc.aggregateTokens();
    expect(agg.total_input).toBe(3000);
    expect(agg.total_output).toBe(3500);
    expect(agg.by_stage.research.input).toBe(1000);
    expect(agg.by_stage.synthesis.output).toBe(3000);
  });

  it("aggregateLatencies sums per stage", () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    tc.record("authoring", { started_at: "2026-01-01T00:00:00Z", success: true, duration_ms: 5000 });
    tc.record("authoring", { started_at: "2026-01-01T00:00:05Z", success: true, duration_ms: 3000 });
    tc.record("gate", { started_at: "2026-01-01T00:00:08Z", success: true, duration_ms: 20 });

    const lat = tc.aggregateLatencies();
    expect(lat.authoring).toBe(8000);
    expect(lat.gate).toBe(20);
  });

  it("providerOutcomes returns only rows with provider", () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    tc.record("library_retrieval", { started_at: "2026-01-01T00:00:00Z", success: true, duration_ms: 100 }); // no provider
    tc.record("synthesis", { started_at: "2026-01-01T00:00:01Z", success: true, duration_ms: 5000, provider: "openai", model: "gpt-5-mini" });

    const outcomes = tc.providerOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].provider).toBe("openai");
  });

  it("buildMetaEnrichment produces correct shape", () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    tc.record("synthesis", {
      started_at: "2026-01-01T00:00:00Z",
      success: true,
      duration_ms: 5000,
      input_tokens: 1000,
      output_tokens: 2000,
      provider: "openai",
      model: "gpt-5-mini",
    });

    const meta = tc.buildMetaEnrichment();
    expect(meta).toHaveProperty("stage_latencies");
    expect(meta).toHaveProperty("token_usage");
    expect(meta).toHaveProperty("cost_estimate_usd");
    expect(meta).toHaveProperty("provider_outcomes");
    expect(typeof meta.cost_estimate_usd).toBe("number");
    expect((meta.cost_estimate_usd as number)).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // CRITICAL: Telemetry resilience tests
  // Prove that telemetry failure never blocks the pipeline.
  // ═══════════════════════════════════════════════════════════════

  it("flush returns gracefully when supabase insert fails", async () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    tc.record("synthesis", { started_at: "2026-01-01T00:00:00Z", success: true });

    const mockSupabase = {
      from: () => ({
        insert: () => ({ error: { message: "connection refused" } }),
      }),
    };

    const result = await tc.flush(mockSupabase);
    expect(result.written).toBe(0);
    expect(result.error).toContain("connection refused");
  });

  it("flush returns gracefully when supabase throws", async () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    tc.record("synthesis", { started_at: "2026-01-01T00:00:00Z", success: true });

    const mockSupabase = {
      from: () => ({
        insert: () => { throw new Error("network timeout"); },
      }),
    };

    const result = await tc.flush(mockSupabase);
    expect(result.written).toBe(0);
    expect(result.error).toContain("network timeout");
  });

  it("flush returns 0 written for empty collector", async () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    const mockSupabase = { from: vi.fn() };

    const result = await tc.flush(mockSupabase);
    expect(result.written).toBe(0);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it("flush succeeds when supabase insert succeeds", async () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    tc.record("synthesis", { started_at: "2026-01-01T00:00:00Z", success: true });
    tc.record("review", { started_at: "2026-01-01T00:00:05Z", success: true });

    const mockSupabase = {
      from: () => ({
        insert: () => ({ error: null }),
      }),
    };

    const result = await tc.flush(mockSupabase);
    expect(result.written).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it("startStage + finish captures error without throwing", () => {
    const tc = new TelemetryCollector(RUN_ID, USER_ID, TASK_TYPE);
    const stage = tc.startStage("authoring", { provider: "anthropic", model: "claude-sonnet-4-5-20250929" });

    const row = stage.finish({
      success: false,
      error: "Claude timeout after 75000ms",
    });

    expect(row.success).toBe(false);
    expect(row.error).toContain("timeout");
    expect(tc.getRows()).toHaveLength(1);
  });
});

describe("estimateCostUsd", () => {
  it("returns 0 for unknown model", () => {
    expect(estimateCostUsd("unknown-model", { input_tokens: 1000, output_tokens: 1000 })).toBe(0);
  });

  it("returns 0 when usage is undefined", () => {
    expect(estimateCostUsd("gpt-5-mini", undefined)).toBe(0);
  });

  it("computes rough cost for gpt-5-mini", () => {
    const cost = estimateCostUsd("gpt-5-mini", { input_tokens: 1000, output_tokens: 2000 });
    // 1000/1000 * 0.003 + 2000/1000 * 0.012 = 0.003 + 0.024 = 0.027
    expect(cost).toBeCloseTo(0.027, 3);
  });

  it("computes rough cost for claude", () => {
    const cost = estimateCostUsd("claude-sonnet-4-5-20250929", { input_tokens: 5000, output_tokens: 10000 });
    // 5000/1000 * 0.003 + 10000/1000 * 0.015 = 0.015 + 0.15 = 0.165
    expect(cost).toBeCloseTo(0.165, 3);
  });
});
