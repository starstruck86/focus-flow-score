/**
 * staleJobQuery — Debug utility to find background_jobs stuck in non-terminal state.
 * Usage: import and call from browser console or an admin page.
 */
import { supabase } from '@/integrations/supabase/client';

const TABLE = 'background_jobs' as any;

export interface StaleJob {
  id: string;
  type: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  stale_minutes: number;
}

/**
 * Find jobs stuck in running/queued for longer than `thresholdMinutes`.
 * Default threshold: 60 minutes.
 */
export async function findStaleJobs(thresholdMinutes = 60): Promise<StaleJob[]> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();

  const { data, error } = await supabase
    .from(TABLE)
    .select('id, type, title, status, created_at, updated_at')
    .in('status', ['running', 'queued'])
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[STALE JOBS] query failed:', error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    ...row,
    stale_minutes: Math.round((Date.now() - new Date(row.updated_at).getTime()) / 60_000),
  }));
}

/**
 * Print stale jobs to console in a table format. Handy for debugging.
 */
export async function logStaleJobs(thresholdMinutes = 60): Promise<void> {
  const stale = await findStaleJobs(thresholdMinutes);
  if (stale.length === 0) {
    console.info(`[STALE JOBS] No jobs stale beyond ${thresholdMinutes}min ✅`);
    return;
  }
  console.warn(`[STALE JOBS] Found ${stale.length} stale job(s):`);
  console.table(stale);
}
