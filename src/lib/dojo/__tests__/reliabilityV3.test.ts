/**
 * Tests for Reliability V3: self-healing, hang detection, audible confirmation, health scoring, chaos framework.
 * Extended with infrastructure stress, recovery cascade, dead-end, and long-session tests.
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
  shouldInjectCorruptBlob,
  shouldSuppressPlayingEvent,
  shouldDelayEnded,
  shouldInjectDuplicate,
  getInjectedFetchDelay,
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

  it('transitions through all health states under sustained failure', () => {
    let m = createReliabilityMetrics();
    const seenStatuses = new Set<string>();
    for (let i = 0; i < 8; i++) {
      m = onFailure(m, `c-${i}`);
      seenStatuses.add(m.health.status);
    }
    // Should have hit at least DEGRADED and one of UNSTABLE/FAILING
    expect(seenStatuses.size).toBeGreaterThanOrEqual(2);
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

  it('returns false for chunks never tracked', () => {
    const m = createReliabilityMetrics();
    expect(wasChunkAudible(m, 'nonexistent')).toBe(false);
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

  it('disarming clears hung state', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    m = markHung(m);
    m = disarmHangDetector(m);
    expect(m.hangDetector.armed).toBe(false);
    expect(m.hangDetector.isHung).toBe(false);
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

  it('recommends restart_from_checkpoint when hung', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    m = markHung(m);
    // Ensure few failures so it hits the hung branch
    const { strategy } = determineRecoveryStrategy(m);
    expect(strategy).toBe('restart_from_checkpoint');
  });

  it('tracks recovery success/failure', () => {
    let m = createReliabilityMetrics();
    m = logRecoveryAttempt(m, 'retry', 'high', 'c-1');
    expect(m.recoveryAttempts).toHaveLength(1);
    expect(m.recoveryAttempts[0].succeeded).toBeNull();
    m = resolveRecoveryAttempt(m, true);
    expect(m.recoveryAttempts[0].succeeded).toBe(true);
  });

  it('caps recovery attempts buffer at 20', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 25; i++) {
      m = logRecoveryAttempt(m, 'retry', 'medium', `c-${i}`);
    }
    expect(m.recoveryAttempts.length).toBeLessThanOrEqual(20);
  });
});

// ── Long Session Memory Safety ────────────────────────────────────

describe('ReliabilityV3 — Long Session Safety', () => {
  it('failure timestamps are bounded under sustained load', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 100; i++) {
      m = onFailure(m, `c-${i}`);
    }
    expect(m.recentFailureTimestamps.length).toBeLessThanOrEqual(50);
  });

  it('audible confirmations are bounded under sustained load', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 100; i++) {
      m = startAudibleTracking(m, `c-${i}`);
    }
    expect(m.audibleConfirmations.length).toBeLessThanOrEqual(20);
  });

  it('recovery attempts are bounded under sustained load', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 100; i++) {
      m = logRecoveryAttempt(m, 'retry', 'medium', `c-${i}`);
    }
    expect(m.recoveryAttempts.length).toBeLessThanOrEqual(20);
  });

  it('forward progress count grows but health stays bounded', () => {
    let m = createReliabilityMetrics();
    for (let i = 0; i < 200; i++) {
      m = onForwardProgress(m);
    }
    expect(m.forwardProgressCount).toBe(200);
    expect(m.health.score).toBeLessThanOrEqual(100);
    expect(m.health.score).toBeGreaterThanOrEqual(0);
  });
});

// ── Dead-End State Prevention ─────────────────────────────────────

describe('ReliabilityV3 — Dead-End Prevention', () => {
  it('never recommends retry after max recovery chain exhausted', () => {
    let m = createReliabilityMetrics();
    // Exhaust the recovery chain
    for (let i = 0; i < 10; i++) {
      m = logRecoveryAttempt(m, 'retry', 'low', `c-${i}`);
      m = resolveRecoveryAttempt(m, false);
    }
    const { strategy } = determineRecoveryStrategy(m);
    expect(strategy).toBe('degrade_text');
    // Should never be retry or skip after exhaustion
    expect(strategy).not.toBe('retry_chunk');
    expect(strategy).not.toBe('skip_chunk');
  });

  it('health reaches FAILING under sustained failure + failed recovery', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    m = markHung(m);
    for (let i = 0; i < 7; i++) {
      m = onFailure(m, `c-${i}`);
      m = logRecoveryAttempt(m, 'retry', 'low', `c-${i}`);
      m = resolveRecoveryAttempt(m, false);
    }
    expect(m.health.status).toBe('FAILING');
    expect(m.health.score).toBeLessThan(25);
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

  it('summary reflects audible confirmation rate', () => {
    let m = createReliabilityMetrics();
    m = startAudibleTracking(m, 'c-1');
    m = confirmAudible(m, 'c-1');
    m = { ...m, audibleConfirmations: m.audibleConfirmations.map(a =>
      a.chunkId === 'c-1' ? { ...a, audibleAt: Date.now() - 500 } : a
    )};
    m = finalizeAudible(m, 'c-1');
    
    m = startAudibleTracking(m, 'c-2');
    m = finalizeAudible(m, 'c-2'); // not confirmed

    const summary = summarizeReliability(m);
    expect(summary.audibleConfirmationRate).toBe(0.5);
  });

  it('summary reflects recovery success rate', () => {
    let m = createReliabilityMetrics();
    m = logRecoveryAttempt(m, 'retry', 'high', 'c-1');
    m = resolveRecoveryAttempt(m, true);
    m = logRecoveryAttempt(m, 'retry', 'medium', 'c-2');
    m = resolveRecoveryAttempt(m, false);
    const summary = summarizeReliability(m);
    expect(summary.recoverySuccessRate).toBe(0.5);
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

  it('never injects corrupt blob when rate is 0', () => {
    const config = { ...CHAOS_PRESETS.off(), enabled: true, corruptBlobRate: 0 };
    for (let i = 0; i < 10; i++) {
      expect(shouldInjectCorruptBlob(config)).toBe(false);
    }
  });

  it('respects all injection point guards when disabled', () => {
    const config = { ...CHAOS_PRESETS.heavy(), enabled: false };
    expect(shouldInjectFetchTimeout(config)).toBe(false);
    expect(shouldInjectCorruptBlob(config)).toBe(false);
    expect(shouldSuppressPlayingEvent(config)).toBe(false);
    expect(shouldDelayEnded(config)).toBe(false);
    expect(shouldInjectDuplicate(config)).toBe(false);
    expect(getInjectedFetchDelay(config)).toBe(0);
  });

  it('partialBlob preset has high corrupt blob rate', () => {
    const config = CHAOS_PRESETS.partialBlob();
    expect(config.corruptBlobRate).toBeGreaterThanOrEqual(0.8);
  });

  it('staleCallbacks preset has delayed ended + duplicates', () => {
    const config = CHAOS_PRESETS.staleCallbacks();
    expect(config.delayedEndedRate).toBeGreaterThan(0);
    expect(config.duplicateCallbackRate).toBeGreaterThan(0);
  });
});

// ── Recovery Cascade Simulation ───────────────────────────────────

describe('ReliabilityV3 — Recovery Cascade', () => {
  it('escalates through retry → skip → degrade as failures accumulate', () => {
    let m = createReliabilityMetrics();
    // Start healthy
    for (let i = 0; i < 3; i++) m = onForwardProgress(m);
    
    // First failure: should recommend retry (healthy system)
    const r1 = determineRecoveryStrategy(m);
    expect(r1.strategy).toBe('retry_chunk');

    // Add moderate failures
    for (let i = 0; i < 3; i++) m = onFailure(m, `f-${i}`);
    const r2 = determineRecoveryStrategy(m);
    expect(r2.strategy).toBe('skip_chunk');

    // Add heavy failures
    for (let i = 3; i < 6; i++) m = onFailure(m, `f-${i}`);
    const r3 = determineRecoveryStrategy(m);
    expect(r3.strategy).toBe('degrade_text');
  });

  it('hung state triggers checkpoint restart even with few failures', () => {
    let m = createReliabilityMetrics();
    m = armHangDetector(m);
    m = markHung(m);
    m = onFailure(m, 'c-1');
    const { strategy } = determineRecoveryStrategy(m);
    // With 1 failure + hung, should recommend restart
    expect(strategy).toBe('restart_from_checkpoint');
  });
});
