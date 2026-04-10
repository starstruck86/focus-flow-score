/**
 * Integration tests for Dojo Audio Controller
 *
 * Validates Dave's resilience across real runtime sequences:
 * - success path, duplicate callbacks, timeouts, degradation,
 *   replay, skip, recovery, refresh, voice restore, and endurance scenarios.
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

/** Simulate a full successful chunk delivery cycle. */
function deliverChunk(ctrl: AudioControllerState, chunkId: string) {
  ctrl = onTtsRequested(ctrl, chunkId).state;
  ctrl = onTtsStarted(ctrl, chunkId).state;
  return onTtsCompleted(ctrl, chunkId);
}

/** Deliver all chunks in sequence, return final state and count. */
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
    } else {
      break;
    }
  }
  return { ctrl, deliveredCount, totalChunks };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('DojoAudioController', () => {
  describe('Success path', () => {
    it('delivers all chunks sequentially', () => {
      const { ctrl, deliveredCount, totalChunks } = deliverAll(setupController());
      expect(deliveredCount).toBe(totalChunks);
      expect(ctrl.completedChunkIds.size).toBe(totalChunks);
    });

    it('each chunk is delivered exactly once', () => {
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

  describe('Duplicate callbacks', () => {
    it('ignores duplicate completed for same chunk', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = deliverChunk(ctrl, chunkId).state;

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
      ctrl = failed.state;

      expect(failed.directive.kind).toBe('retry_speak');
    });

    it('degrades after max per-chunk retries', () => {
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
  });

  describe('Text degradation', () => {
    it('continues delivery in text mode after degradation', () => {
      let ctrl = setupController();
      const degraded = switchToTextFallback(ctrl, 'test degradation');
      ctrl = degraded.state;

      expect(ctrl.deliveryMode).toBe('text_fallback');
      expect(degraded.directive.kind).toBe('mode_changed');

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

      const dup = onTtsCompleted(ctrl, chunkId);
      expect(dup.directive.kind).toBe('no_op');
    });

    it('delivers all remaining chunks in text fallback', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;

      let chunkId = getChunkId(ctrl, 0);
      let textShown = 0;

      for (let i = 0; i < ctrl.dojo.chunks.length + 5; i++) {
        ctrl = onTtsRequested(ctrl, chunkId).state;
        const result = onTtsCompleted(ctrl, chunkId);
        ctrl = result.state;

        if (result.directive.kind === 'show_text') textShown++;
        if (result.directive.kind === 'delivery_complete') break;
        if (result.directive.kind === 'show_text') chunkId = result.directive.chunk.id;
        else break;
      }
      // The first show_text is chunk 0 completing, then we get show_text for chunk 1, etc.
      expect(textShown).toBeGreaterThan(0);
    });
  });

  describe('Replay', () => {
    it('replays last chunk while idle', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);
      ctrl = deliverChunk(ctrl, chunkId).state;

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

    it('replays show_text in text_fallback mode', () => {
      let ctrl = setupController();
      ctrl = switchToTextFallback(ctrl, 'test').state;
      const chunkId = getChunkId(ctrl, 0);
      ctrl = onTtsRequested(ctrl, chunkId).state;
      ctrl = onTtsCompleted(ctrl, chunkId).state;

      const replay = onUserRequestedReplay(ctrl);
      expect(replay.directive.kind).toBe('show_text');
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

      ctrl = deliverChunk(ctrl, chunk0).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      if (recovered.directive.kind === 'speak') {
        expect(recovered.directive.chunk.id).not.toBe(chunk0);
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
      const { ctrl } = deliverAll(setupController());

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.directive.kind).toBe('delivery_complete');
    });

    it('handles recovery when chunk requested but never started', () => {
      let ctrl = setupController();
      const chunkId = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunkId).state;

      const snap = snapshotController(ctrl);
      const recovered = recoverSession(snap);

      expect(recovered.directive.kind).toBe('speak');
    });
  });

  // ── Endurance scenarios ─────────────────────────────────────────

  describe('Endurance: full session with interruptions', () => {
    it('survives interrupt mid-chunk, replay, then continue', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      const totalChunks = ctrl.dojo.chunks.length;

      // Start chunk 0
      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsStarted(ctrl, chunk0).state;

      // Interrupt mid-play
      ctrl = onUserInterrupted(ctrl).state;
      expect(ctrl.dojo.playback.currentPlayingChunkId).toBeNull();

      // Replay interrupted chunk
      const replay = onUserRequestedReplay(ctrl);
      expect(replay.directive.kind).toBe('speak');
      ctrl = replay.state;

      // Complete the replayed chunk (use the full deliver flow)
      const replayChunkId = replay.directive.kind === 'speak' ? replay.directive.chunk.id : chunk0;
      const completed = deliverChunk(ctrl, replayChunkId);
      ctrl = completed.state;

      // Should advance to next chunk or complete if only 1 chunk
      if (totalChunks > 1) {
        expect(['speak', 'show_text', 'delivery_complete']).toContain(completed.directive.kind);
      }
    });

    it('survives skip during playback and continues', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);
      const totalChunks = ctrl.dojo.chunks.length;

      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = onTtsStarted(ctrl, chunk0).state;

      // Skip while playing
      const skip = onUserRequestedSkip(ctrl);
      ctrl = skip.state;

      if (totalChunks > 1) {
        expect(skip.directive.kind).toBe('speak');
        // Deliver remaining chunks
        let nextId = skip.directive.kind === 'speak' ? skip.directive.chunk.id : '';
        let remaining = 0;
        for (let i = 0; i < totalChunks; i++) {
          const r = deliverChunk(ctrl, nextId);
          ctrl = r.state;
          remaining++;
          if (r.directive.kind === 'delivery_complete') break;
          if (r.directive.kind === 'speak') nextId = r.directive.chunk.id;
          else break;
        }
        expect(remaining).toBe(totalChunks - 1); // chunk0 skipped
      }
    });

    it('survives degrade-to-text then restore-to-voice mid-session', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      // Deliver chunk0 in voice
      const c0 = deliverChunk(ctrl, chunk0);
      ctrl = c0.state;
      expect(c0.directive.kind).toBe('speak');

      // Degrade to text
      ctrl = switchToTextFallback(ctrl, 'tts_failure').state;
      expect(ctrl.deliveryMode).toBe('text_fallback');

      // Restore to voice
      ctrl = switchToVoice(ctrl, 'user_requested').state;
      expect(ctrl.deliveryMode).toBe('voice');
      expect(ctrl.dojo.playback.consecutiveFailures).toBe(0);

      // Continue delivering — should get speak directives
      if (c0.directive.kind === 'speak') {
        const nextId = c0.directive.chunk.id;
        // Next chunk after restore
        const result = deliverChunk(ctrl, nextId);
        // Should still work as voice
        expect(['speak', 'delivery_complete']).toContain(result.directive.kind);
      }
    });

    it('survives refresh mid-delivery and resumes without duplication', () => {
      let ctrl = setupController();
      const totalChunks = ctrl.dojo.chunks.length;
      const completedBefore = new Set<string>();

      // Deliver first chunk
      const chunk0 = getChunkId(ctrl, 0);
      const r0 = deliverChunk(ctrl, chunk0);
      ctrl = r0.state;
      completedBefore.add(chunk0);

      let chunk1Id = '';
      if (r0.directive.kind === 'speak') {
        chunk1Id = r0.directive.chunk.id;
        const r1 = deliverChunk(ctrl, chunk1Id);
        ctrl = r1.state;
        completedBefore.add(chunk1Id);
      }

      // Snapshot (simulates what happens before refresh)
      const snap = snapshotController(ctrl);

      // Recovery (simulates what happens after refresh)
      const recovered = recoverSession(snap);
      ctrl = recovered.state;

      // Should NOT replay completed chunks
      if (recovered.directive.kind === 'speak') {
        expect(completedBefore.has(recovered.directive.chunk.id)).toBe(false);
      }

      // Complete remaining chunks
      if (recovered.directive.kind === 'speak') {
        let nextId = recovered.directive.chunk.id;
        for (let i = 0; i < totalChunks; i++) {
          const r = deliverChunk(ctrl, nextId);
          ctrl = r.state;
          if (r.directive.kind === 'delivery_complete') break;
          if (r.directive.kind === 'speak') nextId = r.directive.chunk.id;
          else break;
        }
      }

      // All chunks should be completed
      expect(ctrl.completedChunkIds.size).toBe(totalChunks);
    });

    it('survives chunk failure → retry → success across multiple chunks', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      // First attempt fails
      ctrl = onTtsRequested(ctrl, chunk0).state;
      const failed = onTtsFailed(ctrl, chunk0, 'network error');
      ctrl = failed.state;
      expect(failed.directive.kind).toBe('retry_speak');

      // Retry succeeds
      ctrl = onTtsRequested(ctrl, chunk0).state;
      const success = onTtsCompleted(ctrl, chunk0);
      ctrl = success.state;

      // Should advance normally
      if (ctrl.dojo.chunks.length > 1) {
        expect(success.directive.kind).toBe('speak');
      }
    });

    it('survives timeout → retry → success', () => {
      let ctrl = setupController();
      const chunk0 = getChunkId(ctrl, 0);

      ctrl = onTtsRequested(ctrl, chunk0).state;
      ctrl = { ...ctrl, chunkStartedAt: Date.now() - 50_000 };

      const timeout = checkForTimeout(ctrl);
      ctrl = timeout.state;

      // Should get retry directive
      expect(timeout.directive.kind).toBe('retry_speak');

      // Retry succeeds
      ctrl = onTtsRequested(ctrl, chunk0).state;
      const success = onTtsCompleted(ctrl, chunk0);
      ctrl = success.state;

      if (ctrl.dojo.chunks.length > 1) {
        expect(success.directive.kind).toBe('speak');
      }
    });

    it('preserves exact-once delivery across full session with mixed events', () => {
      let ctrl = setupController();
      const totalChunks = ctrl.dojo.chunks.length;
      const delivered = new Set<string>();

      let currentId = getChunkId(ctrl, 0);

      for (let i = 0; i < totalChunks + 10; i++) {
        // Chunk 1: fail then retry
        if (i === 1 && !delivered.has(currentId)) {
          ctrl = onTtsRequested(ctrl, currentId).state;
          const fail = onTtsFailed(ctrl, currentId, 'transient');
          ctrl = fail.state;
          if (fail.directive.kind === 'retry_speak') {
            currentId = fail.directive.chunk.id;
          }
          continue;
        }

        const result = deliverChunk(ctrl, currentId);
        ctrl = result.state;
        delivered.add(currentId);

        if (result.directive.kind === 'delivery_complete') break;
        if (result.directive.kind === 'speak') {
          currentId = result.directive.chunk.id;
        } else {
          break;
        }
      }

      // Every chunk completed exactly once
      expect(ctrl.completedChunkIds.size).toBe(totalChunks);
    });
  });
});