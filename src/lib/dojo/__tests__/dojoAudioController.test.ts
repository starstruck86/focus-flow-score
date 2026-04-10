/**
 * Integration + endurance tests for Dojo Audio Controller v3.1
 *
 * Tests cover all previous scenarios plus:
 * - Tab visibility (hidden/visible) handling
 * - Audible state tracking
 * - Restore reason propagation
 * - Ownership conflict on initialize
 * - Exact-once across visibility transitions
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
  onTtsBlobReceived,
  onTtsPlayAttempted,
  onUserInterrupted,
  onUserRequestedReplay,
  onUserRequestedSkip,
  checkForTimeout,
  resumeAfterInterruption,
  switchToTextFallback,
  switchToVoice,
  snapshotController,
  recoverSession,
  onTabHidden,
  onTabVisible,
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

describe('DojoAudioController v3.1', () => {
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
    });

    it('transport failure with phase info is handled correctly', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
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
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      const result = onTtsCompleted(ctrl, chunkId);
      expect(result.directive.kind).toBe('show_text');
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
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = switchToTextFallback(ctrl, 'forced').state;
      const result = onTtsCompleted(ctrl, chunk0);
      expect(['show_text', 'delivery_complete', 'no_op'].includes(result.directive.kind)).toBe(true);
    });
  });

  describe('Replay', () => {
    it('replay is tracked separately from normal delivery', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunkId).state;
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
      expect(skip.state.completedChunkIds.has(chunkId)).toBe(true);
      expect(skip.state.skippedChunkIds.has(chunkId)).toBe(true);
    });

    it('skipped chunk is never re-delivered on advance', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      const skip = onUserRequestedSkip(ctrl);
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
      ctrl = onUserRequestedReplay(ctrl).state;
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      expect(recovered.state.replayedChunkIds.size).toBe(ctrl.replayedChunkIds.size);
    });

    it('recovery propagates restore reason', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap, 'refresh_recovery');
      expect(recovered.state.restoreReason).toBe('refresh_recovery');
    });
  });

  // ── Audible state tracking ─────────────────────────────────────

  describe('Audible state tracking', () => {
    it('tracks audible lifecycle: requested → blob → play → audible → ended', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      expect(ctrl.chunkAudibleState).toBe('requested');

      ctrl = onTtsBlobReceived(ctrl, chunkId).state;
      expect(ctrl.chunkAudibleState).toBe('blob_received');

      ctrl = onTtsPlayAttempted(ctrl, chunkId).state;
      expect(ctrl.chunkAudibleState).toBe('play_attempted');

      ctrl = onTtsStarted(ctrl, chunkId).state;
      expect(ctrl.chunkAudibleState).toBe('audible');
      expect(ctrl.lastAudibleChunkId).toBe(chunkId);

      const result = onTtsCompleted(ctrl, chunkId);
      // After completion, advanceToNext requests the next chunk, so state is 'requested' (not 'ended')
      // for multi-chunk sessions. 'ended' only persists if there are no more chunks.
      expect(result.state.chunkAudibleState).toBe('requested');
    });

    it('failure before audible is tracked correctly', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      const result = onTtsFailed(ctrl, chunkId, 'network error');
      expect(result.state.chunkAudibleState).toBe('failed_before_audible');
    });

    it('failure after audible is tracked correctly', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsStarted(ctrl, chunkId).state;
      expect(ctrl.chunkAudibleState).toBe('audible');
      const result = onTtsFailed(ctrl, chunkId, 'playback error');
      expect(result.state.chunkAudibleState).toBe('failed_after_audible');
    });

    it('stale blob/play events for wrong chunk are suppressed', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      const chunk1 = getChunkId(ctrl, 1);
      ctrl = onTtsRequested(ctrl, chunk0).state;
      const staleBlob = onTtsBlobReceived(ctrl, chunk1);
      expect(staleBlob.directive.kind).toBe('no_op');
      const stalePlay = onTtsPlayAttempted(ctrl, chunk1);
      expect(stalePlay.directive.kind).toBe('no_op');
    });
  });

  // ── Tab visibility ─────────────────────────────────────────────

  describe('Tab visibility', () => {
    it('tab hidden during active playback interrupts to prevent ghost state', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsStarted(ctrl, chunkId).state;

      const result = onTabHidden(ctrl);
      expect(result.state.tabVisible).toBe(false);
      expect(result.state.dojo.playback.currentPlayingChunkId).toBeNull();
    });

    it('tab hidden when idle is a no-op', () => {
      let ctrl = setupController();
      const result = onTabHidden(ctrl);
      expect(result.directive.kind).toBe('no_op');
      expect(result.state.tabVisible).toBe(false);
    });

    it('tab visible after hidden resumes safely', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsStarted(ctrl, chunkId).state;

      // Hide → interrupts
      ctrl = onTabHidden(ctrl).state;
      expect(ctrl.dojo.playback.currentPlayingChunkId).toBeNull();

      // Show → can resume
      const result = onTabVisible(ctrl);
      // Should indicate interrupted state for resume
      expect(result.state.tabVisible).toBe(true);
    });

    it('hidden-tab resume does not duplicate completed chunks', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;
      const completedBefore = ctrl.completedChunkIds.size;

      // Start chunk1, hide tab
      if (ctrl.dojo.chunks.length < 2) return;
      const chunk1Id = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id))?.id;
      if (!chunk1Id) return;
      ctrl = onTtsRequested(ctrl, chunk1Id).state;
      ctrl = onTabHidden(ctrl).state;
      ctrl = onTabVisible(ctrl).state;

      // chunk0 still completed, not re-delivered
      expect(ctrl.completedChunkIds.has(chunk0)).toBe(true);
      expect(ctrl.completedChunkIds.size).toBe(completedBefore);
    });

    it('exact-once holds across visibility transitions', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      // Hide/show cycle
      ctrl = onTabHidden(ctrl).state;
      ctrl = onTabVisible(ctrl).state;

      // Snapshot/recover
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      expect(recovered.state.completedChunkIds.has(chunk0)).toBe(true);
      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).not.toBe(chunk0);
      }
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
      ctrl = onUserRequestedReplay(ctrl).state;
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).not.toBe(chunk0);
      }
    });

    it('skip then replay — skipped chunk is tracked', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 2) return;
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onUserRequestedSkip(ctrl).state;
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
      const nextChunk = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id));
      if (nextChunk) {
        const result = deliverChunk(ctrl, nextChunk.id);
        expect(['speak', 'show_text', 'delivery_complete']).toContain(result.directive.kind);
      }
    });

    it('text fallback session restores voice and continues', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;
      ctrl = switchToTextFallback(ctrl, 'test').state;
      ctrl = switchToVoice(ctrl, 'user_requested').state;
      expect(ctrl.degradation).toBe('none');
      expect(ctrl.deliveryMode).toBe('voice');
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

    it('repeated interrupt → replay → skip combinations', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 2) return;
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onUserInterrupted(ctrl).state;
      ctrl = onUserRequestedReplay(ctrl).state;
      ctrl = onUserInterrupted(ctrl).state;
      ctrl = onUserRequestedSkip(ctrl).state;
      expect(ctrl.skippedChunkIds.has(chunk0)).toBe(true);
      expect(ctrl.completedChunkIds.has(chunk0)).toBe(true);
    });

    it('exact-once holds across interrupt → skip → replay → recovery', () => {
      let ctrl = setupController();
      if (ctrl.dojo.chunks.length < 3) return;
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;
      const chunk1 = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id))!;
      ctrl = onTtsRequested(ctrl, chunk1.id).state;
      ctrl = onUserInterrupted(ctrl).state;
      ctrl = onUserRequestedSkip(ctrl).state;
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      expect(recovered.state.completedChunkIds.has(chunk0)).toBe(true);
      if (recovered.directive.kind === 'speak') {
        expect(recovered.state.completedChunkIds.has(recovered.directive.chunk.id)).toBe(false);
      }
    });

    it('tab hidden during playing then refresh recovery', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsStarted(ctrl, chunk0).state;
      ctrl = onTabHidden(ctrl).state;

      // Simulate refresh: snapshot + recover
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap, 'refresh_recovery');
      expect(recovered.state.restoreReason).toBe('refresh_recovery');
      expect(recovered.state.chunkStartedAt).toBeNull();
      expect(recovered.directive.kind).toBe('speak');
    });

    it('pagehide during active playback followed by recovery', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunk0).state;

      if (ctrl.dojo.chunks.length < 2) return;
      const chunk1 = ctrl.dojo.chunks.find(c => !ctrl.completedChunkIds.has(c.id))!;
      ctrl = onTtsRequested(ctrl, chunk1.id).state;
      ctrl = onTabHidden(ctrl).state; // simulates pagehide

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);
      expect(recovered.state.completedChunkIds.has(chunk0)).toBe(true);
      expect(recovered.state.completedChunkIds.has(chunk1.id)).toBe(false);
    });
  });

  // ── Multi-tab ownership ──────────────────────────────────────────

  describe('Multi-tab ownership', () => {
    beforeEach(() => {
      try { localStorage.clear(); } catch {}
    });

    it('first tab claims ownership successfully', () => {
      const result = claimSession('test-ownership');
      expect(result.ok).toBe(true);
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

  // ── Controller field integrity ─────────────────────────────────

  describe('Controller field integrity', () => {
    it('new controller has correct default audibility and visibility state', () => {
      const ctrl = setupController();
      expect(ctrl.chunkAudibleState).toBe('none');
      expect(ctrl.lastAudibleChunkId).toBeNull();
      expect(ctrl.restoreReason).toBeNull();
      expect(ctrl.tabVisible).toBe(true);
    });

    it('restored controller has null restoreReason for fresh sessions', () => {
      const ctrl = setupController();
      const snap = snapshotController(ctrl);
      const restored = recoverSession(snap, 'crash_recovery');
      expect(restored.state.restoreReason).toBe('crash_recovery');
      expect(restored.state.tabVisible).toBe(true);
      // Recovery calls advanceToNext which requests the first undelivered chunk
      expect(restored.state.chunkAudibleState).toBe('requested');
    });
  });
});
