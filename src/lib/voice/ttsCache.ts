/**
 * TTS Cache — Two-level caching for ElevenLabs TTS audio.
 *
 * Level 1: In-memory Map (instant replay, session-scoped)
 * Level 2: IndexedDB (persistent across sessions, write-behind)
 *
 * Cache key = deterministic hash of (text + voiceId + model).
 * Hot path: memory lookup is synchronous. Persistent lookup is async
 * but non-blocking — if slow, we skip and generate fresh.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('TtsCache');

// ── Cache Key ──────────────────────────────────────────────────────

export function ttsCacheKey(text: string, voiceId: string): string {
  // Simple deterministic hash — fast, no crypto needed
  const input = `${text}|${voiceId}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `tts_${hash >>> 0}`;
}

// ── Level 1: Memory Cache ──────────────────────────────────────────

const MAX_MEMORY_ENTRIES = 50;
const memoryCache = new Map<string, Blob>();

export function getMemoryCache(key: string): Blob | null {
  return memoryCache.get(key) ?? null;
}

export function setMemoryCache(key: string, blob: Blob): void {
  // LRU-ish: if at capacity, delete oldest entry
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const first = memoryCache.keys().next().value;
    if (first) memoryCache.delete(first);
  }
  memoryCache.set(key, blob);
}

export function clearMemoryCache(): void {
  memoryCache.clear();
}

// ── Level 2: IndexedDB (write-behind, non-blocking) ───────────────

const DB_NAME = 'dave-tts-cache';
const STORE_NAME = 'audio';
const DB_VERSION = 1;
const MAX_PERSISTENT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PERSISTENT_LOOKUP_TIMEOUT_MS = 150; // don't block hot path

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    } catch (e) {
      dbPromise = null;
      reject(e);
    }
  });
  return dbPromise;
}

/**
 * Non-blocking persistent cache read.
 * Returns null if slow (>150ms) or unavailable.
 */
export async function getPersistentCache(key: string): Promise<Blob | null> {
  try {
    const result = await Promise.race([
      readFromDb(key),
      new Promise<null>(r => setTimeout(() => r(null), PERSISTENT_LOOKUP_TIMEOUT_MS)),
    ]);
    return result;
  } catch {
    return null;
  }
}

async function readFromDb(key: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry) { resolve(null); return; }
        // Check age
        if (Date.now() - (entry.timestamp ?? 0) > MAX_PERSISTENT_AGE_MS) {
          resolve(null);
          // Delete expired entry in background
          deletePersistentEntry(key);
          return;
        }
        resolve(entry.blob as Blob);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Write-behind: call after playback starts, never blocks hot path. */
export function setPersistentCache(key: string, blob: Blob): void {
  // Fire and forget
  (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ blob, timestamp: Date.now() }, key);
    } catch (e) {
      logger.warn('Persistent cache write failed', { error: e });
    }
  })();
}

function deletePersistentEntry(key: string): void {
  (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
    } catch { /* noop */ }
  })();
}

// ── Unified Cache Lookup ───────────────────────────────────────────

export interface CacheLookupResult {
  blob: Blob | null;
  source: 'memory' | 'persistent' | 'miss';
}

/**
 * Two-level cache lookup. Memory first (instant), then persistent (fast but bounded).
 * Never blocks more than PERSISTENT_LOOKUP_TIMEOUT_MS.
 */
export async function lookupCache(key: string): Promise<CacheLookupResult> {
  // L1: memory (synchronous)
  const memBlob = getMemoryCache(key);
  if (memBlob) return { blob: memBlob, source: 'memory' };

  // L2: persistent (async, bounded)
  const persistBlob = await getPersistentCache(key);
  if (persistBlob) {
    // Promote to memory for instant replay next time
    setMemoryCache(key, persistBlob);
    return { blob: persistBlob, source: 'persistent' };
  }

  return { blob: null, source: 'miss' };
}

/**
 * Store in both levels. Memory is synchronous, persistent is write-behind.
 */
export function storeInCache(key: string, blob: Blob): void {
  setMemoryCache(key, blob);
  setPersistentCache(key, blob);
}

// ── Stats ──────────────────────────────────────────────────────────

export interface CacheStats {
  memoryEntries: number;
  memoryHits: number;
  persistentHits: number;
  misses: number;
}

let stats = { memoryHits: 0, persistentHits: 0, misses: 0 };

export function recordCacheHit(source: 'memory' | 'persistent' | 'miss'): void {
  if (source === 'memory') stats.memoryHits++;
  else if (source === 'persistent') stats.persistentHits++;
  else stats.misses++;
}

export function getCacheStats(): CacheStats {
  return { memoryEntries: memoryCache.size, ...stats };
}

export function resetCacheStats(): void {
  stats = { memoryHits: 0, persistentHits: 0, misses: 0 };
}
