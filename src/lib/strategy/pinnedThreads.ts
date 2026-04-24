/**
 * Pinned threads — client-side persistence for "Project / starred" threads.
 *
 * Stored in localStorage under STRATEGY_PINNED_THREADS_KEY as a JSON array of
 * thread ids. Structured so we can later swap in a DB-backed source (e.g. a
 * `pinned_at` column on `strategy_threads`) without touching call sites.
 */
const KEY = 'sv-pinned-threads';

function readSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeSet(s: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(s)));
    // Notify same-tab listeners (storage event only fires cross-tab).
    window.dispatchEvent(new CustomEvent('sv-pinned-threads-changed'));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function getPinnedThreadIds(): Set<string> {
  return readSet();
}

export function isThreadPinned(id: string): boolean {
  return readSet().has(id);
}

export function togglePinnedThread(id: string): boolean {
  const s = readSet();
  let nowPinned: boolean;
  if (s.has(id)) {
    s.delete(id);
    nowPinned = false;
  } else {
    s.add(id);
    nowPinned = true;
  }
  writeSet(s);
  return nowPinned;
}

/** Subscribe to pin changes (same-tab + cross-tab). Returns unsubscribe. */
export function subscribePinnedThreads(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onLocal = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener('sv-pinned-threads-changed', onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('sv-pinned-threads-changed', onLocal);
    window.removeEventListener('storage', onStorage);
  };
}
