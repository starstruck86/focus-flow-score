/**
 * Dojo Autoplay Gate — handles browser autoplay restrictions.
 *
 * Detects whether audio can autoplay, and provides a user-gesture
 * recovery path when it can't. Once a gesture unlocks audio, the
 * gate stays open for the rest of the session.
 *
 * Scoped to Sales Dojo only.
 */

let audioUnlocked = false;

/** Check if we've already unlocked audio via a user gesture. */
export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

/** Mark audio as unlocked (call after first successful play). */
export function markAudioUnlocked(): void {
  audioUnlocked = true;
}

/** Reset for testing. */
export function resetAutoplayGate(): void {
  audioUnlocked = false;
}

/**
 * Probe whether the browser allows autoplay by playing a silent audio.
 * Returns true if autoplay is allowed, false if blocked.
 */
export async function probeAutoplay(): Promise<boolean> {
  if (audioUnlocked) return true;

  try {
    const ctx = new AudioContext();
    // If AudioContext is suspended, autoplay is blocked
    if (ctx.state === 'suspended') {
      ctx.close();
      return false;
    }
    ctx.close();
    audioUnlocked = true;
    return true;
  } catch {
    return false;
  }
}
