/**
 * TTS Cache — Two-level caching for ElevenLabs TTS audio.
 *
 * Level 1: In-memory Map (instant replay, session-scoped)
 * Level 2: IndexedDB (persistent across sessions, write-behind)
 *
 * Cache key = deterministic hash of (text + voiceId + modelId + settings).
 * Hot path: memory lookup is synchronous. Persistent lookup NEVER blocks
 * the hot path — it races against the live fetch.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('TtsCache');

// ── Cache Key ──────────────────────────────────────────────────────

export interface TtsCacheKeyInputs {
  text: string;
  voiceId: string;
  modelId?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}

/**
 * Deterministic cache key including all output-shaping inputs.
 * Any parameter that materially changes audio output must be included.
 */
export function ttsCacheKey(inputs: TtsCacheKeyInputs): string {
  const parts = [
    inputs.text,
    inputs.voiceId,
    inputs.modelId ?? 'default',
    String(inputs.speed ?? 1),
    String(inputs.stability ?? 0.5),
    String(inputs.similarityBoost ?? 0.75),
  ].join('|');
  let hash = 0;
  for (let i = 0; i < parts.length; i++) {
    const chr = parts.charCodeAt(i);
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
const MAX_PERSISTENT_ENTRIES = 200;
const MAX_PERSISTENT_BYTES = 100 * 1024 * 1024; // 100MB

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
 * Used ONLY in race mode — never blocks the hot path.
 */
export async function getPersistentCache(key: string): Promise<Blob | null> {
  try {
    return await readFromDb(key);
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
        if (Date.now() - (entry.timestamp ?? 0) > MAX_PERSISTENT_AGE_MS) {
          resolve(null);
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
  (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ blob, timestamp: Date.now(), size: blob.size }, key);
      // Trigger bounds enforcement in background
      enforcePersistentBounds();
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

/**
 * Enforce max entries and max total bytes.
 * Evicts oldest entries first. Runs in background, never blocks.
 */
let boundsEnforcementRunning = false;

function enforcePersistentBounds(): void {
  if (boundsEnforcementRunning) return;
  boundsEnforcementRunning = true;

  (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();

      req.onsuccess = async () => {
        const keys = req.result;
        if (keys.length <= MAX_PERSISTENT_ENTRIES) {
          boundsEnforcementRunning = false;
          return;
        }

        // Read all entries to get timestamps and sizes
        const entries: Array<{ key: IDBValidKey; timestamp: number; size: number }> = [];
        const readTx = db.transaction(STORE_NAME, 'readonly');
        const readStore = readTx.objectStore(STORE_NAME);

        for (const key of keys) {
          const entryReq = readStore.get(key);
          await new Promise<void>(resolve => {
            entryReq.onsuccess = () => {
              const e = entryReq.result;
              if (e) entries.push({ key, timestamp: e.timestamp ?? 0, size: e.size ?? 0 });
              resolve();
            };
            entryReq.onerror = () => resolve();
          });
        }

        // Sort oldest first
        entries.sort((a, b) => a.timestamp - b.timestamp);

        // Determine what to evict
        const toDelete: IDBValidKey[] = [];
        let totalSize = entries.reduce((s, e) => s + e.size, 0);
        let remaining = entries.length;

        for (const entry of entries) {
          if (remaining <= MAX_PERSISTENT_ENTRIES && totalSize <= MAX_PERSISTENT_BYTES) break;
          toDelete.push(entry.key);
          totalSize -= entry.size;
          remaining--;
        }

        if (toDelete.length > 0) {
          const delTx = db.transaction(STORE_NAME, 'readwrite');
          const delStore = delTx.objectStore(STORE_NAME);
          for (const key of toDelete) {
            delStore.delete(key);
          }
          logger.info('Persistent cache evicted entries', { count: toDelete.length });
        }

        boundsEnforcementRunning = false;
      };

      req.onerror = () => { boundsEnforcementRunning = false; };
    } catch {
      boundsEnforcementRunning = false;
    }
  })();
}

// ── Unified Cache Lookup ───────────────────────────────────────────

export interface CacheLookupResult {
  blob: Blob | null;
  source: 'memory' | 'persistent' | 'miss';
}

/**
 * Memory-only synchronous lookup for the hot path.
 * Does NOT check persistent cache — that happens via racePersistentCache.
 */
export function lookupMemoryCache(key: string): CacheLookupResult {
  const memBlob = getMemoryCache(key);
  if (memBlob) return { blob: memBlob, source: 'memory' };
  return { blob: null, source: 'miss' };
}

/**
 * Race persistent cache against an in-flight fetch.
 * Returns the blob if persistent wins, null otherwise.
 * The caller should abort the fetch if persistent wins.
 *
 * This is NOT on the hot path — the fetch starts immediately on memory miss.
 */
export async function racePersistentCache(key: string): Promise<Blob | null> {
  try {
    const blob = await getPersistentCache(key);
    if (blob) {
      // Promote to memory for instant replay next time
      setMemoryCache(key, blob);
    }
    return blob;
  } catch {
    return null;
  }
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
