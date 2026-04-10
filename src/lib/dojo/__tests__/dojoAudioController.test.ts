/**
 * Integration tests for Dojo Audio Controller
 *
 * Validates Dave's resilience across real runtime sequences:
 * - success path, duplicate callbacks, timeouts, degradation,
 *   replay, skip, recovery, and refresh scenarios.
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

// ── Tests ─────────────────────────────────────────────────────────

describe('DojoAudioController', () => {
  describe('Success path', () => {
    it('delivers all chunks sequentially', () => {
      let ctrl = setupController();
      const totalChunks = ctrl.dojo.chunks.length;
      expect(totalChunks).toBeGreaterThan(0);

      let deliveredCount = 0;
      let lastDirective: ReturnType<typeof onTtsCompleted>['directive'] | null = null;

      while (deliveredCount < totalChunks) {
        const chunkId = ctrl.dojo.chunks[ctrl.dojo.currentChunkIndex]?.id;
        if (!chunkId) break;

        ctrl = onTtsRequested(ctrl, chunkId).state;
        ctrl = onTtsStarted(ctrl, chunkId).state;

        const completed = onTtsCompleted(ctrl, chunkId);
        ctrl = completed.state;
        lastDirective = completed.directive;
        deliveredCount++;
      }

      expect(deliveredCount).toBe(totalChunks);
      expect(lastDirective?.kind).toBe('delivery_complete');
      expect(ctrl.completedChunkIds.size).toBe(totalChunks);
    });
  });

  describe('Duplicate callbacks', () => {
    it('ignores duplicate completed for same chunk', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsStarted(ctrl, chunkId).state;
      const first = onTtsCompleted(ctrl, chunkId);
      ctrl = first.state;

      // Duplicate completed
      const dup = onTtsCompleted(ctrl, chunkId);
      expect(dup.directive.kind).toBe('no_op');
      expect((dup.directive as { reason?: string }).reason).toBe('duplicate_completed');
    });

    it('ignores stale completed for wrong chunk', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      const chunk1 = getChunkId(ctrl, 1);

      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsStarted(ctrl, chunk0).state;

      // Stale completion for chunk1 while chunk0 is active
      const stale = onTtsCompleted(ctrl, chunk1);
      expect(stale.directive.kind).toBe('no_op');
      expect((stale.directive as { reason?: string }).reason).toBe('stale_chunk_completed');
    });
  });

  describe('Timeout', () => {
    it('treats hung playback as failure', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;

      // Simulate 50s elapsed
      ctrl = { ...ctrl, chunkStartedAt: Date.now() - 50_000 };

      const result = checkForTimeout(ctrl);
      // Should trigger failure/recovery path
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
      ctrl = failed.state;

      // Should get retry_speak directive
      expect(failed.directive.kind).toBe('retry_speak');
    });

    it('degrades after max per-chunk retries', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      // Exhaust per-chunk attempts (3)
      for (let i = 0; i < 3; i++) {
        ctrl = onTtsRequested(ctrl, chunkId).state;
        ctrl = onTtsFailed(ctrl, chunkId, `fail ${i}`).state;
      }

      // 4th attempt should hit max
      ctrl = onTtsRequested(ctrl, chunkId).state;
      const result = onTtsFailed(ctrl, chunkId, 'final fail');

      // Should either skip chunk or degrade
      expect(
        result.directive.kind === 'chunk_skipped_max_retries' ||
        result.directive.kind === 'show_text' ||
        result.directive.kind === 'mode_changed'
      ).toBe(true);
    });
  });

  describe('Text degradation', () => {
    it('continues delivery in text mode after degradation', () => {
      let ctrl = setupController();
      const degraded = switchToTextFallback(ctrl, 'test degradation');
      ctrl = degraded.state;

      expect(ctrl.deliveryMode).toBe('text_fallback');
      expect(degraded.directive.kind).toBe('mode_changed');

      // Next chunk should be show_text
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      const completed = onTtsCompleted(ctrl, chunkId);

      expect(completed.directive.kind).toBe('show_text');
    });

    it('counts degraded chunk exactly once', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      const completed = onTtsCompleted(ctrl, chunkId);
      ctrl = completed.state;

      expect(ctrl.completedChunkIds.has(chunkId)).toBe(true);

      // Duplicate should be no-op
      const dup = onTtsCompleted(ctrl, chunkId);
      expect(dup.directive.kind).toBe('no_op');
    });
  });

  describe('Replay', () => {
    it('replays last chunk while idle', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsCompleted(ctrl, chunkId).state;

      const replay = onUserRequestedReplay(ctrl);
      expect(replay.directive.kind).toBe('speak');
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
    it('skips current chunk and advances', () => {
      let ctrl = setupController();
      const totalChunks = ctrl.dojo.chunks.length;

      const skip = onUserRequestedSkip(ctrl);
      ctrl = skip.state;

      if (totalChunks > 1) {
        expect(skip.directive.kind).toBe('speak');
      } else {
        expect(skip.directive.kind).toBe('delivery_complete');
      }
    });
  });

  describe('Interruption and resume', () => {
    it('interrupts and resumes', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onUserInterrupted(ctrl).state;

      expect(ctrl.dojo.playback.currentPlayingChunkId).toBeNull();

      const resumed = resumeAfterInterruption(ctrl);
      ctrl = resumed.state;

      expect(resumed.directive.kind).toBe('speak');
    });
  });

  describe('Voice mode switching', () => {
    it('degrades and restores voice', () => {
      let ctrl = setupController();

      ctrl = switchToTextFallback(ctrl, 'test').state;
      expect(ctrl.deliveryMode).toBe('text_fallback');

      ctrl = switchToVoice(ctrl, 'reconnected').state;
      expect(ctrl.deliveryMode).toBe('voice');
      expect(ctrl.dojo.playback.consecutiveFailures).toBe(0);
    });
  });

  describe('Refresh/recovery', () => {
    it('recovers session and skips completed chunks', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      // Complete first chunk
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsCompleted(ctrl, chunk0).state;

      // Snapshot and recover
      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      // Should NOT replay chunk0
      if (recovered.directive.kind === 'speak') {
        expect((recovered.directive as { chunk: { id: string } }).chunk.id).not.toBe(chunk0);
      }
    });

    it('recovers in text_fallback mode', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.state.deliveryMode).toBe('text_fallback');
      if (recovered.directive.kind === 'show_text') {
        expect(recovered.directive.chunk).toBeDefined();
      }
    });

    it('handles recovery when all chunks completed', () => {
      let ctrl = setupController();
      const totalChunks = ctrl.dojo.chunks.length;

      // Complete all chunks
      for (let i = 0; i < totalChunks; i++) {
        const id = getChunkId(ctrl, i);
        ctrl = onTtsRequested(ctrl, id).state;
        ctrl = onTtsCompleted(ctrl, id).state;
      }

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.directive.kind).toBe('delivery_complete');
    });

    it('handles recovery when chunk requested but never started', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      // Request but don't start
      ctrl = onTtsRequested(ctrl, chunkId).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      // Should try to deliver chunk 0 again (not completed)
      expect(recovered.directive.kind).toBe('speak');
    });
  });
});
