import { useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import { dbAccountToStore } from '@/hooks/useDataSync';

/**
 * Smart soft-refresh: reconciles store + query cache with DB truth.
 * Does NOT reload the page — preserves navigation, drawers, modals.
 */
export function GlobalRefreshButton() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    console.log('[GlobalRefresh] Smart reconciliation started');

    try {
      // 1. Reconcile store accounts from DB (exclude soft-deleted)
      const { data: freshAccounts } = await supabase
        .from('accounts')
        .select('*')
        .is('deleted_at', null)
        .order('name');

      if (freshAccounts) {
        const mapped = freshAccounts.map(dbAccountToStore);
        useStore.setState({ accounts: mapped });
        console.log(`[GlobalRefresh] Reconciled ${mapped.length} accounts`);
      }

      // 2. Invalidate all query caches so derived views re-fetch
      await queryClient.invalidateQueries();

      // 3. Dispatch events for any listeners (journal, dave, etc.)
      window.dispatchEvent(new Event('dave-data-changed'));

      console.log('[GlobalRefresh] Reconciliation complete');
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
