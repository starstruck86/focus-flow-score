import { useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function GlobalRefreshButton() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    console.log('[GlobalRefresh] Invalidating all queries');
    try {
      await queryClient.invalidateQueries();
      toast.success('Data refreshed');
    } catch (e) {
      console.error('[GlobalRefresh] Error:', e);
      toast.error('Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, isRefreshing]);

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
      <TooltipContent>Refresh Data</TooltipContent>
    </Tooltip>
  );
}
