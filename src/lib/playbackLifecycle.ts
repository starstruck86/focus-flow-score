/**
 * Playback Lifecycle Logger
 *
 * Emits a compact summary object for every playback lifecycle,
 * enabling end-to-end audit of a single clip.
 *
 * Lives in daveAudioResilience to avoid creating a second playback module.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('PlaybackLifecycle');

export type PlaybackEvent =
  | 'requested'
  | 'started'
  | 'interrupted'
  | 'suppressed'
  | 'ended'
  | 'failed'
  | 'downgraded';

export interface PlaybackLifecycleSummary {
  playbackId: string;
  stepId: string;
  events: Array<{ event: PlaybackEvent; ts: number; detail?: string }>;
  startedAt: number;
  endedAt: number | null;
  outcome: 'success' | 'interrupted' | 'failed' | 'suppressed' | 'pending';
  durationMs: number | null;
}

const _lifecycles = new Map<string, PlaybackLifecycleSummary>();
const MAX_LIFECYCLE_HISTORY = 20;

export function startLifecycle(playbackId: string, stepId: string): void {
  // Trim old entries
  if (_lifecycles.size >= MAX_LIFECYCLE_HISTORY) {
    const oldest = _lifecycles.keys().next().value;
    if (oldest) _lifecycles.delete(oldest);
  }

  _lifecycles.set(playbackId, {
    playbackId,
    stepId,
    events: [{ event: 'requested', ts: Date.now() }],
    startedAt: Date.now(),
    endedAt: null,
    outcome: 'pending',
    durationMs: null,
  });
}

export function recordLifecycleEvent(
  playbackId: string,
  event: PlaybackEvent,
  detail?: string,
): void {
  const lc = _lifecycles.get(playbackId);
  if (!lc) return;

  lc.events.push({ event, ts: Date.now(), detail });

  if (event === 'ended') {
    lc.outcome = 'success';
    lc.endedAt = Date.now();
    lc.durationMs = lc.endedAt - lc.startedAt;
  } else if (event === 'interrupted') {
    lc.outcome = 'interrupted';
    lc.endedAt = Date.now();
    lc.durationMs = lc.endedAt - lc.startedAt;
  } else if (event === 'failed') {
    lc.outcome = 'failed';
    lc.endedAt = Date.now();
    lc.durationMs = lc.endedAt - lc.startedAt;
  } else if (event === 'suppressed') {
    lc.outcome = 'suppressed';
    lc.endedAt = Date.now();
    lc.durationMs = lc.endedAt - lc.startedAt;
  } else if (event === 'started') {
    // Update startedAt to actual play start
    lc.startedAt = Date.now();
  }

  logger.info(`[lifecycle] ${event}`, {
    playbackId: playbackId.slice(-12),
    stepId: lc.stepId,
    outcome: lc.outcome,
    detail,
  });
}

export function getLifecycleSummary(playbackId: string): PlaybackLifecycleSummary | null {
  return _lifecycles.get(playbackId) ?? null;
}

export function getRecentLifecycles(count = 5): PlaybackLifecycleSummary[] {
  return Array.from(_lifecycles.values()).slice(-count);
}

export function clearLifecycles(): void {
  _lifecycles.clear();
}
