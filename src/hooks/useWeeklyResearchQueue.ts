/**
 * Hook: useWeeklyResearchQueue
 * 
 * Manages a fixed 15-account weekly research queue (3 per day, Mon–Fri).
 * Persists to weekly_research_queue table. Logs events idempotently to
 * research_queue_events table for future analysis.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, format } from 'date-fns';
import { scoreAccountForQueue, filterEligible, isEligibleForQueue } from '@/lib/weeklyResearchQueue';
import { toast } from 'sonner';

// ── Types ──

export type AccountState = 'not_started' | 'researched' | 'added_to_cadence';

export interface QueueAccount {
  id: string;
  name: string;
  state: AccountState;
  tier?: string;
  industry?: string;
}

export interface WeeklyAssignments {
  monday: QueueAccount[];
  tuesday: QueueAccount[];
  wednesday: QueueAccount[];
  thursday: QueueAccount[];
  friday: QueueAccount[];
}

const DAY_KEYS: (keyof WeeklyAssignments)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function emptyAssignments(): WeeklyAssignments {
  return { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] };
}

function todayDayKey(): keyof WeeklyAssignments | null {
  const day = new Date().getDay(); // 0=Sun
  if (day >= 1 && day <= 5) return DAY_KEYS[day - 1];
  return null;
}

function getWeekStart(): string {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

// ── Hook ──

export function useWeeklyResearchQueue() {
  const { user } = useAuth();
  const { accounts, opportunities } = useStore();
  const weekStart = getWeekStart();

  const [assignments, setAssignments] = useState<WeeklyAssignments>(emptyAssignments());
  const [queueId, setQueueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Active opp account IDs for eligibility filtering
  const activeOppAccountIds = useMemo(() => new Set(
    opportunities
      .filter(o => o.status === 'active' || o.status === 'stalled')
      .map(o => o.accountId)
      .filter(Boolean) as string[]
  ), [opportunities]);

  // ── Load existing queue ──
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('weekly_research_queue' as any)
        .select('*')
        .eq('user_id', user.id)
        .eq('week_start', weekStart)
        .maybeSingle();

      if (!error && data) {
        setQueueId((data as any).id);
        const a = (data as any).assignments as WeeklyAssignments;
        // Validate structure
        const valid = DAY_KEYS.every(k => Array.isArray(a?.[k]));
        setAssignments(valid ? a : emptyAssignments());
      }
      setLoading(false);
    })();
  }, [user, weekStart]);

  // ── Generate queue (if empty) ──
  const generateQueue = useCallback(async () => {
    if (!user || !accounts.length) return;

    const eligible = filterEligible(accounts, activeOppAccountIds);
    const scored = eligible
      .map(a => ({ account: a, score: scoreAccountForQueue(a) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    const newAssignments: WeeklyAssignments = emptyAssignments();
    scored.forEach((s, i) => {
      const dayIdx = Math.floor(i / 3);
      if (dayIdx < 5) {
        const day = DAY_KEYS[dayIdx];
        newAssignments[day].push({
          id: s.account.id,
          name: s.account.name,
          state: 'not_started',
          tier: s.account.tier,
          industry: s.account.industry,
        });
      }
    });

    const { data, error } = await supabase
      .from('weekly_research_queue' as any)
      .upsert({
        user_id: user.id,
        week_start: weekStart,
        assignments: newAssignments,
      } as any, { onConflict: 'user_id,week_start' })
      .select()
      .single();

    if (!error && data) {
      setQueueId((data as any).id);
      setAssignments(newAssignments);
      toast.success('Weekly research queue generated — 15 accounts, 3 per day');
    } else {
      toast.error('Failed to generate queue');
    }
  }, [user, accounts, activeOppAccountIds, weekStart]);

  // ── Persist assignments ──
  const persistAssignments = useCallback(async (updated: WeeklyAssignments) => {
    if (!user) return;
    setAssignments(updated);
    await supabase
      .from('weekly_research_queue' as any)
      .upsert({
        user_id: user.id,
        week_start: weekStart,
        assignments: updated,
      } as any, { onConflict: 'user_id,week_start' });
  }, [user, weekStart]);

  // ── Advance state (idempotent event logging) ──
  const advanceState = useCallback(async (
    day: keyof WeeklyAssignments,
    accountId: string,
    newState: 'researched' | 'added_to_cadence',
  ) => {
    if (!user) return;

    const updated = { ...assignments };
    const dayAccounts = [...updated[day]];
    const idx = dayAccounts.findIndex(a => a.id === accountId);
    if (idx === -1) return;

    const current = dayAccounts[idx];
    // Don't go backwards
    if (newState === 'researched' && current.state === 'added_to_cadence') return;
    if (current.state === newState) return; // Already in this state

    dayAccounts[idx] = { ...current, state: newState };
    updated[day] = dayAccounts;

    // Persist assignment state
    await persistAssignments(updated);

    // Log event idempotently (UNIQUE constraint prevents duplicates)
    await supabase
      .from('research_queue_events' as any)
      .upsert({
        user_id: user.id,
        account_id: accountId,
        account_name: current.name,
        week_start: weekStart,
        assigned_day: day,
        event_type: newState,
      } as any, { onConflict: 'user_id,account_id,week_start,event_type' });

    // If advancing from not_started to added_to_cadence, also log researched
    if (newState === 'added_to_cadence' && current.state === 'not_started') {
      await supabase
        .from('research_queue_events' as any)
        .upsert({
          user_id: user.id,
          account_id: accountId,
          account_name: current.name,
          week_start: weekStart,
          assigned_day: day,
          event_type: 'researched',
        } as any, { onConflict: 'user_id,account_id,week_start,event_type' });
    }
  }, [user, assignments, persistAssignments, weekStart]);

  // ── Remove account from a day ──
  const removeAccount = useCallback(async (day: keyof WeeklyAssignments, accountId: string) => {
    const updated = { ...assignments };
    updated[day] = updated[day].filter(a => a.id !== accountId);
    await persistAssignments(updated);
  }, [assignments, persistAssignments]);

  // ── Add account to a day (with eligibility check) ──
  const addAccount = useCallback(async (day: keyof WeeklyAssignments, account: { id: string; name: string; tier?: string; industry?: string }) => {
    if (assignments[day].length >= 3) {
      toast.error('Day already has 3 accounts — remove one first');
      return;
    }
    if (DAY_KEYS.some(k => assignments[k].some(a => a.id === account.id))) {
      toast.error('Account already in this week\'s queue');
      return;
    }
    // Validate eligibility
    const fullAccount = accounts.find(a => a.id === account.id);
    if (fullAccount && !isEligibleForQueue(fullAccount, activeOppAccountIds)) {
      toast.error('Account is not eligible (renewal, open opp, or closed)');
      return;
    }
    const updated = { ...assignments };
    updated[day] = [...updated[day], { ...account, state: 'not_started' as AccountState }];
    await persistAssignments(updated);
  }, [assignments, persistAssignments, accounts, activeOppAccountIds]);

  // ── Swap accounts between days ──
  const swapAccounts = useCallback(async (
    fromDay: keyof WeeklyAssignments, fromIdx: number,
    toDay: keyof WeeklyAssignments, toIdx: number,
  ) => {
    const updated = { ...assignments };
    const fromList = [...updated[fromDay]];
    const toList = fromDay === toDay ? fromList : [...updated[toDay]];
    const temp = fromList[fromIdx];
    fromList[fromIdx] = toList[toIdx];
    toList[toIdx] = temp;
    updated[fromDay] = fromList;
    if (fromDay !== toDay) updated[toDay] = toList;
    await persistAssignments(updated);
  }, [assignments, persistAssignments]);

  // ── Computed stats ──
  const todayKey = todayDayKey();
  const todayAccounts = todayKey ? assignments[todayKey] : [];

  const dailyProgress = todayAccounts.filter(a => a.state !== 'not_started').length;
  const weeklyResearched = DAY_KEYS.reduce((s, k) =>
    s + assignments[k].filter(a => a.state === 'researched' || a.state === 'added_to_cadence').length, 0);
  const weeklyAddedToCadence = DAY_KEYS.reduce((s, k) =>
    s + assignments[k].filter(a => a.state === 'added_to_cadence').length, 0);
  const weeklyTotal = DAY_KEYS.reduce((s, k) => s + assignments[k].length, 0);

  const isEmpty = weeklyTotal === 0;

  return {
    assignments,
    todayAccounts,
    todayKey,
    loading,
    isEmpty,
    queueId,
    // Stats
    dailyProgress,
    weeklyResearched,
    weeklyAddedToCadence,
    weeklyTotal,
    // Actions
    generateQueue,
    advanceState,
    removeAccount,
    addAccount,
    swapAccounts,
    // Constants
    DAY_KEYS,
    weekStart,
  };
}
