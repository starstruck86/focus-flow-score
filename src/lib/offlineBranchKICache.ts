/**
 * Offline Branch KI Cache
 * Stores all Branch.io KIs in IndexedDB via Dexie so drills work without internet.
 */
import Dexie, { type Table } from 'dexie';

export interface CachedBranchKI {
  id: string;
  title: string;
  chapter: string;
  sub_chapter: string | null;
  spider_dimension: string | null;
  intelligence_type: string | null;
  tactic_summary: string;
  when_to_use: string | null;
  when_not_to_use: string | null;
  example_usage: string | null;
  why_it_matters: string | null;
  framework: string | null;
  confidence_score: number | null;
  active: boolean;
}

interface KISyncMeta {
  id: 'meta';
  lastSyncedAt: string | null;
  count: number;
}

class BranchKIDatabase extends Dexie {
  kiItems!: Table<CachedBranchKI, string>;
  syncMeta!: Table<KISyncMeta, string>;

  constructor() {
    super('BranchKIOfflineCache');
    this.version(1).stores({
      kiItems: 'id, spider_dimension, chapter, active',
      syncMeta: 'id',
    });
  }
}

export const branchKIDb = new BranchKIDatabase();

/** Returns true if the cache is populated and fresh (within 48 hours) */
export async function isCacheFresh(): Promise<boolean> {
  try {
    const meta = await branchKIDb.syncMeta.get('meta');
    if (!meta?.lastSyncedAt || meta.count < 100) return false;
    const hoursSinceSync = (Date.now() - new Date(meta.lastSyncedAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceSync < 48;
  } catch {
    return false;
  }
}

/** Returns the cached KI count */
export async function getCachedKICount(): Promise<number> {
  try {
    const meta = await branchKIDb.syncMeta.get('meta');
    return meta?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Bulk-write KIs from Supabase into IndexedDB. */
export async function writeBranchKIsToCache(kis: CachedBranchKI[]): Promise<void> {
  await branchKIDb.kiItems.bulkPut(kis);
  await branchKIDb.syncMeta.put({
    id: 'meta',
    lastSyncedAt: new Date().toISOString(),
    count: kis.length,
  });
}

/**
 * Select a random KI from the offline cache for a given dimension.
 * Mirrors the logic in selectNextBranchKI but works without Supabase.
 */
export async function selectOfflineBranchKI(
  spiderDimension: string,
  recentlyDrilledIds: Set<string>,
  excludeKiId?: string | null,
  intelligenceType?: string | null,
): Promise<CachedBranchKI | null> {
  try {
    const excludeIds = new Set(recentlyDrilledIds);
    if (excludeKiId) excludeIds.add(excludeKiId);

    let candidates = await branchKIDb.kiItems
      .where('spider_dimension').equals(spiderDimension)
      .and(ki => ki.active && ki.chapter === 'branch_io' && (!intelligenceType || ki.intelligence_type === intelligenceType))
      .toArray();

    if (!candidates.length) {
      candidates = await branchKIDb.kiItems
        .where('chapter').equals('branch_io')
        .and(ki => ki.active && (!intelligenceType || ki.intelligence_type === intelligenceType))
        .limit(50)
        .toArray();
    }

    if (!candidates.length) return null;

    const undrilled = candidates.filter(k => !excludeIds.has(k.id));
    const pool = undrilled.length > 0 ? undrilled : candidates;
    return pool[Math.floor(Math.random() * Math.min(pool.length, 10))];
  } catch {
    return null;
  }
}
