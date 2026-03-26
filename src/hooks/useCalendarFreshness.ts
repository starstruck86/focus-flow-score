/**
 * useCalendarFreshness — detects stale calendar data and triggers
 * fast resync on tab focus, app open, and periodic checks during workday.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncCalendar } from './useCalendarEvents';
import { isWorkHoursET } from '@/lib/timeFormat';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const WORKDAY_POLL_MS = 15 * 60 * 1000; // 15 minutes during work hours
const LAST_SYNC_KEY = 'calendar_last_sync';

function getLastSyncMs(): number {
  return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
}

function isStale(): boolean {
  return Date.now() - getLastSyncMs() > STALE_THRESHOLD_MS;
}

export interface CalendarFreshness {
  /** Whether data is considered stale (>10 min since last sync) */
  isStale: boolean;
  /** Last successful sync timestamp (ms), 0 if never synced */
  lastSyncMs: number;
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Trigger a manual sync */
  syncNow: () => void;
  /** Human-readable "last synced" label */
  lastSyncLabel: string;
}

function formatSyncLabel(ms: number): string {
  if (!ms) return 'Never synced';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3600_000)}h ago`;
}

export function useCalendarFreshness(): CalendarFreshness {
  const sync = useSyncCalendar();
  const queryClient = useQueryClient();
  const [lastSyncMs, setLastSyncMs] = useState(getLastSyncMs);
  const syncInFlight = useRef(false);

  const doSync = useCallback(() => {
    if (syncInFlight.current || sync.isPending) return;
    syncInFlight.current = true;
    sync.mutate(undefined, {
      onSettled: () => {
        syncInFlight.current = false;
        setLastSyncMs(getLastSyncMs());
        // Also invalidate the daily plan so it picks up new meetings
        queryClient.invalidateQueries({ queryKey: ['daily-time-blocks'] });
      },
    });
  }, [sync, queryClient]);

  // Sync on mount if stale
  useEffect(() => {
    if (isStale()) doSync();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync on tab focus if stale
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && isStale()) {
        doSync();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [doSync]);

  // Periodic poll during work hours
  useEffect(() => {
    const interval = setInterval(() => {
      if (isWorkHoursET() && isStale()) doSync();
      setLastSyncMs(getLastSyncMs()); // keep label fresh
    }, WORKDAY_POLL_MS);
    return () => clearInterval(interval);
  }, [doSync]);

  // Keep lastSyncMs fresh for label rendering
  useEffect(() => {
    const tick = setInterval(() => setLastSyncMs(getLastSyncMs()), 30_000);
    return () => clearInterval(tick);
  }, []);

  return {
    isStale: Date.now() - lastSyncMs > STALE_THRESHOLD_MS,
    lastSyncMs,
    isSyncing: sync.isPending,
    syncNow: doSync,
    lastSyncLabel: formatSyncLabel(lastSyncMs),
  };
}
