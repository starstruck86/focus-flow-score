// Primary Action Engine — selects the SINGLE highest-ROI action
// Uses deterministic scoring engine. ONE action only. No lists.
// Scoring: Revenue Impact (3-tier) + Time Sensitivity (3-tier) + Actionability (3-tier)

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useMomentumEngine } from '@/hooks/useMomentumEngine';
import {
  classifyRevenueImpact,
  classifyTimeSensitivity,
  classifyActionability,
  calculateScore,
  applyMemoryPenalty,
} from '@/lib/scoringEngine';
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

    // ── Action Memory: load ignore counts ──
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

    // ═══ 1. Overdue tasks ═══
    const overdueTasks = tasks.filter(t =>
      (t.status === 'next' || t.status === 'in-progress') &&
      t.dueDate && t.dueDate < todayStr
    );
    for (const task of overdueTasks) {
      const daysOverdue = Math.ceil((now.getTime() - new Date(task.dueDate!).getTime()) / 86400000);
      const delay = taskOverdueDelay(task.priority || 'P2', daysOverdue);
      const scored = calculateScore({
        revenueImpact: classifyRevenueImpact({ isClosingAction: false, arrK: 0, isPipelineCreation: false }),
        timeSensitivity: classifyTimeSensitivity({ dueToday: false, overdueDays: daysOverdue }),
        actionability: classifyActionability({ hasNextStep: true, hasContacts: false, needsClarification: false }),
      });
      const actionId = `task-${task.id}`;
      const adjustedScore = applyMemoryPenalty(scored.score * delay.decayMultiplier, ignoreMap[actionId] || 0);
      candidates.push({
        id: actionId,
        action: task.title,
        why: `${task.priority} task, ${daysOverdue}d overdue`,
        nextStep: 'Complete or reschedule this task now.',
        entityType: 'task',
        entityId: task.id,
        entityName: task.title,
        score: adjustedScore,
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
        const scored = calculateScore({
          revenueImpact: classifyRevenueImpact({ isClosingAction: true, arrK, isPipelineCreation: false }),
          timeSensitivity: classifyTimeSensitivity({ dueToday: true }),
          actionability: classifyActionability({ hasNextStep: false, hasContacts: true, needsClarification: true }),
        });
        const actionId = `opp-nextstep-${opp.id}`;
        candidates.push({
          id: actionId,
          action: `Set next step on "${opp.name}"`,
          why: `$${arrK.toFixed(0)}k deal — no defined next step`,
          nextStep: 'Define what needs to happen next to advance this deal.',
          entityType: 'opportunity',
          entityId: opp.id,
          entityName: opp.name,
          score: applyMemoryPenalty(scored.score * delay.decayMultiplier, ignoreMap[actionId] || 0),
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
          const scored = calculateScore({
            revenueImpact: classifyRevenueImpact({ isClosingAction: true, arrK, isPipelineCreation: false }),
            timeSensitivity: classifyTimeSensitivity({ dueToday: false, daysUntilDeadline: daysSince > 14 ? 0 : 2 }),
            actionability: classifyActionability({ hasNextStep: !!opp.nextStep, hasContacts: true, needsClarification: false }),
          });
          const actionId = `opp-stale-${opp.id}`;
          candidates.push({
            id: actionId,
            action: `Re-engage "${opp.name}"`,
            why: `$${arrK.toFixed(0)}k deal, ${daysSince}d since last touch`,
            nextStep: 'Reach out to your champion or schedule a check-in.',
            entityType: 'opportunity',
            entityId: opp.id,
            entityName: opp.name,
            score: applyMemoryPenalty(scored.score * delay.decayMultiplier, ignoreMap[actionId] || 0),
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
        const scored = calculateScore({
          revenueImpact: classifyRevenueImpact({ isClosingAction: true, arrK, isPipelineCreation: false }),
          timeSensitivity: classifyTimeSensitivity({ dueToday: r.daysToRenewal <= 1, daysUntilDeadline: r.daysToRenewal }),
          actionability: classifyActionability({ hasNextStep: !!r.nextStep, hasContacts: true, needsClarification: !r.nextStep }),
        });
        const actionId = `renewal-risk-${r.id}`;
        candidates.push({
          id: actionId,
          action: `Address renewal risk: ${r.accountName}`,
          why: `$${arrK.toFixed(0)}k renewal in ${r.daysToRenewal}d, ${r.churnRisk} risk`,
          nextStep: r.nextStep || 'Schedule a risk mitigation call with the CS team.',
          entityType: 'renewal',
          entityId: r.id,
          entityName: r.accountName,
          score: applyMemoryPenalty(scored.score * delay.decayMultiplier, ignoreMap[actionId] || 0),
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
      const scored = calculateScore({
        revenueImpact: classifyRevenueImpact({ isClosingAction: false, arrK: 0, isPipelineCreation: false }),
        timeSensitivity: classifyTimeSensitivity({ dueToday: true }),
        actionability: classifyActionability({ hasNextStep: true, hasContacts: false, needsClarification: false }),
      });
      const priorityBoost = task.priority === 'P0' ? 50 : 25;
      candidates.push({
        id: actionId,
        action: task.title,
        why: `${task.priority} task due today`,
        nextStep: 'Execute this now.',
        entityType: 'task',
        entityId: task.id,
        entityName: task.title,
        score: applyMemoryPenalty(scored.score + priorityBoost, ignoreMap[actionId] || 0),
        escalation: 'moderate',
      });
    }

    // ═══ 5. TARGET ACCOUNT PIPELINE ENGINE ═══
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
      const scored = calculateScore({
        revenueImpact: classifyRevenueImpact({ isClosingAction: false, arrK: 0, isPipelineCreation: true }),
        timeSensitivity: classifyTimeSensitivity({ dueToday: false, daysUntilDeadline: daysSinceTargetActivity > 7 ? 1 : 3 }),
        actionability: classifyActionability({ hasNextStep: true, hasContacts: false, needsClarification: false }),
      });
      const actionId = 'system-select-target-accounts';
      candidates.push({
        id: actionId,
        action: 'Select 3–5 target accounts for outreach',
        why: `Pipeline creation ${momentum.pipelineCreationLabel} — ${daysSinceTargetActivity}d since target account activity`,
        nextStep: 'Review your territory and pick accounts to work this week.',
        entityType: 'system',
        score: applyMemoryPenalty(scored.score * delay.decayMultiplier, ignoreMap[actionId] || 0),
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
      const scored = calculateScore({
        revenueImpact: classifyRevenueImpact({ isClosingAction: false, arrK: 0, isPipelineCreation: true }),
        timeSensitivity: classifyTimeSensitivity({ dueToday: false, daysUntilDeadline: 3 }),
        actionability: classifyActionability({ hasNextStep: true, hasContacts: false, needsClarification: false }),
      });
      candidates.push({
        id: actionId,
        action: `Add contacts to "${topAccount.name}"`,
        why: `Target account prepped but no contacts identified`,
        nextStep: 'Find 3–5 key contacts and add them to the account.',
        entityType: 'account',
        entityId: topAccount.id,
        entityName: topAccount.name,
        score: applyMemoryPenalty(scored.score, ignoreMap[actionId] || 0),
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
      const scored = calculateScore({
        revenueImpact: classifyRevenueImpact({ isClosingAction: false, arrK: 0, isPipelineCreation: true }),
        timeSensitivity: classifyTimeSensitivity({ dueToday: false, daysUntilDeadline: 2 }),
        actionability: classifyActionability({ hasNextStep: true, hasContacts: true, needsClarification: false }),
      });
      candidates.push({
        id: actionId,
        action: `Start outreach for "${topAccount.name}"`,
        why: `Contacts ready — outreach not started`,
        nextStep: 'Generate outreach and add contacts to cadence.',
        entityType: 'account',
        entityId: topAccount.id,
        entityName: topAccount.name,
        score: applyMemoryPenalty(scored.score * delay.decayMultiplier, ignoreMap[actionId] || 0),
        delayConsequence: delay.delayConsequence,
        escalation: delay.escalationLevel,
      });
    }

    // 5d. Outreach in progress but no meetings
    const accountsNeedingMeetings = targetAccounts.filter(a =>
      a.outreachStatus && ['in-progress', 'working', 'nurture'].includes(a.outreachStatus) &&
      a.lastTouchDate
    );
    for (const a of accountsNeedingMeetings) {
      const daysSince = Math.ceil((now.getTime() - new Date(a.lastTouchDate!).getTime()) / 86400000);
      if (daysSince >= 5) {
        const actionId = `account-push-meeting-${a.id}`;
        const scored = calculateScore({
          revenueImpact: classifyRevenueImpact({ isClosingAction: false, arrK: 0, isPipelineCreation: true }),
          timeSensitivity: classifyTimeSensitivity({ dueToday: false, daysUntilDeadline: 3 }),
          actionability: classifyActionability({ hasNextStep: true, hasContacts: true, needsClarification: false }),
        });
        candidates.push({
          id: actionId,
          action: `Push for meeting with "${a.name}"`,
          why: `Outreach active, ${daysSince}d since last touch — no meeting set`,
          nextStep: 'Follow up or try a different channel to book a meeting.',
          entityType: 'account',
          entityId: a.id,
          entityName: a.name,
          score: applyMemoryPenalty(scored.score, ignoreMap[actionId] || 0),
          escalation: 'low',
        });
      }
    }

    if (candidates.length === 0) return null;

    // Deterministic sort: score desc, then id for stability
    candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return candidates[0];
  }, [opportunities, tasks, renewals, accounts, momentum]);
}
