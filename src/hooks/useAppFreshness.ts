/**
 * useAppFreshness — Tracks build version, staleness, and last data refresh time.
 * Compares the client build timestamp against a deployed version marker.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const BUILD_VERSION = typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : new Date().toISOString();

// Short hash for display
function shortHash(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts.slice(0, 8);
  return `${d.getMonth() + 1}${d.getDate()}.${d.getHours()}${String(d.getMinutes()).padStart(2, '0')}`;
}

export function useAppFreshness() {
  const queryClient = useQueryClient();
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const buildVersion = BUILD_VERSION;
  const buildHash = shortHash(buildVersion);

  // Poll for new version by checking if the index.html has changed
  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      try {
        const res = await fetch('/', { cache: 'no-store', headers: { 'Accept': 'text/html' } });
        const html = await res.text();
        // Look for the build timestamp in the served HTML
        const match = html.match(/__BUILD_TIMESTAMP__["']?\s*:\s*["']([^"']+)["']/);
        if (match && match[1] && match[1] !== buildVersion) {
          if (!cancelled) setIsStale(true);
        }
      } catch {
        // Silent fail — network issues shouldn't block UX
      }
    };

    // Check every 5 minutes
    pollRef.current = setInterval(checkVersion, 5 * 60 * 1000);
    // Initial check after 30s
    const initialTimeout = setTimeout(checkVersion, 30_000);

    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
      clearTimeout(initialTimeout);
    };
  }, [buildVersion]);

  /** Soft refresh: invalidate all relevant data queries */
  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['resources'] }),
        queryClient.invalidateQueries({ queryKey: ['all-resources'] }),
        queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] }),
        queryClient.invalidateQueries({ queryKey: ['knowledge-items'] }),
        queryClient.invalidateQueries({ queryKey: ['audio-jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] }),
        queryClient.invalidateQueries({ queryKey: ['resource-duplicates'] }),
        queryClient.invalidateQueries({ queryKey: ['in-use-resources'] }),
        queryClient.invalidateQueries({ queryKey: ['pipeline-diagnoses'] }),
        queryClient.invalidateQueries({ queryKey: ['extraction-attempts'] }),
      ]);
      setLastRefreshed(new Date());
      toast.success('Library refreshed', {
        description: `Updated at ${new Date().toLocaleTimeString()}`,
        duration: 3000,
      });
    } catch {
      toast.error('Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  /** Hard reload: force browser to load latest app version */
  const forceReload = useCallback(() => {
    window.location.reload();
  }, []);

  /** Update to latest version */
  const updateApp = useCallback(() => {
    // Clear service worker caches if available
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(r => r.unregister());
      });
      caches.keys().then(keys => {
        keys.forEach(key => caches.delete(key));
      });
    }
    window.location.reload();
  }, []);

  return {
    buildVersion,
    buildHash,
    lastRefreshed,
    isRefreshing,
    isStale,
    refreshData,
    forceReload,
    updateApp,
  };
}
