/**
 * Phase 4C Tests — Feature Flags, Synthesis Cache, Release Confidence, Cost/Latency Analytics
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── Feature Flags ──────────────────────────────────────────────────

describe('strategyFeatureFlags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults all flags to false', async () => {
    const { loadStrategyFlags } = await import('../strategyFeatureFlags');
    const flags = loadStrategyFlags();
    expect(flags.parallel_authoring_enabled).toBe(false);
    expect(flags.partial_regen_enabled).toBe(false);
    expect(flags.synthesis_cache_enabled).toBe(false);
    expect(flags.library_cache_enabled).toBe(false);
  });

  it('persists flag changes to localStorage', async () => {
    const { setStrategyFlag, loadStrategyFlags } = await import('../strategyFeatureFlags');
    setStrategyFlag('synthesis_cache_enabled', true);
    const flags = loadStrategyFlags();
    expect(flags.synthesis_cache_enabled).toBe(true);
    expect(flags.parallel_authoring_enabled).toBe(false);
  });

  it('getActiveExperimentFlags returns only true flags', async () => {
    const { setStrategyFlag, getActiveExperimentFlags } = await import('../strategyFeatureFlags');
    setStrategyFlag('synthesis_cache_enabled', true);
    const active = getActiveExperimentFlags();
    expect(active).toHaveProperty('synthesis_cache_enabled', true);
    expect(active).not.toHaveProperty('parallel_authoring_enabled');
  });

  it('resetStrategyFlags clears all overrides', async () => {
    const { setStrategyFlag, resetStrategyFlags, loadStrategyFlags } = await import('../strategyFeatureFlags');
    setStrategyFlag('synthesis_cache_enabled', true);
    resetStrategyFlags();
    expect(loadStrategyFlags().synthesis_cache_enabled).toBe(false);
  });
});

// ── Synthesis Cache ────────────────────────────────────────────────

describe('synthesisCache', () => {
  it('buildCacheKey produces deterministic keys', async () => {
    const { buildCacheKey } = await import('../synthesisCache');
    const input = { task_type: 'account_brief', inputs: { a: 1 }, library_hash: 'abc', research_hash: 'def' };
    const k1 = buildCacheKey(input);
    const k2 = buildCacheKey(input);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^synth_/);
  });

  it('different inputs produce different keys', async () => {
    const { buildCacheKey } = await import('../synthesisCache');
    const k1 = buildCacheKey({ task_type: 'a', inputs: { x: 1 }, library_hash: 'l1', research_hash: 'r1' });
    const k2 = buildCacheKey({ task_type: 'a', inputs: { x: 2 }, library_hash: 'l1', research_hash: 'r1' });
    expect(k1).not.toBe(k2);
  });
});

// ── Cost/Latency parser helpers (already tested in parsers.test.ts, just confirm imports) ──

describe('analytics modules export correctly', () => {
  it('costAnalytics exports expected functions', async () => {
    const mod = await import('../costAnalytics');
    expect(typeof mod.getCostSummary).toBe('function');
    expect(typeof mod.getCostByTaskType).toBe('function');
    expect(typeof mod.getCostByProvider).toBe('function');
    expect(typeof mod.getCostByStage).toBe('function');
    expect(typeof mod.getMostExpensiveRuns).toBe('function');
    expect(typeof mod.getAverageCostPerSuccessfulRun).toBe('function');
    expect(typeof mod.getFailedRunCostWaste).toBe('function');
  });

  it('latencyAnalytics exports expected functions', async () => {
    const mod = await import('../latencyAnalytics');
    expect(typeof mod.getLatencySummary).toBe('function');
    expect(typeof mod.getLatencyByTaskType).toBe('function');
    expect(typeof mod.getLatencyByStage).toBe('function');
    expect(typeof mod.getLatencyPercentiles).toBe('function');
    expect(typeof mod.getSlowestRuns).toBe('function');
    expect(typeof mod.getLatencyTrend).toBe('function');
    expect(typeof mod.getBatchExecutionAnalytics).toBe('function');
  });

  it('releaseConfidence exports computeReleaseConfidence', async () => {
    const mod = await import('../releaseConfidence');
    expect(typeof mod.computeReleaseConfidence).toBe('function');
  });
});
