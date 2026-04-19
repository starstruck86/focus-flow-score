import { useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Global refresh button — performs a HARD reload.
 * User explicitly requested hard reload (2026-04-19) because soft refresh
 * was not surfacing the latest deployed app version reliably.
 *
 * Clears service worker registrations + caches before reloading so the
 * browser fetches the freshest assets.
 */
export function GlobalRefreshButton() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);

    try {
      // Clear SW + caches so the next load grabs the latest build
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        } catch (e) {
          console.warn('[GlobalRefresh] SW unregister failed:', e);
        }
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch (e) {
          console.warn('[GlobalRefresh] Cache clear failed:', e);
        }
      }
      // Give Safari a beat to fully tear down the SW before navigation
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      // Cache-busted navigation — Safari ignores location.reload() cache hints,
      // but a fresh URL forces a real network fetch and bypasses bfcache.
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('_r', Date.now().toString());
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
    }
  }, [isRefreshing]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Hard refresh (reload latest version)</TooltipContent>
    </Tooltip>
  );
}
