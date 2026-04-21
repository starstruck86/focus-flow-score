/**
 * Shared paginator for Supabase/PostgREST queries.
 *
 * PostgREST caps a single response at 1000 rows by default. Any client read
 * that needs the *full* result set must page through with .range(from, to)
 * until a short page returns.
 *
 * Usage:
 *   const rows = await fetchAllPages((from, to) =>
 *     supabase.from('resources').select('id, title').range(from, to)
 *   );
 */
import type { PostgrestError } from '@supabase/supabase-js';

export const DEFAULT_PAGE_SIZE = 1000;

type PageFetcher<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

export async function fetchAllPages<T>(
  fetcher: PageFetcher<T>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // Hard ceiling so a buggy fetcher cannot loop forever.
  const MAX_PAGES = 100;
  for (let page = 0; page < MAX_PAGES; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await fetcher(from, to);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
