// Primary Action Engine — selects the SINGLE highest-ROI action
// Uses existing store data. ONE action only. No lists.

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useStaleItems } from '@/hooks/useStaleItems';

export interface PrimaryAction {
  id: string;             // unique key for memory tracking
  action: string;         // what to do
  why: string;            // why it matters
  nextStep: string;       // immediate next step
  entityType: 'opportunity' | 'task' | 'renewal' | 'account' | 'system';
  entityId?: string;
  entityName?: string;
  score: number;          // internal ranking score
}

export function usePrimaryAction(): PrimaryAction | null {
  const { opportunities, tasks, renewals, accounts } = useStore();

  return useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const candidates: PrimaryAction[] = [];

    // 1. Overdue P1 tasks (highest urgency)
    const overdueTasks = tasks.filter(t =>
      (t.status === 'next' || t.status === 'in-progress') &&
      t.dueDate && t.dueDate < todayStr
    );
    for (const task of overdueTasks) {
      const priorityWeight = task.priority === 'P0' ? 5 : task.priority === 'P1' ? 4 : task.priority === 'P2' ? 2 : 1;
      const daysOverdue = Math.ceil((now.getTime() - new Date(task.dueDate!).getTime()) / 86400000);
      candidates.push({
        id: `task-${task.id}`,
        action: task.title,
        why: `${task.priority} task, ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`,
        nextStep: 'Complete or reschedule this task now.',
        entityType: 'task',
        entityId: task.id,
        entityName: task.title,
        score: 50 * priorityWeight + daysOverdue * 5,
      });
    }

    // 2. Active high-value deals with no next step
    const activeOpps = opportunities.filter(o => o.status === 'active');
    for (const opp of activeOpps) {
      if (!opp.nextStep && !opp.nextStepDate) {
        const arrK = (opp.arr || 0) / 1000;
        candidates.push({
          id: `opp-nextstep-${opp.id}`,
          action: `Set next step on "${opp.name}"`,
          why: `$${arrK.toFixed(0)}k deal with no defined next step`,
          nextStep: 'Define what needs to happen next to advance this deal.',
          entityType: 'opportunity',
          entityId: opp.id,
          entityName: opp.name,
          score: 100 + arrK * 0.5,
        });
      }

      // Stale high-value deals
      if (opp.lastTouchDate) {
        const daysSince = Math.ceil((now.getTime() - new Date(opp.lastTouchDate).getTime()) / 86400000);
        if (daysSince >= 7) {
          const arrK = (opp.arr || 0) / 1000;
          candidates.push({
            id: `opp-stale-${opp.id}`,
            action: `Re-engage "${opp.name}"`,
            why: `$${arrK.toFixed(0)}k deal, ${daysSince} days since last touch`,
            nextStep: 'Reach out to your champion or schedule a check-in.',
            entityType: 'opportunity',
            entityId: opp.id,
            entityName: opp.name,
            score: arrK * (daysSince / 7) * 0.8,
          });
        }
      }
    }

    // 3. At-risk renewals
    for (const r of renewals) {
      if (r.daysToRenewal <= 30 && (r.churnRisk === 'high' || r.churnRisk === 'certain')) {
        candidates.push({
          id: `renewal-risk-${r.id}`,
          action: `Address renewal risk: ${r.accountName}`,
          why: `$${((r.arr || 0) / 1000).toFixed(0)}k renewal in ${r.daysToRenewal} days, ${r.churnRisk} churn risk`,
          nextStep: r.nextStep || 'Schedule a risk mitigation call with the CS team.',
          entityType: 'renewal',
          entityId: r.id,
          entityName: r.accountName,
          score: 180 + (r.arr || 0) / 1000,
        });
      }
    }

    // 4. Today's P1 tasks (not overdue)
    const todayP1 = tasks.filter(t =>
      (t.status === 'next' || t.status === 'in-progress') &&
      t.dueDate === todayStr && (t.priority === 'P0' || t.priority === 'P1')
    );
    for (const task of todayP1) {
      candidates.push({
        id: `task-today-${task.id}`,
        action: task.title,
        why: `${task.priority} task due today`,
        nextStep: 'Execute this now.',
        entityType: 'task',
        entityId: task.id,
        entityName: task.title,
        score: task.priority === 'P0' ? 160 : 90,
      });
    }

    if (candidates.length === 0) return null;

    // Sort and return ONLY the top one
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }, [opportunities, tasks, renewals, accounts]);
}
