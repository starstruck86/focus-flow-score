/**
 * ═══════════════════════════════════════════════════════════════════
 * REGRESSION-LOCKED INVARIANT: Soft refresh only
 * ═══════════════════════════════════════════════════════════════════
 * The app refresh flow MUST remain a soft reconciliation.
 * It must NEVER call window.location.reload() or navigate away.
 *
 * This module provides the canonical refresh implementation.
 * Use performSoftRefresh() instead of building ad-hoc refresh logic.
 *
 * What it does:
 *   1. Fetches fresh account data from DB (excluding soft-deleted)
 *   2. Reconciles Zustand store state
 *   3. Invalidates all React Query caches
 *   4. Dispatches events for dependent listeners (Dave, journal, etc.)
 *
 * What it preserves:
 *   - Current route / URL
 *   - Open modals, drawers, and sheets
 *   - Form state and selections
 *   - Scroll position
 *
 * ⛔ NEVER add window.location.reload() to this file or any
 *    component that triggers refresh. If you think you need a hard
 *    reload, you have a data sync bug — fix the sync instead.
 * ═══════════════════════════════════════════════════════════════════
 */

import { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { dbAccountToStore } from '@/hooks/useDataSync';

export async function performSoftRefresh(queryClient: QueryClient): Promise<void> {
  console.log('[SoftRefresh] Reconciliation started');

  // 1. Reconcile store accounts from DB truth (exclude soft-deleted)
  const { data: freshAccounts } = await supabase
    .from('accounts')
    .select('*')
    .is('deleted_at', null)
    .order('name');

  if (freshAccounts) {
    const mapped = freshAccounts.map(dbAccountToStore);
    useStore.setState({ accounts: mapped });
    console.log(`[SoftRefresh] Reconciled ${mapped.length} accounts`);
  }

  // 2. Invalidate all query caches so derived views re-fetch
  await queryClient.invalidateQueries();

  // 3. Dispatch events for any listeners (journal, dave, etc.)
  window.dispatchEvent(new Event('dave-data-changed'));

  console.log('[SoftRefresh] Reconciliation complete');
}
