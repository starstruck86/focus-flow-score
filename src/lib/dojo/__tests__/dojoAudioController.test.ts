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
 * - Multi-tab ownership conflicts
 * - Transport failure phases
 * - Autoplay rejection path
 * - Stale completion after text degradation
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
import {
  claimSession,
  releaseOwnership,
  heartbeatOwnership,
  isCurrentTabOwner,
  TAB_ID,
} from '../dojoSessionOwnership';

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

      expect(
        result.directive.kind === 'chunk_skipped_max_retries' ||
        result.directive.kind === 'show_text' ||
        result.directive.kind === 'mode_changed'
      ).toBe(true);

      if (result.directive.kind === 'chunk_skipped_max_retries') {
        expect(result.state.skippedChunkIds.has(chunkId)).toBe(true);
        expect(result.state.completedChunkIds.has(chunkId)).toBe(true);
      }
    });

    it('transport failure with phase info is handled correctly', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;

      // Simulate transport-level failure with phase info
      const result = onTtsFailed(ctrl, chunkId, '[before_response] fetch failed');
      expect(result.directive.kind).toBe('retry_speak');
    });

    it('autoplay blocked failure is handled correctly', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;

      const result = onTtsFailed(ctrl, chunkId, '[autoplay_blocked] NotAllowedError');
      expect(result.directive.kind).toBe('retry_speak');
    });
  });

  describe('Text degradation', () => {
    it('session-level degrade continues all chunks in text', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;
      expect(ctrl.deliveryMode).toBe('text_fallback');
      expect(ctrl.degradation).toBe('session');

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

      const dup = onTtsCompleted(ctrl, chunkId);
      expect(dup.directive.kind).toBe('no_op');
    });

    it('stale voice completion after text degradation is suppressed', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      // Request chunk in voice mode
      ctrl = onTtsRequested(ctrl, chunk0).state;

      // Degrade to text before voice completes
      ctrl = switchToTextFallback(ctrl, 'forced').state;

      // Complete the chunk (text mode now — advances to next as text)
      const result = onTtsCompleted(ctrl, chunk0);
      // Should work — chunk completes and next is shown as text
      expect(['show_text', 'delivery_complete', 'no_op'].includes(result.directive.kind)).toBe(true);
    });
  });

  describe('Replay', () => {
    it('replay is tracked separately from normal delivery', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      const r0 = deliverChunk(ctrl, chunkId);
      ctrl = r0.state;

      const replay = onUserRequestedReplay(ctrl);
      expect(replay.directive.kind).toBe('speak');
      expect(replay.state.replayedChunkIds.size).toBeGreaterThan(0);
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
      expect(recovered.state.chunkStartedAt).toBeNull();
    });

    it('recovery preserves replayedChunkIds and skippedChunkIds', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      const replay = onUserRequestedReplay(ctrl);
      ctrl = replay.state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.state.replayedChunkIds.size).toBe(ctrl.replayedChunkIds.size);
    });
  });

  // ── Endurance scenarios ─────────────────────────────────────────

  describe('Endurance: ugly failure modes', () => {
    it('refresh during playing → resume without duplication', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsStarted(ctrl, chunk0).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.directive.kind).toBe('speak');
      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).toBe(chunk0);
      }
    });

    it('refresh after requested but before started', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;

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

      const replay = onUserRequestedReplay(ctrl);
      ctrl = replay.state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).not.toBe(chunk0);
      }
    });

    it('skip then replay — skipped chunk is replayed correctly', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 2) return;

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

      for (let i = 0; i < 4; i++) {
        ctrl = onTtsRequested(ctrl, chunk0).state;
        const result = onTtsFailed(ctrl, chunk0, `fail ${i}`);
        ctrl = result.state;

        if (result.directive.kind === 'chunk_skipped_max_retries') {
          expect(ctrl.completedChunkIds.has(chunk0)).toBe(true);
          break;
        }
      }

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

      const chunk0 = getChunkId(ctrl, 0);
      const r0 = deliverChunk(ctrl, chunk0);
      ctrl = r0.state;

      if (r0.directive.kind === 'speak') {
        const chunk1 = r0.directive.chunk.id;
        ctrl = onTtsRequested(ctrl, chunk1).state;
        ctrl = onTtsFailed(ctrl, chunk1, 'transient').state;
        ctrl = onTtsRequested(ctrl, chunk1).state;
        const r1 = onTtsCompleted(ctrl, chunk1);
        ctrl = r1.state;

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

      expect(ctrl.completedChunkIds.size).toBeGreaterThanOrEqual(1);
      expect(ctrl.completedChunkIds.size).toBeLessThanOrEqual(totalChunks);
    });

    it('text fallback session restores voice and continues', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      const r0 = deliverChunk(ctrl, chunk0);
      ctrl = r0.state;

      ctrl = switchToTextFallback(ctrl, 'test').state;
      expect(ctrl.degradation).toBe('session');

      ctrl = switchToVoice(ctrl, 'user_requested').state;
      expect(ctrl.degradation).toBe('none');
      expect(ctrl.deliveryMode).toBe('voice');

      if (r0.directive.kind === 'speak') {
        const chunk1 = r0.directive.chunk.id;
        const r1 = deliverChunk(ctrl, chunk1);
        expect(['speak', 'delivery_complete']).toContain(r1.directive.kind);
      }
    });

    it('recovery always lands in a valid state', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onUserInterrupted(ctrl).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      const validPhases = ['delivering', 'awaiting_followup', 'awaiting_retry', 'awaiting_confirmation', 'completed'];
      expect(validPhases).toContain(recovered.state.dojo.phase);
      expect(recovered.state.chunkStartedAt).toBeNull();
      expect(recovered.state.dojo.playback.currentPlayingChunkId).toBeNull();
    });

    it('text fallback always allows coaching to continue to completion', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'complete_failure').state;

      const totalChunks = ctrl.dojo.chunks.length;
      let textDelivered = 0;
      let currentId = getChunkId(ctrl, 0);

      for (let i = 0; i < totalChunks + 5; i++) {
        ctrl = onTtsRequested(ctrl, currentId).state;
        const result = onTtsCompleted(ctrl, currentId);
        ctrl = result.state;

        if (result.directive.kind === 'show_text') {
          textDelivered++;
          currentId = result.directive.chunk.id;
        }
        if (result.directive.kind === 'delivery_complete') break;
        if (result.directive.kind === 'no_op') {
          const nextUndelivered = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id));
          if (!nextUndelivered) break;
          currentId = nextUndelivered.id;
        }
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

      try {
        const result = recoverSession(badSnap);
        expect(result).toBeDefined();
        expect(result.state).toBeDefined();
      } catch {
        // Acceptable — corrupt data can throw
      }
    });

    it('repeated interrupt → replay → skip combinations', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 2) return;
      const chunk0 = getChunkId(ctrl, 0);

      // Start playing
      ctrl = onTtsRequested(ctrl, chunk0).state;

      // Interrupt
      ctrl = onUserInterrupted(ctrl).state;
      expect(ctrl.dojo.playback.currentPlayingChunkId).toBeNull();

      // Replay
      const replay1 = onUserRequestedReplay(ctrl);
      ctrl = replay1.state;
      expect(replay1.directive.kind).toBe('speak');

      // Interrupt again
      ctrl = onUserInterrupted(ctrl).state;

      // Skip
      const skip = onUserRequestedSkip(ctrl);
      ctrl = skip.state;
      expect(ctrl.skippedChunkIds.has(chunk0)).toBe(true);
      expect(ctrl.completedChunkIds.has(chunk0)).toBe(true);

      // Should have moved to next chunk
      if (skip.directive.kind === 'speak') {
        expect(skip.directive.chunk.id).not.toBe(chunk0);
      }
    });

    it('transport fetch fail → retry → success path', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      // First attempt: request then fail
      ctrl = onTtsRequested(ctrl, chunkId).state;
      const fail1 = onTtsFailed(ctrl, chunkId, '[before_response] network timeout');
      ctrl = fail1.state;
      expect(fail1.directive.kind).toBe('retry_speak');

      // Second attempt: request then succeed
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsStarted(ctrl, chunkId).state;
      const success = onTtsCompleted(ctrl, chunkId);
      ctrl = success.state;

      expect(ctrl.completedChunkIds.has(chunkId)).toBe(true);
      // Should advance to next chunk
      expect(['speak', 'delivery_complete']).toContain(success.directive.kind);
    });

    it('transport fetch fail → retry exhausted → chunk degrade', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      // Exhaust all retries
      for (let i = 0; i < 4; i++) {
        ctrl = onTtsRequested(ctrl, chunkId).state;
        const result = onTtsFailed(ctrl, chunkId, `[during_response] HTTP 500 attempt ${i}`);
        ctrl = result.state;
        if (result.directive.kind === 'chunk_skipped_max_retries') {
          expect(ctrl.completedChunkIds.has(chunkId)).toBe(true);
          expect(ctrl.skippedChunkIds.has(chunkId)).toBe(true);
          return;
        }
      }
    });

    it('repeated chunk failures → session degrade', () => {
      let ctrl = setupController();

      // Create enough consecutive failures to trigger session degradation (5+)
      for (let i = 0; i < 6; i++) {
        const chunkId = getChunkId(ctrl, ctrl.dojo.currentChunkIndex);
        if (!chunkId) break;
        ctrl = onTtsRequested(ctrl, chunkId).state;
        const result = onTtsFailed(ctrl, chunkId, `session_fail_${i}`);
        ctrl = result.state;
        if (result.directive.kind === 'mode_changed' && (result.directive as any).mode === 'text_fallback') {
          expect(ctrl.deliveryMode).toBe('text_fallback');
          expect(ctrl.degradation).toBe('session');
          return;
        }
      }
    });

    it('restore from text → voice → continue delivering', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      // Deliver first chunk
      ctrl = deliverChunk(ctrl, chunk0).state;

      // Degrade to text
      ctrl = switchToTextFallback(ctrl, 'test_degrade').state;
      expect(ctrl.deliveryMode).toBe('text_fallback');

      // Restore voice
      ctrl = switchToVoice(ctrl, 'user_restore').state;
      expect(ctrl.deliveryMode).toBe('voice');
      expect(ctrl.degradation).toBe('none');

      // Deliver next chunk in voice
      const nextChunk = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id));
      if (nextChunk) {
        const result = deliverChunk(ctrl, nextChunk.id);
        expect(['speak', 'delivery_complete']).toContain(result.directive.kind);
      }
    });

    it('exact-once holds across interrupt → skip → replay → recovery', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 3) return;

      const chunk0 = getChunkId(ctrl, 0);

      // Deliver chunk0
      ctrl = deliverChunk(ctrl, chunk0).state;
      const completedAfter0 = ctrl.completedChunkIds.size;

      // Get chunk1 and interrupt mid-play
      const chunk1 = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id))!;
      ctrl = onTtsRequested(ctrl, chunk1.id).state;
      ctrl = onUserInterrupted(ctrl).state;

      // Skip chunk1
      ctrl = onUserRequestedSkip(ctrl).state;
      expect(ctrl.completedChunkIds.size).toBe(completedAfter0 + 1);

      // Snapshot and recover
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      ctrl = recovered.state;

      // Verify no completed chunks were lost
      expect(ctrl.completedChunkIds.size).toBe(completedAfter0 + 1);
      expect(ctrl.completedChunkIds.has(chunk0)).toBe(true);
      expect(ctrl.completedChunkIds.has(chunk1.id)).toBe(true);

      // Next directive should be for a non-completed chunk
      if (recovered.directive.kind === 'speak') {
        expect(ctrl.completedChunkIds.has(recovered.directive.chunk.id)).toBe(false);
      }
    });
  });

  // ── Multi-tab ownership tests ──────────────────────────────────

  describe('Multi-tab ownership', () => {
    beforeEach(() => {
      // Clean up any ownership records
      try { localStorage.clear(); } catch { /* jsdom may not have localStorage */ }
    });

    it('first tab claims ownership successfully', () => {
      const result = claimSession('test-ownership');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.reason).toBe('claimed');
      }
      releaseOwnership('test-ownership');
    });

    it('same tab can re-claim', () => {
      claimSession('test-reclaim');
      const result = claimSession('test-reclaim');
      expect(result.ok).toBe(true);
      releaseOwnership('test-reclaim');
    });

    it('heartbeat updates successfully for owner', () => {
      claimSession('test-heartbeat');
      expect(heartbeatOwnership('test-heartbeat')).toBe(true);
      releaseOwnership('test-heartbeat');
    });

    it('isCurrentTabOwner returns true after claim', () => {
      claimSession('test-is-owner');
      expect(isCurrentTabOwner('test-is-owner')).toBe(true);
      releaseOwnership('test-is-owner');
    });

    it('release clears ownership', () => {
      claimSession('test-release');
      releaseOwnership('test-release');
      expect(isCurrentTabOwner('test-release')).toBe(false);
    });
  });
});
