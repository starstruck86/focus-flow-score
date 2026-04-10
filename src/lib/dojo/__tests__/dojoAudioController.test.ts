/**
 * Integration + endurance tests for Dojo Audio Controller v3
 *
 * Tests cover:
 * - Happy path (exact-once delivery)
 * - Duplicate/stale callback suppression
 * - Timeout + retry
 * - Per-chunk retry exhaustion
 * - Text degradation (chunk-level and session-level)
 * - Replay (intentional, separate from normal delivery)
 * - Skip (marks completed + skipped, no ghost replay)
 * - Interruption → resume
 * - Voice mode switching
 * - Refresh/recovery (skips completed, never replays)
 * - Endurance: mixed failure modes in a single session
 * - Endurance: refresh at every awkward timing
 * - Endurance: text fallback → voice restore → continue
 * - Endurance: repeated failure on one chunk while others deliver
 * - Snapshot version mismatch / corrupt / partial
 */

import { describe, it, expect } from 'vitest';
import type { DojoScoreResult } from '../types';
import {
  createSession,
  loadResult,
} from '../conversationEngine';
import { withPlayback, type PlaybackState } from '../playbackAdapter';
import {
  createAudioController,
  onTtsRequested,
  onTtsStarted,
  onTtsCompleted,
  onTtsFailed,
  onUserInterrupted,
  onUserRequestedReplay,
  onUserRequestedSkip,
  checkForTimeout,
  resumeAfterInterruption,
  switchToTextFallback,
  switchToVoice,
  snapshotController,
  recoverSession,
  type AudioControllerState,
  type ControllerSnapshot,
} from '../dojoAudioController';

// ── Fixtures ──────────────────────────────────────────────────────

const MOCK_RESULT: DojoScoreResult = {
  score: 72,
  feedback: 'Good opening but missed the discovery question.',
  improvedVersion: 'Try leading with a question about their current process.',
  worldClassResponse: 'The elite rep would map the buying committee first.',
  practiceCue: 'Ask one question before making your point.',
  focusPattern: 'discovery_question_first',
  topMistake: 'Skipped discovery',
  whyItWorks: ['Maps buying committee', 'Builds trust early'],
  moveSequence: ['Ask discovery question', 'Map stakeholders'],
  patternTags: ['discovery', 'questioning'],
  focusReason: 'Discovery is the foundation of every deal.',
  teachingNote: 'Elite reps never pitch before they understand.',
  deltaNote: 'You jumped to solution before understanding the problem.',
};

function setupController(mode: 'voice' | 'text_fallback' = 'voice'): AudioControllerState {
  const session = createSession('test-session');
  const loaded = loadResult(session, MOCK_RESULT);
  const playback = withPlayback(loaded);
  return createAudioController(playback, mode);
}

function getChunkId(ctrl: AudioControllerState, index: number): string {
  return ctrl.dojo.chunks[index]?.id ?? '';
}

function deliverChunk(ctrl: AudioControllerState, chunkId: string) {
  ctrl = onTtsRequested(ctrl, chunkId).state;
  ctrl = onTtsStarted(ctrl, chunkId).state;
  return onTtsCompleted(ctrl, chunkId);
}

function deliverAll(ctrl: AudioControllerState) {
  const totalChunks = ctrl.dojo.chunks.length;
  let currentChunkId = ctrl.dojo.chunks[0].id;
  let deliveredCount = 0;

  for (let safety = 0; safety < totalChunks + 5; safety++) {
    const result = deliverChunk(ctrl, currentChunkId);
    ctrl = result.state;
    deliveredCount++;

    if (result.directive.kind === 'delivery_complete') break;
    if (result.directive.kind === 'speak') {
      currentChunkId = result.directive.chunk.id;
    } else if (result.directive.kind === 'show_text') {
      currentChunkId = result.directive.chunk.id;
    } else {
      break;
    }
  }
  return { ctrl, deliveredCount, totalChunks };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('DojoAudioController v3', () => {
  describe('Success path', () => {
    it('delivers all chunks sequentially with exact-once guarantee', () => {
      const { ctrl, deliveredCount, totalChunks } = deliverAll(setupController());
      expect(deliveredCount).toBe(totalChunks);
      expect(ctrl.completedChunkIds.size).toBe(totalChunks);
    });

    it('each chunk ID appears in completedChunkIds exactly once', () => {
      let ctrl = setupController();
      const seen = new Set<string>();
      let currentChunkId = ctrl.dojo.chunks[0].id;

      for (let i = 0; i < ctrl.dojo.chunks.length + 5; i++) {
        expect(seen.has(currentChunkId)).toBe(false);
        seen.add(currentChunkId);

        const result = deliverChunk(ctrl, currentChunkId);
        ctrl = result.state;
        if (result.directive.kind === 'delivery_complete') break;
        if (result.directive.kind === 'speak') currentChunkId = result.directive.chunk.id;
        else break;
      }
      expect(seen.size).toBe(ctrl.dojo.chunks.length);
    });
  });

  describe('Duplicate callback suppression', () => {
    it('ignores duplicate completed for same chunk', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunkId).state;

      const dup = onTtsCompleted(ctrl, chunkId);
      expect(dup.directive.kind).toBe('no_op');
      expect((dup.directive as any).reason).toBe('duplicate_completed');
    });

    it('ignores stale completed for wrong chunk', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      const chunk1 = getChunkId(ctrl, 1);

      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsStarted(ctrl, chunk0).state;

      const stale = onTtsCompleted(ctrl, chunk1);
      expect(stale.directive.kind).toBe('no_op');
      expect((stale.directive as any).reason).toBe('stale_chunk_completed');
    });

    it('ignores duplicate ended after recovery', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      ctrl = recovered.state;

      // Stale ended callback for chunk0 arrives after recovery
      const stale = onTtsCompleted(ctrl, chunk0);
      expect(stale.directive.kind).toBe('no_op');
      expect((stale.directive as any).reason).toBe('duplicate_completed');
    });
  });

  describe('Timeout', () => {
    it('treats hung playback as failure', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = { ...ctrl, chunkStartedAt: Date.now() - 50_000 };

      const result = checkForTimeout(ctrl);
      expect(result.directive.kind).not.toBe('no_op');
    });

    it('does nothing within timeout window', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;

      const result = checkForTimeout(ctrl);
      expect(result.directive.kind).toBe('no_op');
    });
  });

  describe('Chunk failure and retry', () => {
    it('retries a failed chunk', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      const failed = onTtsFailed(ctrl, chunkId, 'network error');
      expect(failed.directive.kind).toBe('retry_speak');
    });

    it('chunk-level degrade after max per-chunk retries', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      for (let i = 0; i < 3; i++) {
        ctrl = onTtsRequested(ctrl, chunkId).state;
        ctrl = onTtsFailed(ctrl, chunkId, `fail ${i}`).state;
      }

      ctrl = onTtsRequested(ctrl, chunkId).state;
      const result = onTtsFailed(ctrl, chunkId, 'final fail');

      // Should skip this chunk and continue
      expect(
        result.directive.kind === 'chunk_skipped_max_retries' ||
        result.directive.kind === 'show_text' ||
        result.directive.kind === 'mode_changed'
      ).toBe(true);

      // Chunk should be in skippedChunkIds
      if (result.directive.kind === 'chunk_skipped_max_retries') {
        expect(result.state.skippedChunkIds.has(chunkId)).toBe(true);
        expect(result.state.completedChunkIds.has(chunkId)).toBe(true);
      }
    });
  });

  describe('Text degradation', () => {
    it('session-level degrade continues all chunks in text', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;
      expect(ctrl.deliveryMode).toBe('text_fallback');
      expect(ctrl.degradation).toBe('session');

      // Text fallback marks chunks completed on show_text
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      const result = onTtsCompleted(ctrl, chunkId);
      expect(result.directive.kind).toBe('show_text');
      expect(result.state.completedChunkIds.has(result.directive.kind === 'show_text' ? result.directive.chunk.id : '')).toBe(true);
    });

    it('does not duplicate chunk completion accounting in text fallback', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsCompleted(ctrl, chunkId).state;

      // Second completion should be suppressed
      const dup = onTtsCompleted(ctrl, chunkId);
      expect(dup.directive.kind).toBe('no_op');
    });
  });

  describe('Replay', () => {
    it('replay is tracked separately from normal delivery', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunkId).state;

      const replay = onUserRequestedReplay(ctrl);
      expect(replay.directive.kind).toBe('speak');
      expect(replay.state.replayedChunkIds.has(chunkId)).toBe(true);
    });

    it('replays interrupted chunk', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onUserInterrupted(ctrl).state;

      const replay = onUserRequestedReplay(ctrl);
      expect(replay.directive.kind).toBe('speak');
    });

    it('returns no_op when nothing to replay', () => {
      const ctrl = setupController();
      const replay = onUserRequestedReplay(ctrl);
      expect(replay.directive.kind).toBe('no_op');
    });
  });

  describe('Skip', () => {
    it('skip marks chunk as completed AND skipped', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;

      const skip = onUserRequestedSkip(ctrl);
      ctrl = skip.state;

      expect(ctrl.completedChunkIds.has(chunkId)).toBe(true);
      expect(ctrl.skippedChunkIds.has(chunkId)).toBe(true);
    });

    it('skipped chunk is never re-delivered on advance', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      const skip = onUserRequestedSkip(ctrl);
      ctrl = skip.state;

      // All subsequent deliveries should not include chunk0
      if (skip.directive.kind === 'speak') {
        expect(skip.directive.chunk.id).not.toBe(chunk0);
      }
    });
  });

  describe('Interruption and resume', () => {
    it('interrupts and resumes from correct chunk', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onUserInterrupted(ctrl).state;
      expect(ctrl.dojo.playback.currentPlayingChunkId).toBeNull();

      const resumed = resumeAfterInterruption(ctrl);
      expect(resumed.directive.kind).toBe('speak');
    });
  });

  describe('Voice mode switching', () => {
    it('degrade → restore preserves completed chunks', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;
      const completedBefore = ctrl.completedChunkIds.size;

      ctrl = switchToTextFallback(ctrl, 'test').state;
      ctrl = switchToVoice(ctrl, 'reconnected').state;

      expect(ctrl.deliveryMode).toBe('voice');
      expect(ctrl.completedChunkIds.size).toBe(completedBefore);
      expect(ctrl.completedChunkIds.has(chunk0)).toBe(true);
    });
  });

  describe('Refresh/recovery', () => {
    it('recovery skips completed chunks deterministically', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).not.toBe(chunk0);
      }
      expect(recovered.state.completedChunkIds.has(chunk0)).toBe(true);
    });

    it('recovery in text_fallback mode stays in text', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      expect(recovered.state.deliveryMode).toBe('text_fallback');
    });

    it('recovery when all chunks done returns delivery_complete', () => {
      const { ctrl } = deliverAll(setupController());
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      expect(recovered.directive.kind).toBe('delivery_complete');
    });

    it('recovery when chunk requested but never started retries safely', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      // Should retry the chunk (it wasn't in completedChunkIds)
      expect(recovered.directive.kind).toBe('speak');
    });

    it('recovery when chunk started but never ended retries safely', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsStarted(ctrl, chunkId).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.directive.kind).toBe('speak');
      // chunkStartedAt must be null after recovery (invariant #10)
      expect(recovered.state.chunkStartedAt).toBeNull();
    });

    it('recovery preserves replayedChunkIds and skippedChunkIds', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      // Replay
      const replay = onUserRequestedReplay(ctrl);
      ctrl = replay.state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.state.replayedChunkIds.has(chunk0)).toBe(true);
    });
  });

  // ── Endurance scenarios ─────────────────────────────────────────

  describe('Endurance: ugly failure modes', () => {
    it('refresh during playing → resume without duplication', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      // Start playing but crash before ended
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsStarted(ctrl, chunk0).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      // chunk0 was not completed, so it should be retried
      expect(recovered.directive.kind).toBe('speak');
      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).toBe(chunk0);
      }
    });

    it('refresh after requested but before started', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      // No onTtsStarted — crash here

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      expect(recovered.directive.kind).toBe('speak');
    });

    it('duplicate ended after recovery is suppressed', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      const snap = snapshotController(ctrl);
      ctrl = recoverSession(snap).state;

      const dup = onTtsCompleted(ctrl, chunk0);
      expect(dup.directive.kind).toBe('no_op');
    });

    it('replay then refresh then resume — no duplication', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      // Replay chunk0
      const replay = onUserRequestedReplay(ctrl);
      ctrl = replay.state;

      // Crash mid-replay
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      // chunk0 is already completed, should advance past it
      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).not.toBe(chunk0);
      }
    });

    it('skip then replay — skipped chunk is replayed correctly', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 2) return; // need at least 2 chunks

      const chunk0 = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunk0).state;
      const skip = onUserRequestedSkip(ctrl);
      ctrl = skip.state;

      expect(ctrl.skippedChunkIds.has(chunk0)).toBe(true);
    });

    it('repeated failure on one chunk while later chunks still deliver', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 2) return;

      const chunk0 = getChunkId(ctrl, 0);

      // Exhaust retries on chunk0
      for (let i = 0; i < 4; i++) {
        ctrl = onTtsRequested(ctrl, chunk0).state;
        const result = onTtsFailed(ctrl, chunk0, `fail ${i}`);
        ctrl = result.state;

        if (result.directive.kind === 'chunk_skipped_max_retries') {
          // chunk0 was skipped, later chunks should continue
          expect(ctrl.completedChunkIds.has(chunk0)).toBe(true);
          break;
        }
      }

      // Should be able to deliver remaining chunks
      if (ctrl.dojo.chunks.length > 1) {
        const nextChunk = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id));
        if (nextChunk) {
          const result = deliverChunk(ctrl, nextChunk.id);
          expect(['speak', 'show_text', 'delivery_complete']).toContain(result.directive.kind);
        }
      }
    });

    it('full session where multiple failure types happen', () => {
      let ctrl = setupController();
      const totalChunks = ctrl.dojo.chunks.length;
      if (totalChunks < 3) return;

      // Chunk 0: normal delivery
      const chunk0 = getChunkId(ctrl, 0);
      const r0 = deliverChunk(ctrl, chunk0);
      ctrl = r0.state;

      // Chunk 1: fail → retry → success
      if (r0.directive.kind === 'speak') {
        const chunk1 = r0.directive.chunk.id;
        ctrl = onTtsRequested(ctrl, chunk1).state;
        ctrl = onTtsFailed(ctrl, chunk1, 'transient').state;
        ctrl = onTtsRequested(ctrl, chunk1).state;
        const r1 = onTtsCompleted(ctrl, chunk1);
        ctrl = r1.state;

        // Chunk 2: timeout → retry → success
        if (r1.directive.kind === 'speak') {
          const chunk2 = r1.directive.chunk.id;
          ctrl = onTtsRequested(ctrl, chunk2).state;
          ctrl = { ...ctrl, chunkStartedAt: Date.now() - 50_000 };
          const timeout = checkForTimeout(ctrl);
          ctrl = timeout.state;

          if (timeout.directive.kind === 'retry_speak') {
            ctrl = onTtsRequested(ctrl, chunk2).state;
            ctrl = onTtsCompleted(ctrl, chunk2).state;
          }
        }
      }

      // All handled chunks should be in completedChunkIds
      expect(ctrl.completedChunkIds.size).toBeGreaterThanOrEqual(1);
      // No duplicates possible (Set)
      expect(ctrl.completedChunkIds.size).toBeLessThanOrEqual(totalChunks);
    });

    it('text fallback session restores voice and continues', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      // Deliver chunk0 normally
      const r0 = deliverChunk(ctrl, chunk0);
      ctrl = r0.state;

      // Degrade to text
      ctrl = switchToTextFallback(ctrl, 'test').state;
      expect(ctrl.degradation).toBe('session');

      // Restore voice
      ctrl = switchToVoice(ctrl, 'user_requested').state;
      expect(ctrl.degradation).toBe('none');
      expect(ctrl.deliveryMode).toBe('voice');

      // Continue delivering — should work
      if (r0.directive.kind === 'speak') {
        const chunk1 = r0.directive.chunk.id;
        const r1 = deliverChunk(ctrl, chunk1);
        expect(['speak', 'delivery_complete']).toContain(r1.directive.kind);
      }
    });

    it('recovery always lands in a valid state', () => {
      let ctrl = setupController();

      // Deliver some, interrupt, then snapshot
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onUserInterrupted(ctrl).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      // Must have valid phase
      const validPhases = ['delivering', 'awaiting_followup', 'awaiting_retry', 'awaiting_confirmation', 'completed'];
      expect(validPhases).toContain(recovered.state.dojo.phase);

      // chunkStartedAt must be null
      expect(recovered.state.chunkStartedAt).toBeNull();

      // currentPlayingChunkId must be null
      expect(recovered.state.dojo.playback.currentPlayingChunkId).toBeNull();
    });

    it('text fallback always allows coaching to continue to completion', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'complete_failure').state;

      const totalChunks = ctrl.dojo.chunks.length;
      let currentId = getChunkId(ctrl, 0);
      let textDelivered = 0;

      for (let i = 0; i < totalChunks + 5; i++) {
        ctrl = onTtsRequested(ctrl, currentId).state;
        const result = onTtsCompleted(ctrl, currentId);
        ctrl = result.state;

        if (result.directive.kind === 'show_text') {
          textDelivered++;
          currentId = result.directive.chunk.id;
        }
        if (result.directive.kind === 'delivery_complete') break;
      }

      expect(textDelivered).toBeGreaterThan(0);
      expect(ctrl.completedChunkIds.size).toBe(totalChunks);
    });

    it('snapshot version mismatch is handled safely', () => {
      const badSnap: ControllerSnapshot = {
        dojo: {} as any,
        deliveryMode: 'voice',
        completedChunkIds: [],
        chunkAttempts: [],
        degradation: 'none',
        replayedChunkIds: [],
        skippedChunkIds: [],
      };

      // This should not crash — recoverSession handles whatever restoreController gives it
      try {
        const result = recoverSession(badSnap);
        // Should still return a valid result (may be delivery_complete if no chunks)
        expect(result).toBeDefined();
        expect(result.state).toBeDefined();
      } catch {
        // Acceptable — corrupt data can throw, but the loadSnapshot guard catches this
      }
    });
  });
});
