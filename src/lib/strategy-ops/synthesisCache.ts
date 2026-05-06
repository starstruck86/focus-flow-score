/**
 * Phase 4C — Synthesis Cache
 *
 * Exact-input cache for synthesis stage results.
 * Cache key = hash(task_type + inputs + library_hash + research_hash).
 * TTL: 30 minutes. Best-effort, never blocks pipeline.
 *
 * INVARIANTS:
 * - NEVER bypasses artifact gate
 * - NEVER skips review
 * - NEVER skips normalization
 * - Cache hits still go through full gate + normalization
 */
import { supabase } from '@/integrations/supabase/client';

export interface CacheInput {
  task_type: string;
  inputs: unknown;
  library_hash: string;
  research_hash: string;
}

export interface CacheResult {
  hit: boolean;
  data?: unknown;
  cache_key?: string;
  age_ms?: number;
}

/**
 * Simple hash from string. Not cryptographic — just for cache key dedup.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildCacheKey(input: CacheInput): string {
  const payload = JSON.stringify({
    t: input.task_type,
    i: input.inputs,
    l: input.library_hash,
    r: input.research_hash,
  });
  return `synth_${simpleHash(payload)}_${payload.length}`;
}

/**
 * Look up a cached synthesis result. Best-effort.
 */
export async function lookupCache(userId: string, input: CacheInput): Promise<CacheResult> {
  const key = buildCacheKey(input);
  try {
    const { data, error } = await supabase
      .from('strategy_synthesis_cache')
      .select('id, result, created_at, expires_at')
      .eq('user_id', userId)
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return { hit: false, cache_key: key };

    // Increment hit count (best-effort, fire-and-forget)
    supabase
      .from('strategy_synthesis_cache')
      .update({ hit_count: (data as any).hit_count + 1 || 1 })
      .eq('id', data.id)
      .then(() => {});

    return {
      hit: true,
      data: data.result,
      cache_key: key,
      age_ms: Date.now() - new Date(data.created_at).getTime(),
    };
  } catch {
    return { hit: false, cache_key: key };
  }
}

/**
 * Store a synthesis result in cache. Best-effort.
 */
export async function storeCache(
  userId: string,
  input: CacheInput,
  result: unknown
): Promise<{ stored: boolean; error?: string }> {
  const key = buildCacheKey(input);
  const inputHash = simpleHash(JSON.stringify(input));
  try {
    const { error } = await supabase
      .from('strategy_synthesis_cache')
      .upsert({
        user_id: userId,
        task_type: input.task_type,
        cache_key: key,
        input_hash: inputHash,
        result: result as any,
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        hit_count: 0,
      }, { onConflict: 'user_id,cache_key' });

    if (error) {
      console.warn(`[synthesis-cache] store failed (non-fatal): ${error.message}`);
      return { stored: false, error: error.message };
    }
    return { stored: true };
  } catch (e: any) {
    console.warn(`[synthesis-cache] store exception (non-fatal): ${e?.message}`);
    return { stored: false, error: e?.message };
  }
}

/**
 * Evict expired cache entries. Call periodically.
 */
export async function evictExpired(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from('strategy_synthesis_cache')
      .delete()
      .eq('user_id', userId)
      .lt('expires_at', new Date().toISOString())
      .select('id');
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}
