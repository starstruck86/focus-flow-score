/**
 * Dojo Visibility Guard — handles tab backgrounding/foregrounding
 * for Sales Dojo audio delivery.
 *
 * Policy:
 * - When tab becomes hidden during active voice playback:
 *   checkpoint the current state and pause playback
 * - When tab becomes visible again:
 *   resume from checkpoint without duplicating completed chunks
 * - If state is ambiguous on resume, fail safe to text fallback
 * - Never allow "ghost playing" state (controller thinks audio is playing
 *   but browser has actually suspended it)
 *
 * Scoped to Sales Dojo. Not a generic visibility handler.
 */

export type VisibilityState = 'visible' | 'hidden' | 'unknown';

export interface VisibilityCheckpoint {
  /** Chunk that was active when tab was hidden. */
  activeChunkId: string | null;
  /** Whether audio was actually playing (vs just requested). */
  wasPlaying: boolean;
  /** Whether the chunk had reached audible state. */
  wasAudible: boolean;
  /** Timestamp when tab was hidden. */
  hiddenAt: number;
}

export interface VisibilityGuardCallbacks {
  onHidden: (checkpoint: VisibilityCheckpoint) => void;
  onVisible: (checkpoint: VisibilityCheckpoint | null, hiddenDurationMs: number) => void;
}

/**
 * Starts listening for visibility changes.
 * Returns a cleanup function.
 */
export function startVisibilityGuard(
  getActiveChunkId: () => string | null,
  getIsPlaying: () => boolean,
  getIsAudible: () => boolean,
  callbacks: VisibilityGuardCallbacks
): () => void {
  let checkpoint: VisibilityCheckpoint | null = null;

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      checkpoint = {
        activeChunkId: getActiveChunkId(),
        wasPlaying: getIsPlaying(),
        wasAudible: getIsAudible(),
        hiddenAt: Date.now(),
      };
      callbacks.onHidden(checkpoint);
    } else if (document.visibilityState === 'visible') {
      const hiddenDuration = checkpoint ? Date.now() - checkpoint.hiddenAt : 0;
      callbacks.onVisible(checkpoint, hiddenDuration);
      checkpoint = null;
    }
  };

  const handlePageHide = () => {
    if (!checkpoint) {
      checkpoint = {
        activeChunkId: getActiveChunkId(),
        wasPlaying: getIsPlaying(),
        wasAudible: getIsAudible(),
        hiddenAt: Date.now(),
      };
      callbacks.onHidden(checkpoint);
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
  };
}

export function getCurrentVisibility(): VisibilityState {
  if (typeof document === 'undefined') return 'unknown';
  return document.visibilityState === 'visible' ? 'visible' : 'hidden';
}
