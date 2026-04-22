/**
 * Knowledge-Item pagination healthcheck.
 *
 * The PostgREST default page cap is 1000 rows. If we ever silently truncate
 * the KI fetch, every downstream lifecycle count becomes wrong (a resource
 * with 5 KIs would suddenly look like it has 0).
 *
 * This healthcheck:
 *  1. Counts KIs server-side via head/count
 *  2. Pages through them client-side
 *  3. Compares the two totals — any mismatch is a hard warning
 *  4. Returns the KI rollup map so callers don't need to re-page
 */

import { supabase } from '@/integrations/supabase/client';
import { fetchAllPages } from './supabasePagination';
import { createLogger } from './logger';

const log = createLogger('KiPaginationHealthcheck');

export interface KiRollup {
  total: number;
  active: number;
  activeWithContexts: number;
}

export interface KiPaginationHealth {
  status: 'ok' | 'truncated' | 'error';
  expected_total: number | null;
  fetched_total: number;
  pages_fetched: number;
  delta: number;
  warnings: string[];
  ki_map: Map<string, KiRollup>;
}

const PAGE_SIZE = 1000;

export async function runKiPaginationHealthcheck(): Promise<KiPaginationHealth> {
  const warnings: string[] = [];
  let expectedTotal: number | null = null;

  // 1. Server-side count
  try {
    const { count, error } = await supabase
      .from('knowledge_items' as any)
      .select('id', { count: 'exact', head: true });
    if (error) {
      warnings.push(`Server count failed: ${error.message}`);
    } else {
      expectedTotal = count ?? 0;
    }
  } catch (err: any) {
    warnings.push(`Server count threw: ${err?.message ?? String(err)}`);
  }

  // 2. Paginated fetch
  let kiRows: any[] = [];
  let pages = 0;
  try {
    kiRows = await fetchAllPages<any>(async (from, to) => {
      pages++;
      return supabase
        .from('knowledge_items' as any)
        .select('source_resource_id, active, applies_to_contexts')
        .range(from, to);
    }, PAGE_SIZE);
  } catch (err: any) {
    warnings.push(`Pagination threw: ${err?.message ?? String(err)}`);
    return {
      status: 'error',
      expected_total: expectedTotal,
      fetched_total: kiRows.length,
      pages_fetched: pages,
      delta: expectedTotal === null ? 0 : (expectedTotal - kiRows.length),
      warnings,
      ki_map: new Map(),
    };
  }

  // 3. Build rollup
  const kiMap = new Map<string, KiRollup>();
  for (const ki of kiRows) {
    if (!ki.source_resource_id) continue;
    const entry = kiMap.get(ki.source_resource_id) ?? { total: 0, active: 0, activeWithContexts: 0 };
    entry.total++;
    if (ki.active) {
      entry.active++;
      if (Array.isArray(ki.applies_to_contexts) && ki.applies_to_contexts.length > 0) {
        entry.activeWithContexts++;
      }
    }
    kiMap.set(ki.source_resource_id, entry);
  }

  // 4. Compare
  const fetchedTotal = kiRows.length;
  let status: KiPaginationHealth['status'] = 'ok';
  let delta = 0;

  if (expectedTotal !== null) {
    delta = expectedTotal - fetchedTotal;
    if (delta !== 0) {
      status = 'truncated';
      const msg = `KI pagination mismatch: server reports ${expectedTotal}, fetched ${fetchedTotal} (delta ${delta})`;
      warnings.push(msg);
      log.warn(msg, { expectedTotal, fetchedTotal, pages });
    }
  } else {
    warnings.push('Server-side count unavailable — cannot verify pagination integrity');
  }

  log.info('KI pagination healthcheck complete', {
    status,
    expectedTotal,
    fetchedTotal,
    pages,
  });

  return {
    status,
    expected_total: expectedTotal,
    fetched_total: fetchedTotal,
    pages_fetched: pages,
    delta,
    warnings,
    ki_map: kiMap,
  };
}
