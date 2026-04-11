/**
 * Tests for Reliability V3: self-healing, hang detection, audible confirmation, health scoring, chaos framework.
 */
import { describe, it, expect } from 'vitest';
import {
  createReliabilityMetrics,
  onForwardProgress,
  onFailure,
  startAudibleTracking,
  confirmAudible,
  finalizeAudible,
  wasChunkAudible,
  checkForHang,
  armHangDetector,
  disarmHangDetector,
  markHangWarning,
  markHung,
  determineRecoveryStrategy,
  logRecoveryAttempt,
  resolveRecoveryAttempt,
  summarizeReliability,
} from '../dojoReliabilityV3';
import {
  loadChaosConfig,
  saveChaosConfig,
  resetChaosConfig,
  shouldInjectFetchTimeout,
  CHAOS_PRESETS,
} from '../dojoChaosTest';

// ── Health Scoring ────────────────────────────────────────────────

describe('ReliabilityV3 — Health Scoring', () => {
  it('starts HEALTHY with score 100', () => {
    const m = createReliabilityMetrics();
    expect(m.health.status).toBe('HEALTHY');
    expect(m.health.score).toBe(100);
  });

  it('degrades on repeated failures', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 5; i++) m = onFailure(m, `chunk-${i}`);
    expect(m.health.score).toBeLessThan(50);
    expect(['UNSTABLE', 'FAILING']).toContain(m.health.status);
  });

  it('recovers health on consecutive successes', () => {
    let m = createReliabilityMetrics();
    m = onFailure(m, 'c1');
    m = onFailure(m, 'c2');
    expect(m.health.score).toBeLessThan(100);
    for (let i = 0; i < 6; i++) m = onForwardProgress(m);
    expect(m.health.status).toBe('HEALTHY');
  });
});

// ── Audible Confirmation ──────────────────────────────────────────

describe('ReliabilityV3 — Audible Confirmation', () => {
  it('tracks audible lifecycle: start → confirm → finalize', () => {
    let m = createReliabilityMetrics();
    m = startAudibleTracking(m, 'chunk-1');
    expect(m.audibleConfirmations).toHaveLength(1);
    expect(m.audibleConfirmations[0].audibleAt).toBeNull();

    m = confirmAudible(m, 'chunk-1');
    expect(m.audibleConfirmations[0].audibleAt).not.toBeNull();
  });

  it('marks chunk as NOT audible if duration < 300ms', () => {
    let m = createReliabilityMetrics();
    m = startAudibleTracking(m, 'chunk-1');
    // Confirm immediately then finalize immediately → ~0ms duration
    m = confirmAudible(m, 'chunk-1');
    m = finalizeAudible(m, 'chunk-1');
    // Duration is ~0ms, should not be confirmed
    expect(wasChunkAudible(m, 'chunk-1')).toBe(false);
  });

  it('marks chunk as audible if duration >= 300ms', async () => {
    let m = createReliabilityMetrics();
    m = startAudibleTracking(m, 'chunk-1');
    m = confirmAudible(m, 'chunk-1');
    // Manually set audibleAt to simulate 500ms ago
    m = {
      ...m,
      audibleConfirmations: m.audibleConfirmations.map(a =>
        a.chunkId === 'chunk-1' ? { ...a, audibleAt: Date.now() - 500 } : a
      ),
    };
    m = finalizeAudible(m, 'chunk-1');
    expect(wasChunkAudible(m, 'chunk-1')).toBe(true);
  });

  it('caps audible tracking buffer at 20 entries', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 25; i++) {
      m = startAudibleTracking(m, `chunk-${i}`);
    }
    expect(m.audibleConfirmations.length).toBeLessThanOrEqual(20);
  });
});

// ── Hang Detection ────────────────────────────────────────────────

describe('ReliabilityV3 — Hang Detection', () => {
  it('does not trigger when disarmed', () => {
    const m = createReliabilityMetrics();
    const result = checkForHang(m);
    expect(result.action).toBe('none');
  });

  it('does not trigger immediately after arming', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    const result = checkForHang(m);
    expect(result.action).toBe('none');
  });

  it('warns after 30s stale', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    m.hangDetector.lastProgressAt = Date.now() - 35_000;
    const result = checkForHang(m);
    expect(result.action).toBe('warn');
  });

  it('recovers after 45s stale', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    m.hangDetector.lastProgressAt = Date.now() - 50_000;
    const result = checkForHang(m);
    expect(result.action).toBe('recover');
  });

  it('resets hang state on forward progress', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    m = markHung(m);
    expect(m.hangDetector.isHung).toBe(true);
    m = onForwardProgress(m);
    expect(m.hangDetector.isHung).toBe(false);
    expect(m.hangDetector.hangWarnings).toBe(0);
  });
});

// ── Recovery Strategy ─────────────────────────────────────────────

describe('ReliabilityV3 — Recovery Strategy', () => {
  it('recommends retry for first failure', () => {
    let m = createReliabilityMetrics();
    m = onForwardProgress(m);
    m = onForwardProgress(m);
    m = onForwardProgress(m);
    const { strategy, confidence } = determineRecoveryStrategy(m);
    expect(strategy).toBe('retry_chunk');
    expect(confidence).toBe('high');
  });

  it('recommends degrade after many failures', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 5; i++) m = onFailure(m, `c-${i}`);
    const { strategy } = determineRecoveryStrategy(m);
    expect(strategy).toBe('degrade_text');
  });

  it('recommends degrade after repeated failed recoveries', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 5; i++) {
      m = logRecoveryAttempt(m, 'retry', 'medium', `c-${i}`);
      m = resolveRecoveryAttempt(m, false);
    }
    const { strategy } = determineRecoveryStrategy(m);
    expect(strategy).toBe('degrade_text');
  });

  it('tracks recovery success/failure', () => {
    let m = createReliabilityMetrics();
    m = logRecoveryAttempt(m, 'retry', 'high', 'c-1');
    expect(m.recoveryAttempts).toHaveLength(1);
    expect(m.recoveryAttempts[0].succeeded).toBeNull();
    m = resolveRecoveryAttempt(m, true);
    expect(m.recoveryAttempts[0].succeeded).toBe(true);
  });
});

// ── Summary ───────────────────────────────────────────────────────

describe('ReliabilityV3 — Summary', () => {
  it('produces correct summary', () => {
    let m = createReliabilityMetrics();
    m = onForwardProgress(m);
    m = onForwardProgress(m);
    m = onFailure(m, 'c-1');
    const summary = summarizeReliability(m);
    expect(summary.forwardProgressCount).toBe(2);
    expect(summary.recentFailureCount).toBe(1);
    expect(summary.health.status).toBeDefined();
    expect(summary.lastProgressAgoMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Chaos Testing Framework ───────────────────────────────────────

describe('Chaos Testing Framework', () => {
  it('defaults to disabled', () => {
    resetChaosConfig();
    const config = loadChaosConfig();
    expect(config.enabled).toBe(false);
  });

  it('does not inject failures when disabled', () => {
    const config = loadChaosConfig();
    // Even with high rate, disabled = no injection
    const patched = { ...config, fetchTimeoutRate: 1.0, enabled: false };
    expect(shouldInjectFetchTimeout(patched)).toBe(false);
  });

  it('saves and loads config', () => {
    const config = CHAOS_PRESETS.medium();
    saveChaosConfig(config);
    const loaded = loadChaosConfig();
    expect(loaded.enabled).toBe(true);
    expect(loaded.fetchTimeoutRate).toBe(0.2);
    resetChaosConfig();
  });

  it('presets produce valid configs', () => {
    for (const key of Object.keys(CHAOS_PRESETS) as Array<keyof typeof CHAOS_PRESETS>) {
      const config = CHAOS_PRESETS[key]();
      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.fetchTimeoutRate).toBe('number');
    }
  });

  it('always injects when rate is 1.0 and enabled', () => {
    const config = { ...CHAOS_PRESETS.off(), enabled: true, fetchTimeoutRate: 1.0 };
    expect(shouldInjectFetchTimeout(config)).toBe(true);
  });
});
