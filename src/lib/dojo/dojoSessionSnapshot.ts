/**
 * Dojo Session Snapshot v2 — Crash-safe persistence for Sales Dojo coaching delivery.
 *
 * Versioned snapshot schema ensures forward/backward compatibility.
 * Stored in localStorage (survives refresh + crash, unlike sessionStorage).
 *
 * INVARIANTS:
 * - A snapshot NEVER stores mid-playback audio state (chunkStartedAt, audio handles)
 * - On restore, any chunk in "requested but not completed" state is treated as undelivered
 * - completedChunkIds is the single source of truth for "was this chunk delivered?"
 * - Replay events are tracked separately from normal delivery (replayedChunkIds)
 */

import type { PlaybackState } from './playbackAdapter';
import type { DeliveryMode, AudioControllerState } from './dojoAudioController';

// ── Schema version ─────────────────────────────────────────────────

/** Bump this when the snapshot shape changes in a breaking way. */
const SNAPSHOT_VERSION = 3;

/** Max age for a snapshot to be considered valid (2 hours). */
const MAX_SNAPSHOT_AGE_MS = 2 * 60 * 60 * 1000;

// ── Restore reason codes ───────────────────────────────────────────

export type RestoreReason =
  | 'crash_recovery'
  | 'refresh_recovery'
  | 'rejected_corrupt'
  | 'rejected_version_mismatch'
  | 'rejected_stale'
  | 'rejected_owner_conflict'
  | 'resumed_voice'
  | 'resumed_text_fallback';

// ── Snapshot shape ─────────────────────────────────────────────────

export interface SessionSnapshot {
  /** Schema version for forward-compat checks. */
  version: number;
  /** ISO timestamp when snapshot was written. */
  savedAt: string;

  // ── Identity ──
  sessionId: string;
  resultVersion: number;

  // ── Delivery position ──
  deliveryMode: DeliveryMode;
  currentChunkIndex: number;
  totalChunks: number;

  // ── Exact-once tracking ──
  completedChunkIds: string[];
  replayedChunkIds: string[];
  skippedChunkIds: string[];

  // ── Attempt tracking ──
  chunkAttempts: [string, number][];

  // ── Phase ──
  phase: string;
  postDeliveryPhase: string;

  // ── Text chunks already shown to user ──
  textChunksShown: string[];

  // ── Degradation state ──
  isSessionDegraded: boolean;
  consecutiveFailures: number;

  // ── Full playback state for deep restore ──
  dojoState: PlaybackState;
}

// ── Storage keys ───────────────────────────────────────────────────

const STORAGE_PREFIX = 'dojo_snap_';

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

// ── Save ───────────────────────────────────────────────────────────

export function saveSnapshot(
  ctrl: AudioControllerState,
  opts: {
    textChunksShown?: string[];
    replayedChunkIds?: string[];
    skippedChunkIds?: string[];
  } = {}
): void {
  try {
    const snap: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      sessionId: ctrl.dojo.sessionId,
      resultVersion: ctrl.dojo.resultVersion,
      deliveryMode: ctrl.deliveryMode,
      currentChunkIndex: ctrl.dojo.currentChunkIndex,
      totalChunks: ctrl.dojo.chunks.length,
      completedChunkIds: Array.from(ctrl.completedChunkIds),
      replayedChunkIds: opts.replayedChunkIds ?? Array.from(ctrl.replayedChunkIds),
      skippedChunkIds: opts.skippedChunkIds ?? Array.from(ctrl.skippedChunkIds),
      chunkAttempts: Array.from(ctrl.chunkAttempts.entries()),
      phase: ctrl.dojo.phase,
      postDeliveryPhase: ctrl.dojo.postDeliveryPhase,
      textChunksShown: opts.textChunksShown ?? [],
      isSessionDegraded: ctrl.deliveryMode === 'text_fallback',
      consecutiveFailures: ctrl.dojo.playback.consecutiveFailures,
      dojoState: ctrl.dojo,
    };
    localStorage.setItem(storageKey(ctrl.dojo.sessionId), JSON.stringify(snap));
  } catch {
    // localStorage full or unavailable — fail silently, recovery will start fresh
  }
}

// ── Load ───────────────────────────────────────────────────────────

export type SnapshotLoadResult =
  | { ok: true; snapshot: SessionSnapshot; restoreReason: RestoreReason }
  | { ok: false; reason: 'not_found' | 'version_mismatch' | 'corrupt' | 'stale' };

export function loadSnapshot(sessionId: string): SnapshotLoadResult {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (!raw) return { ok: false, reason: 'not_found' };

    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;

    // Version gate: reject snapshots from incompatible versions
    if (!parsed.version || parsed.version !== SNAPSHOT_VERSION) {
      clearSnapshot(sessionId);
      return { ok: false, reason: 'version_mismatch' };
    }

    // Staleness check
    if (parsed.savedAt) {
      const age = Date.now() - new Date(parsed.savedAt).getTime();
      if (age > MAX_SNAPSHOT_AGE_MS) {
        clearSnapshot(sessionId);
        return { ok: false, reason: 'stale' };
      }
    }

    // Minimal structural validation
    if (
      !parsed.sessionId ||
      !Array.isArray(parsed.completedChunkIds) ||
      !parsed.dojoState
    ) {
      clearSnapshot(sessionId);
      return { ok: false, reason: 'corrupt' };
    }

    const restoreReason: RestoreReason = parsed.isSessionDegraded
      ? 'resumed_text_fallback'
      : 'crash_recovery';

    return { ok: true, snapshot: parsed as SessionSnapshot, restoreReason };
  } catch {
    clearSnapshot(sessionId);
    return { ok: false, reason: 'corrupt' };
  }
}

// ── Clear ──────────────────────────────────────────────────────────

export function clearSnapshot(sessionId: string): void {
  try {
    localStorage.removeItem(storageKey(sessionId));
  } catch { /* noop */ }
}

// ── Snapshot age query ─────────────────────────────────────────────

export function getSnapshotAge(sessionId: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
    if (!parsed.savedAt) return null;
    return Date.now() - new Date(parsed.savedAt).getTime();
  } catch {
    return null;
  }
}

// ── Restore to controller state ────────────────────────────────────

/**
 * Rebuild AudioControllerState from a snapshot.
 *
 * INVARIANT: chunkStartedAt is always null after restore.
 * Any chunk that was "requested but not completed" before crash
 * will be retried from scratch.
 *
 * INVARIANT: currentPlayingChunkId is always null after restore.
 * We never assume that "requested audio" means "audible audio."
 *
 * INVARIANT: If the snapshot is ambiguous (e.g., phase is delivering
 * but no chunks remain), we fail safe to text_fallback.
 */
export function restoreFromSnapshot(snap: SessionSnapshot): AudioControllerState {
  const completedSet = new Set(snap.completedChunkIds);

  // Advance currentChunkIndex past all completed chunks
  let chunkIndex = 0;
  while (
    chunkIndex < snap.dojoState.chunks.length &&
    completedSet.has(snap.dojoState.chunks[chunkIndex].id)
  ) {
    chunkIndex++;
  }

  const hasRemaining = chunkIndex < snap.dojoState.chunks.length;

  // If ambiguous, fail safe to text
  const mode: DeliveryMode =
    !hasRemaining ? snap.deliveryMode :
    snap.isSessionDegraded ? 'text_fallback' :
    snap.deliveryMode;

  return {
    dojo: {
      ...snap.dojoState,
      currentChunkIndex: chunkIndex,
      phase: hasRemaining ? 'delivering' : snap.dojoState.postDeliveryPhase,
      playback: {
        ...snap.dojoState.playback,
        // INVARIANT: never restore mid-playback state
        currentPlayingChunkId: null,
        interruptedChunkId: null,
      },
    },
    deliveryMode: mode,
    chunkStartedAt: null, // INVARIANT: never restore mid-playback timestamp
    completedChunkIds: completedSet,
    chunkAttempts: new Map(snap.chunkAttempts),
    degradation: snap.isSessionDegraded ? 'session' : 'none',
    replayedChunkIds: new Set(snap.replayedChunkIds),
    skippedChunkIds: new Set(snap.skippedChunkIds),
  };
}
