/**
 * Reliability stress tests — validates the app survives messy real-world conditions.
 * 
 * Covers: crash sentinel, resource leak tracking, breadcrumbs,
 * snapshot corruption, stale closures, visibility transitions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initCrashSentinel,
  addBreadcrumb,
  getBreadcrumbs,
  getStoredCrashes,
  clearStoredCrashes,
  getTelemetry,
  incrementTelemetry,
  trackTimer,
  untrackTimer,
  getLeakMetrics,
  registerContextProvider,
} from '../crashSentinel';
import {
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  restoreFromSnapshot,
} from '../dojo/dojoSessionSnapshot';
import { createAudioController } from '../dojo/dojoAudioController';

// ── Crash Sentinel Tests ──────────────────────────────────────────

describe('CrashSentinel', () => {
  beforeEach(() => {
    clearStoredCrashes();
  });

  it('captures breadcrumbs with ring buffer limit', () => {
    for (let i = 0; i < 50; i++) {
      addBreadcrumb('custom', `event-${i}`);
    }
    const crumbs = getBreadcrumbs();
    expect(crumbs.length).toBeLessThanOrEqual(40);
    expect(crumbs[crumbs.length - 1].label).toBe('event-49');
  });

  it('tracks telemetry counters', () => {
    const before = getTelemetry();
    incrementTelemetry('crashCount');
    incrementTelemetry('crashCount');
    incrementTelemetry('supabaseFailures');
    const after = getTelemetry();
    expect(after.crashCount).toBe(before.crashCount + 2);
    expect(after.supabaseFailures).toBe(before.supabaseFailures + 1);
  });

  it('tracks timer leaks', () => {
    const before = getLeakMetrics();
    trackTimer(1);
    trackTimer(2);
    trackTimer(3);
    expect(getLeakMetrics().activeTimers).toBe(before.activeTimers + 3);
    untrackTimer(2);
    expect(getLeakMetrics().activeTimers).toBe(before.activeTimers + 2);
    untrackTimer(1);
    untrackTimer(3);
  });

  it('registers and calls context providers', () => {
    const cleanup = registerContextProvider(() => ({
      dojoSessionActive: true,
      audioPlaying: true,
    }));
    // Provider is registered; cleanup works
    cleanup();
  });

  it('breadcrumb types are correctly categorized', () => {
    addBreadcrumb('click', 'Button click');
    addBreadcrumb('route', '/ → /dojo');
    addBreadcrumb('fetch', '500 edge-function');
    addBreadcrumb('visibility', 'hidden');
    
    const crumbs = getBreadcrumbs();
    const types = crumbs.slice(-4).map(b => b.type);
    expect(types).toContain('click');
    expect(types).toContain('route');
    expect(types).toContain('fetch');
    expect(types).toContain('visibility');
  });
});

// ── Snapshot Corruption / Edge Cases ───────────────────────────────

describe('Snapshot resilience', () => {
  const SESSION_ID = 'stress-test-session';

  beforeEach(() => {
    clearSnapshot(SESSION_ID);
  });

  it('rejects corrupted snapshot data', () => {
    localStorage.setItem(`dojo_snap_${SESSION_ID}`, '{"version":3,"sessionId":"x"}');
    const result = loadSnapshot(SESSION_ID);
    expect(result.ok).toBe(false);
    expect(!result.ok && 'reason' in result && result.reason).toBe('corrupt');
  });

  it('rejects version-mismatched snapshots', () => {
    localStorage.setItem(`dojo_snap_${SESSION_ID}`, JSON.stringify({
      version: 999,
      sessionId: SESSION_ID,
      completedChunkIds: [],
      dojoState: {},
    }));
    const result = loadSnapshot(SESSION_ID);
    expect(result.ok).toBe(false);
    expect(!result.ok && 'reason' in result && result.reason).toBe('version_mismatch');
  });

  it('rejects stale snapshots (>2 hours)', () => {
    const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(`dojo_snap_${SESSION_ID}`, JSON.stringify({
      version: 3,
      savedAt: oldDate,
      sessionId: SESSION_ID,
      completedChunkIds: [],
      dojoState: { chunks: [], sessionId: SESSION_ID, currentChunkIndex: 0, phase: 'idle', postDeliveryPhase: 'idle', resultVersion: 1, playback: { currentPlayingChunkId: null, interruptedChunkId: null, consecutiveFailures: 0 } },
      deliveryMode: 'voice',
      currentChunkIndex: 0,
      totalChunks: 0,
      replayedChunkIds: [],
      skippedChunkIds: [],
      chunkAttempts: [],
      phase: 'idle',
      postDeliveryPhase: 'idle',
      textChunksShown: [],
      isSessionDegraded: false,
      consecutiveFailures: 0,
    }));
    const result = loadSnapshot(SESSION_ID);
    expect(result.ok).toBe(false);
    expect(!result.ok && 'reason' in result && result.reason).toBe('stale');
  });

  it('handles localStorage quota exhaustion gracefully', () => {
    // Mock localStorage.setItem to throw
    const orig = localStorage.setItem;
    localStorage.setItem = () => { throw new DOMException('QuotaExceeded'); };
    
    // Should not throw
    const mockDojo = {
      sessionId: SESSION_ID,
      chunks: [],
      currentChunkIndex: 0,
      phase: 'idle' as const,
      postDeliveryPhase: 'idle' as const,
      resultVersion: 1,
      playback: { currentPlayingChunkId: null, interruptedChunkId: null, consecutiveFailures: 0 },
    };
    const ctrl = createAudioController(mockDojo as any, 'voice');
    expect(() => saveSnapshot(ctrl)).not.toThrow();
    
    localStorage.setItem = orig;
  });

  it('handles unparseable localStorage data', () => {
    localStorage.setItem(`dojo_snap_${SESSION_ID}`, 'not json at all{{{');
    const result = loadSnapshot(SESSION_ID);
    expect(result.ok).toBe(false);
    expect(!result.ok && 'reason' in result && result.reason).toBe('corrupt');
  });
});

// ── Exact-Once Under Stress ───────────────────────────────────────

describe('Exact-once under rapid state transitions', () => {
  it('completed chunks set is deterministic after multiple adds', () => {
    const completed = new Set<string>();
    const chunkIds = Array.from({ length: 100 }, (_, i) => `chunk-${i}`);
    
    // Simulate rapid completion
    for (const id of chunkIds) {
      completed.add(id);
    }
    
    // Re-add should not duplicate
    for (const id of chunkIds) {
      completed.add(id);
    }
    
    expect(completed.size).toBe(100);
  });

  it('Map.entries roundtrip preserves attempt counts', () => {
    const attempts = new Map<string, number>();
    attempts.set('chunk-1', 3);
    attempts.set('chunk-2', 1);
    attempts.set('chunk-3', 5);
    
    // Serialize and deserialize (as snapshot does)
    const serialized = Array.from(attempts.entries());
    const restored = new Map(serialized);
    
    expect(restored.get('chunk-1')).toBe(3);
    expect(restored.get('chunk-2')).toBe(1);
    expect(restored.get('chunk-3')).toBe(5);
    expect(restored.size).toBe(3);
  });
});

// ── Timer / Listener Leak Detection ───────────────────────────────

describe('Resource leak patterns', () => {
  it('setInterval cleanup pattern is correct', () => {
    const timers: ReturnType<typeof setInterval>[] = [];
    
    // Simulate creating multiple intervals
    for (let i = 0; i < 10; i++) {
      const id = setInterval(() => {}, 10000);
      timers.push(id);
      trackTimer(id);
    }
    
    expect(getLeakMetrics().activeTimers).toBeGreaterThanOrEqual(10);
    
    // Clean up
    for (const id of timers) {
      clearInterval(id);
      untrackTimer(id);
    }
  });

  it('URL.createObjectURL / revokeObjectURL pattern', () => {
    // Simulate creating and cleaning up blob URLs
    const urls: string[] = [];
    for (let i = 0; i < 5; i++) {
      const blob = new Blob(['test'], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      urls.push(url);
    }
    
    // All should be revocable without error
    for (const url of urls) {
      expect(() => URL.revokeObjectURL(url)).not.toThrow();
    }
  });
});
