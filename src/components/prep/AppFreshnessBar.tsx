/**
 * AppFreshnessBar — Shows refresh button, last updated time, version info,
 * and a "new version available" banner when the app is stale.
 */
import { RefreshCw, Download, RotateCcw, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAppFreshness } from '@/hooks/useAppFreshness';

function formatLastRefreshed(d: Date): string {
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AppFreshnessBar() {
  const { buildHash, lastRefreshed, isRefreshing, isStale, refreshData, forceReload, updateApp } = useAppFreshness();

  return (
    <div className="flex items-center gap-1.5">
      {/* Stale version banner */}
      {isStale && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
          onClick={updateApp}
        >
          <Download className="h-3 w-3" />
          Update available
        </Button>
      )}

      {/* Refresh button with dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
            <span className="hidden sm:inline">
              {isRefreshing ? 'Refreshing…' : formatLastRefreshed(lastRefreshed)}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={refreshData} disabled={isRefreshing}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Refresh data
            <span className="ml-auto text-[10px] text-muted-foreground">Soft</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={forceReload}>
            <RotateCcw className="h-3.5 w-3.5 mr-2" />
            Force full reload
            <span className="ml-auto text-[10px] text-muted-foreground">Hard</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              Last refresh: {lastRefreshed.toLocaleTimeString()}
            </div>
            <div>Build: {buildHash}</div>
            {isStale && <div className="text-primary font-medium">⚠ Newer version deployed</div>}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
