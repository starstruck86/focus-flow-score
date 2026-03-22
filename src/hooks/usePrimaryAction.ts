// Primary Action Engine — selects the SINGLE highest-ROI action
// Uses existing store data. ONE action only. No lists.
// Extended with: cost-of-delay, momentum awareness, pipeline creation, kill switch.
// Updated: reflects Target Account → Contact → Outreach → Meeting → Opportunity flow.

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useMomentumEngine } from '@/hooks/useMomentumEngine';
import {
  oppNoNextStepDelay,
  staleDealDelay,
  renewalRiskDelay,
  taskOverdueDelay,
  pipelineGapDelay,
  outreachGapDelay,
} from '@/hooks/useCostOfDelay';

export interface PrimaryAction {
  id: string;
  action: string;
  why: string;
  nextStep: string;
  entityType: 'opportunity' | 'task' | 'renewal' | 'account' | 'system';
  entityId?: string;
  entityName?: string;
  score: number;
  delayConsequence?: string;
  escalation?: 'critical' | 'high' | 'moderate' | 'low';
}

// Kill switch: detect low-value work that should be deprioritized
function isLowValueTarget(item: { arr?: number; lastTouchDate?: string }): boolean {
  const arrK = (item.arr || 0) / 1000;
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
        const records = JSON.parse(raw) as Array<{ actionId: string; outcome: string; timestamp: number }>;
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
      if (ignores >= 4) return score * 0.3;
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
      if (isLowValueTarget(opp)) continue;

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

    // ═══ 5. TARGET ACCOUNT PIPELINE ENGINE ═══
    // Full funnel: Target Accounts → Contacts → Outreach → Meetings → Opportunities

    const targetAccounts = accounts.filter(a => a.motion === 'new-logo');

    // 5a. Pipeline dry — need to select target accounts
    if (momentum.pipelineCreationLabel === 'dry' || momentum.targetAccountGap) {
      let daysSinceTargetActivity = 14;
      for (const a of targetAccounts) {
        if (a.lastTouchDate) {
          const d = Math.ceil((now.getTime() - new Date(a.lastTouchDate).getTime()) / 86400000);
          if (d < daysSinceTargetActivity) daysSinceTargetActivity = d;
        }
      }
      const delay = pipelineGapDelay(daysSinceTargetActivity);
      const actionId = 'system-select-target-accounts';
      const baseScore = 130 * delay.decayMultiplier;
      candidates.push({
        id: actionId,
        action: 'Select 3–5 target accounts for outreach',
        why: `Pipeline creation ${momentum.pipelineCreationLabel} — ${daysSinceTargetActivity}d since target account activity`,
        nextStep: 'Review your territory and pick accounts to work this week.',
        entityType: 'system',
        score: applyMemoryAdjustment(baseScore, actionId),
        delayConsequence: delay.delayConsequence,
        escalation: delay.escalationLevel,
      });
    }

    // 5b. Target accounts exist but need contacts added
    const accountsNeedingContacts = targetAccounts.filter(a =>
      (a.accountStatus === 'researching' || a.accountStatus === 'prepped') &&
      (!a.contactStatus || a.contactStatus === 'not-started') &&
      a.outreachStatus === 'not-started'
    );
    if (accountsNeedingContacts.length > 0) {
      const topAccount = accountsNeedingContacts[0];
      const actionId = `account-add-contacts-${topAccount.id}`;
      candidates.push({
        id: actionId,
        action: `Add contacts to "${topAccount.name}"`,
        why: `Target account prepped but no contacts identified`,
        nextStep: 'Find 3–5 key contacts and add them to the account.',
        entityType: 'account',
        entityId: topAccount.id,
        entityName: topAccount.name,
        score: applyMemoryAdjustment(85, actionId),
        escalation: 'moderate',
      });
    }

    // 5c. Contacts exist but outreach not started
    const accountsNeedingOutreach = targetAccounts.filter(a =>
      (a.contactStatus === 'ready' || a.contactStatus === 'in-progress') &&
      (a.outreachStatus === 'not-started')
    );
    if (accountsNeedingOutreach.length > 0) {
      const delay = outreachGapDelay(accountsNeedingOutreach.length);
      const topAccount = accountsNeedingOutreach[0];
      const actionId = `account-start-outreach-${topAccount.id}`;
      candidates.push({
        id: actionId,
        action: `Start outreach for "${topAccount.name}"`,
        why: `Contacts ready — outreach not started`,
        nextStep: 'Generate outreach and add contacts to cadence.',
        entityType: 'account',
        entityId: topAccount.id,
        entityName: topAccount.name,
        score: applyMemoryAdjustment(95 * delay.decayMultiplier, actionId),
        delayConsequence: delay.delayConsequence,
        escalation: delay.escalationLevel,
      });
    }

    // 5d. Outreach in progress but no meetings — push for meeting
    const accountsNeedingMeetings = targetAccounts.filter(a =>
      a.outreachStatus && ['in-progress', 'working', 'nurture'].includes(a.outreachStatus) &&
      a.lastTouchDate
    );
    for (const a of accountsNeedingMeetings) {
      const daysSince = Math.ceil((now.getTime() - new Date(a.lastTouchDate!).getTime()) / 86400000);
      if (daysSince >= 5) {
        const actionId = `account-push-meeting-${a.id}`;
        candidates.push({
          id: actionId,
          action: `Push for meeting with "${a.name}"`,
          why: `Outreach active, ${daysSince}d since last touch — no meeting set`,
          nextStep: 'Follow up or try a different channel to book a meeting.',
          entityType: 'account',
          entityId: a.id,
          entityName: a.name,
          score: applyMemoryAdjustment(70, actionId),
          escalation: 'low',
        });
      }
    }

    if (candidates.length === 0) return null;

    // Sort and return ONLY the top one
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }, [opportunities, tasks, renewals, accounts, momentum]);
}
