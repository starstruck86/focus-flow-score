/**
 * Dave Audio Failure Audit — Structured test/verification layer
 * for resilience across Dojo, Learn, and Skill Builder audio surfaces.
 *
 * Each audit case simulates a failure scenario and verifies system behavior.
 * This is NOT a runtime system — it's a diagnostic tool.
 */

import {
  loadVoiceSessionBuffer,
  saveVoiceSessionBuffer,
  clearVoiceSessionBuffer,
  createEmptyBuffer,
  appendToTranscriptLog,
  updateBufferPosition,
} from '@/lib/daveSessionBuffer';
import { OperationQueue } from '@/lib/daveSignalRecovery';
import { makeOpKey, isOpCompleted, markOpCompleted, clearIdempotencyRecords, runIdempotent } from '@/lib/daveIdempotency';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveAudioFailureAudit');

// ── Result Type ─────────────────────────────────────────────

export interface AudioFailureAuditResult {
  surface: 'dojo' | 'learn' | 'skill_builder';
  caseId: string;
  label: string;
  passed: boolean;
  severity: 'high' | 'medium' | 'low';
  notes?: string;
}

// ── Audit Runner ────────────────────────────────────────────

export async function runFullAudioFailureAudit(): Promise<AudioFailureAuditResult[]> {
  const results: AudioFailureAuditResult[] = [];

  // Buffer tests
  results.push(testBufferPersistence());
  results.push(testBufferResume());
  results.push(testBufferExpiry());

  // Queue tests
  results.push(await testQueueReplay());
  results.push(await testQueueOrderPreservation());

  // Idempotency tests
  results.push(await testIdempotentScoring());
  results.push(await testIdempotentPersist());

  // Surface-specific
  results.push(testDojoSignalDropDuringScoring());
  results.push(testLearnSectionResume());
  results.push(testSkillBuilderBlockResume());
  results.push(await testSkillBuilderMultiQueueReplay());

  // Cleanup
  clearVoiceSessionBuffer();
  clearIdempotencyRecords();

  return results;
}

// ── Buffer Tests ────────────────────────────────────────────

function testBufferPersistence(): AudioFailureAuditResult {
  try {
    clearVoiceSessionBuffer();
    const buf = createEmptyBuffer('test-session', 'dojo', 'audio');
    const updated = updateBufferPosition(appendToTranscriptLog(buf, 'dave', 'Hello'), 3);
    saveVoiceSessionBuffer(updated);

    const loaded = loadVoiceSessionBuffer();
    const passed = !!(loaded && loaded.position === 3 && loaded.transcriptLog.length === 1);
    clearVoiceSessionBuffer();

    return { surface: 'dojo', caseId: 'buffer-persist', label: 'Buffer persists to localStorage', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'dojo', caseId: 'buffer-persist', label: 'Buffer persists to localStorage', passed: false, severity: 'high', notes: String(e) };
  }
}

function testBufferResume(): AudioFailureAuditResult {
  try {
    clearVoiceSessionBuffer();
    const buf = createEmptyBuffer('sb-session-1', 'skill_builder', 'audio');
    const updated = updateBufferPosition(buf, 5, { blockType: 'rep' });
    saveVoiceSessionBuffer(updated);

    const loaded = loadVoiceSessionBuffer();
    const passed = !!(loaded && loaded.surface === 'skill_builder' && loaded.position === 5);
    clearVoiceSessionBuffer();

    return { surface: 'skill_builder', caseId: 'buffer-resume', label: 'Skill Builder position survives reload', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'skill_builder', caseId: 'buffer-resume', label: 'Skill Builder position survives reload', passed: false, severity: 'high', notes: String(e) };
  }
}

function testBufferExpiry(): AudioFailureAuditResult {
  try {
    clearVoiceSessionBuffer();
    const buf = createEmptyBuffer('old-session', 'learn', 'audio');
    // Fake an old timestamp
    const old = { ...buf, savedAt: Date.now() - (5 * 60 * 60 * 1000) };
    localStorage.setItem('dave_voice_session_buffer', JSON.stringify(old));

    const loaded = loadVoiceSessionBuffer();
    const passed = loaded === null;
    clearVoiceSessionBuffer();

    return { surface: 'learn', caseId: 'buffer-expiry', label: 'Expired buffer is discarded', passed, severity: 'medium' };
  } catch (e) {
    return { surface: 'learn', caseId: 'buffer-expiry', label: 'Expired buffer is discarded', passed: false, severity: 'medium', notes: String(e) };
  }
}

// ── Queue Tests ─────────────────────────────────────────────

async function testQueueReplay(): Promise<AudioFailureAuditResult> {
  try {
    const queue = new OperationQueue();
    let executed = 0;
    queue.enqueue('score', async () => { executed++; }, 'test-score-1');
    queue.enqueue('persist', async () => { executed++; }, 'test-persist-1');

    const replayed = await queue.processAll();
    const passed = replayed === 2 && executed === 2 && queue.isEmpty;

    return { surface: 'dojo', caseId: 'queue-replay', label: 'Queued ops replay on reconnect', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'dojo', caseId: 'queue-replay', label: 'Queued ops replay on reconnect', passed: false, severity: 'high', notes: String(e) };
  }
}

async function testQueueOrderPreservation(): Promise<AudioFailureAuditResult> {
  try {
    const queue = new OperationQueue();
    const order: number[] = [];
    queue.enqueue('score', async () => { order.push(1); }, 'op-1');
    queue.enqueue('score', async () => { order.push(2); }, 'op-2');
    queue.enqueue('persist', async () => { order.push(3); }, 'op-3');

    await queue.processAll();
    const passed = order[0] === 1 && order[1] === 2 && order[2] === 3;

    return { surface: 'skill_builder', caseId: 'queue-order', label: 'Queue replays in FIFO order', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'skill_builder', caseId: 'queue-order', label: 'Queue replays in FIFO order', passed: false, severity: 'high', notes: String(e) };
  }
}

// ── Idempotency Tests ───────────────────────────────────────

async function testIdempotentScoring(): Promise<AudioFailureAuditResult> {
  try {
    clearIdempotencyRecords();
    const key = makeOpKey('dojo', 'session-1', 0, 'score');

    let callCount = 0;
    await runIdempotent(key, async () => { callCount++; return 'scored'; });
    await runIdempotent(key, async () => { callCount++; return 'scored-again'; });

    const passed = callCount === 1;
    clearIdempotencyRecords();

    return { surface: 'dojo', caseId: 'idempotent-score', label: 'Duplicate scoring is prevented', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'dojo', caseId: 'idempotent-score', label: 'Duplicate scoring is prevented', passed: false, severity: 'high', notes: String(e) };
  }
}

async function testIdempotentPersist(): Promise<AudioFailureAuditResult> {
  try {
    clearIdempotencyRecords();
    const key = makeOpKey('skill_builder', 'sb-1', 3, 'persist');

    let writes = 0;
    await runIdempotent(key, async () => { writes++; });
    await runIdempotent(key, async () => { writes++; });
    await runIdempotent(key, async () => { writes++; });

    const passed = writes === 1;
    clearIdempotencyRecords();

    return { surface: 'skill_builder', caseId: 'idempotent-persist', label: 'Duplicate persistence is prevented', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'skill_builder', caseId: 'idempotent-persist', label: 'Duplicate persistence is prevented', passed: false, severity: 'high', notes: String(e) };
  }
}

// ── Surface-Specific Tests ──────────────────────────────────

function testDojoSignalDropDuringScoring(): AudioFailureAuditResult {
  try {
    clearVoiceSessionBuffer();
    const buf = createEmptyBuffer('dojo-1', 'dojo', 'audio');
    const withTranscript = { ...buf, pendingTranscript: 'I would reframe by...', position: 0 };
    saveVoiceSessionBuffer(withTranscript);

    const loaded = loadVoiceSessionBuffer();
    const passed = !!(loaded && loaded.pendingTranscript === 'I would reframe by...');
    clearVoiceSessionBuffer();

    return { surface: 'dojo', caseId: 'dojo-signal-scoring', label: 'Pending transcript survives signal drop during scoring', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'dojo', caseId: 'dojo-signal-scoring', label: 'Pending transcript survives signal drop during scoring', passed: false, severity: 'high', notes: String(e) };
  }
}

function testLearnSectionResume(): AudioFailureAuditResult {
  try {
    clearVoiceSessionBuffer();
    const buf = createEmptyBuffer('learn-lesson-1', 'learn', 'audio');
    const updated = updateBufferPosition(buf, 4, { phase: 'teaching' });
    saveVoiceSessionBuffer(updated);

    const loaded = loadVoiceSessionBuffer();
    const passed = !!(loaded && loaded.position === 4 && loaded.surfaceState?.phase === 'teaching');
    clearVoiceSessionBuffer();

    return { surface: 'learn', caseId: 'learn-section-resume', label: 'Learn resumes at correct section after backgrounding', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'learn', caseId: 'learn-section-resume', label: 'Learn resumes at correct section after backgrounding', passed: false, severity: 'high', notes: String(e) };
  }
}

function testSkillBuilderBlockResume(): AudioFailureAuditResult {
  try {
    clearVoiceSessionBuffer();
    const buf = createEmptyBuffer('sb-session-2', 'skill_builder', 'audio');
    const updated = updateBufferPosition(
      appendToTranscriptLog(buf, 'dave', 'Mental model intro'),
      2,
      { blockType: 'ki_intro', sessionId: 'db-id-123' },
    );
    saveVoiceSessionBuffer(updated);

    const loaded = loadVoiceSessionBuffer();
    const passed = !!(
      loaded &&
      loaded.position === 2 &&
      loaded.surfaceState?.blockType === 'ki_intro' &&
      loaded.transcriptLog.length === 1
    );
    clearVoiceSessionBuffer();

    return { surface: 'skill_builder', caseId: 'sb-block-resume', label: 'Skill Builder block index survives reconnect', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'skill_builder', caseId: 'sb-block-resume', label: 'Skill Builder block index survives reconnect', passed: false, severity: 'high', notes: String(e) };
  }
}

async function testSkillBuilderMultiQueueReplay(): Promise<AudioFailureAuditResult> {
  try {
    clearIdempotencyRecords();
    const queue = new OperationQueue();
    const scores: number[] = [];

    // Simulate 3 queued scoring ops for consecutive blocks
    for (let i = 0; i < 3; i++) {
      const opKey = makeOpKey('skill_builder', 'sb-multi', i, 'score');
      queue.enqueue('score', async () => {
        await runIdempotent(opKey, async () => { scores.push(i); });
      }, `sb-score-${i}`);
    }

    await queue.processAll();
    // Replay again — should not duplicate
    const queue2 = new OperationQueue();
    for (let i = 0; i < 3; i++) {
      const opKey = makeOpKey('skill_builder', 'sb-multi', i, 'score');
      queue2.enqueue('score', async () => {
        await runIdempotent(opKey, async () => { scores.push(i + 100); });
      }, `sb-score-dup-${i}`);
    }
    await queue2.processAll();

    const passed = scores.length === 3 && scores[0] === 0 && scores[1] === 1 && scores[2] === 2;
    clearIdempotencyRecords();

    return { surface: 'skill_builder', caseId: 'sb-multi-queue', label: 'Multiple queued scores replay correctly without duplication', passed, severity: 'high' };
  } catch (e) {
    return { surface: 'skill_builder', caseId: 'sb-multi-queue', label: 'Multiple queued scores replay correctly without duplication', passed: false, severity: 'high', notes: String(e) };
  }
}
