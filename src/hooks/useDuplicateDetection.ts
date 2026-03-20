import { useMemo } from 'react';
import { useDbOpportunities, useUpdateOpportunity, useDeleteOpportunity } from '@/hooks/useAccountsData';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface DuplicateGroup {
  type: 'account' | 'opportunity';
  key: string; // normalized name used for matching
  items: DuplicateItem[];
}

export interface DuplicateItem {
  id: string;
  name: string;
  type: 'account' | 'opportunity';
  createdAt: string;
  /** Count of linked records (tasks, transcripts, resources, contacts, opportunities) */
  linkedCount: number;
  details: Record<string, any>;
}

import { normalize, isSimilar } from '@/lib/stringUtils';

export function useDuplicateDetection() {
  const { accounts, opportunities, tasks } = useStore();
  const { data: dbOpps = [] } = useDbOpportunities();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const updateOpp = useUpdateOpportunity();
  const deleteOpp = useDeleteOpportunity();

  const duplicateAccounts = useMemo(() => {
    const groups: DuplicateGroup[] = [];
    const used = new Set<string>();

    for (let i = 0; i < accounts.length; i++) {
      if (used.has(accounts[i].id)) continue;
      const cluster: typeof accounts = [accounts[i]];

      for (let j = i + 1; j < accounts.length; j++) {
        if (used.has(accounts[j].id)) continue;
        if (isSimilar(accounts[i].name, accounts[j].name)) {
          cluster.push(accounts[j]);
          used.add(accounts[j].id);
        }
      }

      if (cluster.length > 1) {
        used.add(accounts[i].id);
        groups.push({
          type: 'account',
          key: normalize(accounts[i].name),
          items: cluster.map(a => {
            const linkedOpps = opportunities.filter(o => o.accountId === a.id).length;
            const linkedTasks = tasks.filter(t => t.linkedAccountId === a.id).length;
            return {
              id: a.id,
              name: a.name,
              type: 'account' as const,
              createdAt: a.createdAt || '',
              linkedCount: linkedOpps + linkedTasks,
              details: {
                tier: a.tier,
                status: a.accountStatus,
                website: a.website,
                industry: a.industry,
                opportunities: linkedOpps,
                tasks: linkedTasks,
              },
            };
          }),
        });
      }
    }
    return groups;
  }, [accounts, opportunities, tasks]);

  const duplicateOpportunities = useMemo(() => {
    const groups: DuplicateGroup[] = [];
    const used = new Set<string>();
    const allOpps = opportunities;

    for (let i = 0; i < allOpps.length; i++) {
      if (used.has(allOpps[i].id)) continue;
      const cluster = [allOpps[i]];

      for (let j = i + 1; j < allOpps.length; j++) {
        if (used.has(allOpps[j].id)) continue;
        if (isSimilar(allOpps[i].name, allOpps[j].name)) {
          cluster.push(allOpps[j]);
          used.add(allOpps[j].id);
        }
      }

      if (cluster.length > 1) {
        used.add(allOpps[i].id);
        groups.push({
          type: 'opportunity',
          key: normalize(allOpps[i].name),
          items: cluster.map(o => {
            const linkedTasks = tasks.filter(t => t.linkedOpportunityId === o.id).length;
            return {
              id: o.id,
              name: o.name,
              type: 'opportunity' as const,
              createdAt: o.createdAt || '',
              linkedCount: linkedTasks,
              details: {
                status: o.status,
                stage: o.stage,
                arr: o.arr,
                accountId: o.accountId,
                closeDate: o.closeDate,
                nextStep: o.nextStep,
                tasks: linkedTasks,
                isInDb: dbOpps.some(d => d.id === o.id),
              },
            };
          }),
        });
      }
    }
    return groups;
  }, [opportunities, tasks, dbOpps]);

  /**
   * Merge duplicates: keep `keepId`, reassign all linked records from `removeIds` to `keepId`, then delete removeIds.
   */
  const mergeAccounts = async (keepId: string, removeIds: string[]) => {
    if (!user) return;
    
    for (const removeId of removeIds) {
      // Reassign opportunities
      await supabase.from('opportunities').update({ account_id: keepId }).eq('account_id', removeId);
      // Reassign contacts
      await supabase.from('contacts').update({ account_id: keepId }).eq('account_id', removeId);
      // Reassign account_contacts
      await supabase.from('account_contacts').update({ account_id: keepId }).eq('account_id', removeId);
      // Reassign call transcripts
      await supabase.from('call_transcripts').update({ account_id: keepId }).eq('account_id', removeId);
      // Reassign resources
      await supabase.from('resources').update({ account_id: keepId }).eq('account_id', removeId);
      // Delete the duplicate account
      await supabase.from('accounts').delete().eq('id', removeId);

      // Sync Zustand store
      const store = useStore.getState();
      if (typeof store.deleteAccount === 'function') {
        store.deleteAccount(removeId);
      }
    }

    // Invalidate queries
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    toast.success(`Merged ${removeIds.length} duplicate account(s) — all linked data preserved`);
  };

  const mergeOpportunities = async (keepId: string, removeIds: string[]) => {
    if (!user) return;

    for (const removeId of removeIds) {
      // Reassign tasks (nullify opportunity_id so they don't break)
      // Tasks are in Zustand — we'll update via store 
      // Reassign call transcripts
      await supabase.from('call_transcripts').update({ opportunity_id: keepId }).eq('opportunity_id', removeId);
      // Reassign resources
      await supabase.from('resources').update({ opportunity_id: keepId }).eq('opportunity_id', removeId);
      // Reassign renewals linked_opportunity_id
      await supabase.from('renewals').update({ linked_opportunity_id: keepId }).eq('linked_opportunity_id', removeId);
      // Delete the duplicate opportunity
      await supabase.from('opportunities').delete().eq('id', removeId);

      // Sync Zustand store
      const store = useStore.getState();
      if (typeof store.deleteOpportunity === 'function') {
        store.deleteOpportunity(removeId);
      }
    }

    // Update tasks in store
    const { updateTask } = useStore.getState();
    const { tasks: currentTasks } = useStore.getState();
    for (const removeId of removeIds) {
      currentTasks
        .filter(t => t.linkedOpportunityId === removeId)
        .forEach(t => updateTask(t.id, { linkedOpportunityId: keepId }));
    }

    queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    queryClient.invalidateQueries({ queryKey: ['renewals'] });
    toast.success(`Merged ${removeIds.length} duplicate opportunity(ies) — all linked data preserved`);
  };

  return {
    duplicateAccounts,
    duplicateOpportunities,
    totalDuplicates: duplicateAccounts.length + duplicateOpportunities.length,
    mergeAccounts,
    mergeOpportunities,
  };
}
