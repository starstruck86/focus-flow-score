import { useStore } from '@/store/useStore';
import { useWeekToDateMetrics } from '@/hooks/useGoodDayMetrics';
import type { Task, Workstream } from '@/types';
import { toast } from 'sonner';

const DEFAULT_TARGETS = {
  prospectsAdded: 20,
  conversations: 3,
  managerPlusMessages: 5,
  meetingsSet: 1,
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function useAutoGenerateTasks() {
  const { addTask, renewals, opportunities, accounts } = useStore();

  const generateFromGaps = (wtdMetrics: any, daysElapsed: number) => {
    const tasks: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>[] = [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // 1. Biggest metric gaps
    const weeklyTargets = {
      conversations: DEFAULT_TARGETS.conversations * 5,
      prospectsAdded: DEFAULT_TARGETS.prospectsAdded * 5,
      meetingsSet: DEFAULT_TARGETS.meetingsSet * 5,
    };

    const expectedByNow = (target: number) => Math.round((target / 5) * daysElapsed);

    if (wtdMetrics.conversations < expectedByNow(weeklyTargets.conversations)) {
      const gap = expectedByNow(weeklyTargets.conversations) - wtdMetrics.conversations;
      tasks.push({
        title: `Power Hour: ${gap} more conversations needed this week`,
        workstream: 'pg' as Workstream,
        status: 'next',
        priority: 'P1',
        dueDate: tomorrowStr,
        notes: `You're ${gap} conversations behind pace. Block 30min for a power hour.`,
      });
    }

    if (wtdMetrics.prospectsAdded < expectedByNow(weeklyTargets.prospectsAdded)) {
      const gap = expectedByNow(weeklyTargets.prospectsAdded) - wtdMetrics.prospectsAdded;
      tasks.push({
        title: `Add ${gap} more prospects to cadence`,
        workstream: 'pg' as Workstream,
        status: 'next',
        priority: 'P2',
        dueDate: tomorrowStr,
      });
    }

    // 2. At-risk renewals with no next step
    const urgentRenewals = renewals.filter(r =>
      r.daysToRenewal <= 30 && !r.nextStep && (r.churnRisk === 'high' || r.churnRisk === 'certain')
    ).slice(0, 2);

    urgentRenewals.forEach(r => {
      tasks.push({
        title: `Set next step for ${r.accountName} renewal (${r.daysToRenewal}d out)`,
        workstream: 'renewals' as Workstream,
        status: 'next',
        priority: 'P0',
        dueDate: tomorrowStr,
        linkedAccountId: r.accountId || undefined,
      });
    });

    // 3. Stale active opps
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const staleOppStr = fourteenDaysAgo.toISOString().split('T')[0];

    const staleOpps = opportunities.filter(o =>
      o.status === 'active' && (!o.lastTouchDate || o.lastTouchDate < staleOppStr)
    ).slice(0, 1);

    staleOpps.forEach(o => {
      tasks.push({
        title: `Re-engage stale opp: ${o.name}`,
        workstream: 'pg' as Workstream,
        status: 'next',
        priority: 'P1',
        dueDate: tomorrowStr,
        linkedOpportunityId: o.id,
        linkedAccountId: o.accountId,
      });
    });

    // Only add top 3
    const topTasks = tasks.slice(0, 3);
    topTasks.forEach(t => addTask(t as any));

    if (topTasks.length > 0) {
      toast.success(`${topTasks.length} tasks auto-generated for tomorrow`, { duration: 4000 });
    }

    return topTasks.length;
  };

  return { generateFromGaps };
}
