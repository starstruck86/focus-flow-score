import { useMemo, useEffect, useState } from 'react';
import { useDbOpportunities, useUpdateOpportunity, useDeleteOpportunity } from '@/hooks/useAccountsData';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { normalize, isSimilar } from '@/lib/stringUtils';

export interface DuplicateGroup {
  type: 'account' | 'opportunity';
  key: string;
  items: DuplicateItem[];
}

export interface DuplicateItem {
  id: string;
  name: string;
  type: 'account' | 'opportunity';
  createdAt: string;
  linkedCount: number;
  details: Record<string, any>;
}

// ---- helpers ----

/** Pick the most recent non-null date string */
function latestDate(...dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return valid[0];
}

/** Combine notes strings, deduplicating */
function combineNotes(...notes: (string | null | undefined)[]): string | null {
  const parts = notes.filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const unique = [...new Set(parts)];
  return unique.join('\n---\n');
}

/** Pick max numeric value */
function maxNum(...vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

// ---- hook ----

export function useDuplicateDetection() {
  const { accounts, opportunities, tasks } = useStore();
  const { data: dbOpps = [] } = useDbOpportunities();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const updateOpp = useUpdateOpportunity();
  const deleteOpp = useDeleteOpportunity();

  // DB-backed dismissed keys
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [dismissedLoaded, setDismissedLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('dismissed_duplicates')
      .select('duplicate_key')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) setDismissedKeys(new Set(data.map(r => r.duplicate_key)));
        setDismissedLoaded(true);
      });
  }, [user]);

  const dismissGroup = async (key: string, recordType: 'account' | 'opportunity') => {
    if (!user) return;
    setDismissedKeys(prev => new Set(prev).add(key));
    await supabase.from('dismissed_duplicates').upsert(
      { user_id: user.id, duplicate_key: key, record_type: recordType },
      { onConflict: 'user_id,record_type,duplicate_key' }
    );
  };

  const duplicateAccounts = useMemo(() => {
    if (!dismissedLoaded) return [];
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
        const key = normalize(accounts[i].name);
        if (dismissedKeys.has(key)) continue;
        groups.push({
          type: 'account',
          key,
          items: cluster.map(a => {
            const linkedOpps = opportunities.filter(o => o.accountId === a.id).length;
            const linkedTasks = tasks.filter(t => t.linkedAccountId === a.id).length;
            return {
              id: a.id, name: a.name, type: 'account' as const,
              createdAt: a.createdAt || '', linkedCount: linkedOpps + linkedTasks,
              details: { tier: a.tier, status: a.accountStatus, website: a.website, industry: a.industry, opportunities: linkedOpps, tasks: linkedTasks },
            };
          }),
        });
      }
    }
    return groups;
  }, [accounts, opportunities, tasks, dismissedKeys, dismissedLoaded]);

  const duplicateOpportunities = useMemo(() => {
    if (!dismissedLoaded) return [];
    const groups: DuplicateGroup[] = [];
    const used = new Set<string>();

    for (let i = 0; i < opportunities.length; i++) {
      if (used.has(opportunities[i].id)) continue;
      const cluster = [opportunities[i]];

      for (let j = i + 1; j < opportunities.length; j++) {
        if (used.has(opportunities[j].id)) continue;
        if (isSimilar(opportunities[i].name, opportunities[j].name)) {
          cluster.push(opportunities[j]);
          used.add(opportunities[j].id);
        }
      }

      if (cluster.length > 1) {
        used.add(opportunities[i].id);
        const key = normalize(opportunities[i].name);
        if (dismissedKeys.has(key)) continue;
        groups.push({
          type: 'opportunity',
          key,
          items: cluster.map(o => {
            const linkedTasks = tasks.filter(t => t.linkedOpportunityId === o.id).length;
            return {
              id: o.id, name: o.name, type: 'opportunity' as const,
              createdAt: o.createdAt || '', linkedCount: linkedTasks,
              details: {
                status: o.status, stage: o.stage, arr: o.arr, accountId: o.accountId,
                closeDate: o.closeDate, nextStep: o.nextStep, tasks: linkedTasks,
                isInDb: dbOpps.some(d => d.id === o.id),
              },
            };
          }),
        });
      }
    }
    return groups;
  }, [opportunities, tasks, dbOpps, dismissedKeys, dismissedLoaded]);

  // ---- Merge accounts ----
  const mergeAccounts = async (keepId: string, removeIds: string[]) => {
    if (!user) return;
    // Auto-dismiss this duplicate group so it never resurfaces
    const keepAcct = accounts.find(a => a.id === keepId);
    if (keepAcct) {
      const key = normalize(keepAcct.name);
      await dismissGroup(key, 'account');
    }
    for (const removeId of removeIds) {
      // Also dismiss by each removed account's normalized name
      const removedAcct = accounts.find(a => a.id === removeId);
      if (removedAcct) {
        await dismissGroup(normalize(removedAcct.name), 'account');
      }
      await supabase.from('opportunities').update({ account_id: keepId }).eq('account_id', removeId);
      await supabase.from('contacts').update({ account_id: keepId }).eq('account_id', removeId);
      await supabase.from('account_contacts').update({ account_id: keepId }).eq('account_id', removeId);
      await supabase.from('call_transcripts').update({ account_id: keepId }).eq('account_id', removeId);
      await supabase.from('resources').update({ account_id: keepId }).eq('account_id', removeId);
      await supabase.from('accounts').delete().eq('id', removeId);
      const store = useStore.getState();
      if (typeof store.deleteAccount === 'function') store.deleteAccount(removeId);
    }
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    toast.success(`Merged ${removeIds.length} duplicate account(s) — all linked data preserved`);
  };

  // ---- Smart merge opportunities ----
  const mergeOpportunities = async (keepId: string, removeIds: string[]) => {
    if (!user) return;

    // Auto-dismiss this duplicate group so it never resurfaces
    const keepOpp = opportunities.find(o => o.id === keepId);
    if (keepOpp) {
      const key = normalize(keepOpp.name);
      await dismissGroup(key, 'opportunity');
    }
    for (const rid of removeIds) {
      const removedOpp = opportunities.find(o => o.id === rid);
      if (removedOpp) {
        await dismissGroup(normalize(removedOpp.name), 'opportunity');
      }
    }

    // Gather all records to combine fields
    const allIds = [keepId, ...removeIds];
    const allOpps = allIds.map(id => opportunities.find(o => o.id === id)).filter(Boolean) as typeof opportunities;

    // Build merged field values
    const mergedNotes = combineNotes(...allOpps.map(o => o.notes));
    const mergedNextStep = combineNotes(...allOpps.map(o => o.nextStep));
    const mergedNextStepDate = latestDate(...allOpps.map(o => o.nextStepDate));
    const mergedLastTouchDate = latestDate(...allOpps.map(o => o.lastTouchDate));
    const mergedCloseDate = latestDate(...allOpps.map(o => o.closeDate));
    const mergedArr = maxNum(...allOpps.map(o => o.arr));
    // Prefer the most advanced stage (latest updated record's stage if non-empty)
    const stagesRanked = allOpps
      .filter(o => o.stage)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || '').getTime() - new Date(a.updatedAt || a.createdAt || '').getTime());
    const mergedStage = stagesRanked[0]?.stage || allOpps.find(o => o.stage)?.stage || null;

    // Update the keep record with combined data
    const updates: Record<string, any> = {};
    if (mergedNotes) updates.notes = mergedNotes;
    if (mergedNextStep) updates.next_step = mergedNextStep;
    if (mergedNextStepDate) updates.next_step_date = mergedNextStepDate;
    if (mergedLastTouchDate) updates.last_touch_date = mergedLastTouchDate;
    if (mergedCloseDate) updates.close_date = mergedCloseDate;
    if (mergedArr != null) updates.arr = mergedArr;
    if (mergedStage) updates.stage = mergedStage;

    if (Object.keys(updates).length > 0) {
      await supabase.from('opportunities').update(updates).eq('id', keepId);
    }

    // Reassign linked records from removed opps
    for (const removeId of removeIds) {
      await supabase.from('call_transcripts').update({ opportunity_id: keepId }).eq('opportunity_id', removeId);
      await supabase.from('resources').update({ opportunity_id: keepId }).eq('opportunity_id', removeId);
      await supabase.from('renewals').update({ linked_opportunity_id: keepId }).eq('linked_opportunity_id', removeId);
      await supabase.from('opportunities').delete().eq('id', removeId);

      const store = useStore.getState();
      if (typeof store.deleteOpportunity === 'function') store.deleteOpportunity(removeId);
    }

    // Reassign tasks in store
    const { updateTask, tasks: currentTasks } = useStore.getState();
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
    dismissGroup,
    dismissedKeys,
  };
}
