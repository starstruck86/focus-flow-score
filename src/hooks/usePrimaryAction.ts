// Primary Action Engine — selects the SINGLE highest-ROI action
// Uses existing store data. ONE action only. No lists.
// Extended with: cost-of-delay, momentum awareness, pipeline creation, kill switch.

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useStaleItems } from '@/hooks/useStaleItems';
import { useMomentumEngine } from '@/hooks/useMomentumEngine';
import {
  oppNoNextStepDelay,
  staleDealDelay,
  renewalRiskDelay,
  taskOverdueDelay,
  pipelineGapDelay,
} from '@/hooks/useCostOfDelay';

export interface PrimaryAction {
  id: string;             // unique key for memory tracking
  action: string;         // what to do
  why: string;            // why it matters
  nextStep: string;       // immediate next step
  entityType: 'opportunity' | 'task' | 'renewal' | 'account' | 'system';
  entityId?: string;
  entityName?: string;
  score: number;          // internal ranking score
  delayConsequence?: string; // what happens if delayed
  escalation?: 'critical' | 'high' | 'moderate' | 'low';
}

// Kill switch: detect low-value work that should be deprioritized
function isLowValueTarget(item: { arr?: number; lastTouchDate?: string; status?: string; stage?: string }): boolean {
  const arrK = (item.arr || 0) / 1000;
  // Very low value + stale = kill candidate
  if (arrK < 10 && item.lastTouchDate) {
    const daysSince = Math.ceil((Date.now() - new Date(item.lastTouchDate).getTime()) / 86400000);
    if (daysSince > 30) return true;
  }
  return false;
}

export function usePrimaryAction(): PrimaryAction | null {
  const { opportunities, tasks, renewals, accounts } = useStore();
  const momentum = useMomentumEngine();

  return useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const candidates: PrimaryAction[] = [];

    // ── Action Memory: load ignore counts for score adjustment ──
    let ignoreMap: Record<string, number> = {};
    try {
      const raw = localStorage.getItem('jarvis-action-memory');
      if (raw) {
        const records = JSON.parse(raw) as any[];
        const weekAgo = Date.now() - 7 * 86400000;
        for (const r of records) {
          if (r.outcome === 'ignored' && r.timestamp > weekAgo) {
            ignoreMap[r.actionId] = (ignoreMap[r.actionId] || 0) + 1;
          }
        }
      }
    } catch {}

    function applyMemoryAdjustment(score: number, actionId: string): number {
      const ignores = ignoreMap[actionId] || 0;
      if (ignores >= 4) return score * 0.3;  // heavily suppress
      if (ignores >= 3) return score * 0.5;
      if (ignores >= 2) return score * 0.7;
      if (ignores >= 1) return score * 0.9;
      return score;
    }

    // ═══ 1. Overdue tasks (highest urgency) ═══
    const overdueTasks = tasks.filter(t =>
      (t.status === 'next' || t.status === 'in-progress') &&
      t.dueDate && t.dueDate < todayStr
    );
    for (const task of overdueTasks) {
      const daysOverdue = Math.ceil((now.getTime() - new Date(task.dueDate!).getTime()) / 86400000);
      const delay = taskOverdueDelay(task.priority || 'P2', daysOverdue);
      const baseScore = 50 * delay.decayMultiplier;
      const actionId = `task-${task.id}`;
      candidates.push({
        id: actionId,
        action: task.title,
        why: `${task.priority} task, ${daysOverdue}d overdue`,
        nextStep: 'Complete or reschedule this task now.',
        entityType: 'task',
        entityId: task.id,
        entityName: task.title,
        score: applyMemoryAdjustment(baseScore, actionId),
        delayConsequence: delay.delayConsequence,
        escalation: delay.escalationLevel,
      });
    }

    // ═══ 2. Active deals with no next step ═══
    const activeOpps = opportunities.filter(o => o.status === 'active');
    for (const opp of activeOpps) {
      if (isLowValueTarget(opp)) continue; // Kill switch

      if (!opp.nextStep && !opp.nextStepDate) {
        const arrK = (opp.arr || 0) / 1000;
        const daysSince = opp.lastTouchDate
          ? Math.ceil((now.getTime() - new Date(opp.lastTouchDate).getTime()) / 86400000)
          : 14;
        const delay = oppNoNextStepDelay(arrK, daysSince);
        const baseScore = (100 + arrK * 0.5) * delay.decayMultiplier;
        const actionId = `opp-nextstep-${opp.id}`;
        candidates.push({
          id: actionId,
          action: `Set next step on "${opp.name}"`,
          why: `$${arrK.toFixed(0)}k deal — no defined next step`,
          nextStep: 'Define what needs to happen next to advance this deal.',
          entityType: 'opportunity',
          entityId: opp.id,
          entityName: opp.name,
          score: applyMemoryAdjustment(baseScore, actionId),
          delayConsequence: delay.delayConsequence,
          escalation: delay.escalationLevel,
        });
      }

      // Stale high-value deals
      if (opp.lastTouchDate) {
        const daysSince = Math.ceil((now.getTime() - new Date(opp.lastTouchDate).getTime()) / 86400000);
        if (daysSince >= 7 && !isLowValueTarget(opp)) {
          const arrK = (opp.arr || 0) / 1000;
          const delay = staleDealDelay(arrK, daysSince, opp.closeDate);
          const baseScore = arrK * (daysSince / 7) * 0.8 * delay.decayMultiplier;
          const actionId = `opp-stale-${opp.id}`;
          candidates.push({
            id: actionId,
            action: `Re-engage "${opp.name}"`,
            why: `$${arrK.toFixed(0)}k deal, ${daysSince}d since last touch`,
            nextStep: 'Reach out to your champion or schedule a check-in.',
            entityType: 'opportunity',
            entityId: opp.id,
            entityName: opp.name,
            score: applyMemoryAdjustment(baseScore, actionId),
            delayConsequence: delay.delayConsequence,
            escalation: delay.escalationLevel,
          });
        }
      }
    }

    // ═══ 3. At-risk renewals ═══
    for (const r of renewals) {
      if (r.daysToRenewal <= 30 && (r.churnRisk === 'high' || r.churnRisk === 'certain')) {
        const arrK = (r.arr || 0) / 1000;
        const delay = renewalRiskDelay(arrK, r.daysToRenewal, r.churnRisk || 'low');
        const baseScore = (180 + arrK) * delay.decayMultiplier;
        const actionId = `renewal-risk-${r.id}`;
        candidates.push({
          id: actionId,
          action: `Address renewal risk: ${r.accountName}`,
          why: `$${arrK.toFixed(0)}k renewal in ${r.daysToRenewal}d, ${r.churnRisk} risk`,
          nextStep: r.nextStep || 'Schedule a risk mitigation call with the CS team.',
          entityType: 'renewal',
          entityId: r.id,
          entityName: r.accountName,
          score: applyMemoryAdjustment(baseScore, actionId),
          delayConsequence: delay.delayConsequence,
          escalation: delay.escalationLevel,
        });
      }
    }

    // ═══ 4. Today's P0/P1 tasks (not overdue) ═══
    const todayP1 = tasks.filter(t =>
      (t.status === 'next' || t.status === 'in-progress') &&
      t.dueDate === todayStr && (t.priority === 'P0' || t.priority === 'P1')
    );
    for (const task of todayP1) {
      const actionId = `task-today-${task.id}`;
      candidates.push({
        id: actionId,
        action: task.title,
        why: `${task.priority} task due today`,
        nextStep: 'Execute this now.',
        entityType: 'task',
        entityId: task.id,
        entityName: task.title,
        score: applyMemoryAdjustment(task.priority === 'P0' ? 160 : 90, actionId),
        escalation: 'moderate',
      });
    }

    // ═══ 5. PIPELINE CREATION ENGINE ═══
    // If momentum shows pipeline is dry or new logo gap, inject a pipeline creation action
    if (momentum.pipelineCreationLabel === 'dry' || momentum.newLogoGap) {
      // Calculate days since last new-logo activity
      const newLogoAccounts = accounts.filter(a => a.motion === 'new-logo');
      let daysSinceNewActivity = 14; // default high
      for (const a of newLogoAccounts) {
        if (a.lastTouchDate) {
          const d = Math.ceil((now.getTime() - new Date(a.lastTouchDate).getTime()) / 86400000);
          if (d < daysSinceNewActivity) daysSinceNewActivity = d;
        }
      }
      const delay = pipelineGapDelay(daysSinceNewActivity);
      const actionId = 'system-pipeline-creation';
      const baseScore = 130 * delay.decayMultiplier;
      candidates.push({
        id: actionId,
        action: 'Start prospecting — identify 3 new accounts',
        why: `Pipeline creation ${momentum.pipelineCreationLabel} — ${daysSinceNewActivity}d since new logo activity`,
        nextStep: 'Review your target accounts or ask Dave to suggest accounts to prospect.',
        entityType: 'system',
        score: applyMemoryAdjustment(baseScore, actionId),
        delayConsequence: delay.delayConsequence,
        escalation: delay.escalationLevel,
      });
    }

    if (candidates.length === 0) return null;

    // Sort and return ONLY the top one
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }, [opportunities, tasks, renewals, accounts, momentum]);
}
