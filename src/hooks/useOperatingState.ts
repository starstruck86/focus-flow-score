// Operating State Engine — thin layer computing ONE concise state sentence
// Uses existing store data only. No parallel systems.
// Extended with: momentum signals, pipeline creation awareness.

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useStaleItems } from '@/hooks/useStaleItems';
import { useMomentumEngine } from '@/hooks/useMomentumEngine';

export interface OperatingState {
  sentence: string;
  band: 'executing' | 'on-pace' | 'drifting' | 'reactive';
  momentumNote?: string; // optional momentum context
}

export function useOperatingState(): OperatingState {
  const { opportunities, tasks, renewals } = useStore();
  const { staleAccounts, oppsNoNextStep, atRiskRenewals } = useStaleItems();
  const momentum = useMomentumEngine();

  return useMemo(() => {
    const activeTasks = tasks.filter(t => t.status === 'next' || t.status === 'in-progress');
    const overdueTasks = activeTasks.filter(t => {
      if (!t.dueDate) return false;
      return t.dueDate < new Date().toISOString().split('T')[0];
    });
    const activeOpps = opportunities.filter(o => o.status === 'active');
    const highValueOpps = activeOpps.filter(o => (o.arr || 0) >= 50000);

    // Scoring: lower = worse
    let driftScore = 0;

    // Positive signals
    if (activeOpps.length > 0) driftScore += 2;
    if (highValueOpps.length > 0) driftScore += 1;
    if (overdueTasks.length === 0) driftScore += 2;
    if (staleAccounts <= 2) driftScore += 1;
    if (oppsNoNextStep === 0) driftScore += 2;
    if (atRiskRenewals === 0) driftScore += 1;

    // Momentum bonus/penalty
    if (momentum.dealMomentumLabel === 'strong') driftScore += 1;
    if (momentum.dealMomentumLabel === 'stalled') driftScore -= 2;
    if (momentum.pipelineCreationLabel === 'active') driftScore += 1;
    if (momentum.pipelineCreationLabel === 'dry') driftScore -= 2;

    // Negative signals
    if (overdueTasks.length >= 5) driftScore -= 3;
    else if (overdueTasks.length >= 2) driftScore -= 1;

    if (oppsNoNextStep >= 3) driftScore -= 2;
    if (staleAccounts >= 5) driftScore -= 2;
    if (atRiskRenewals >= 2) driftScore -= 2;

    // Determine band + sentence
    let band: OperatingState['band'];
    let sentence: string;
    let momentumNote: string | undefined;

    // Build momentum context string
    if (momentum.newLogoGap) {
      momentumNote = 'new logo cadence broken';
    } else if (momentum.pipelineCreationLabel === 'dry') {
      momentumNote = 'pipeline creation stalled';
    } else if (momentum.dealMomentumLabel === 'stalled') {
      momentumNote = 'deal momentum stalled';
    }

    if (driftScore >= 8) {
      band = 'executing';
      const pipelineNote = highValueOpps.length > 0
        ? `${highValueOpps.length} high-value deal${highValueOpps.length > 1 ? 's' : ''} active`
        : 'pipeline moving';
      sentence = `On pace — ${pipelineNote}, no open loops.`;
    } else if (driftScore >= 4) {
      band = 'on-pace';
      const risk = momentumNote
        ? momentumNote
        : oppsNoNextStep > 0
          ? `${oppsNoNextStep} deal${oppsNoNextStep > 1 ? 's' : ''} missing next steps`
          : overdueTasks.length > 0
            ? `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`
            : 'minor gaps';
      sentence = `Slight drift — ${risk}.`;
    } else if (driftScore >= 1) {
      band = 'drifting';
      const issues: string[] = [];
      if (momentumNote) issues.push(momentumNote);
      if (overdueTasks.length > 0) issues.push(`${overdueTasks.length} overdue`);
      if (staleAccounts > 3) issues.push(`${staleAccounts} stale accounts`);
      if (oppsNoNextStep > 0) issues.push('deals without next steps');
      sentence = `Drifting — ${issues.slice(0, 2).join(', ')}.`;
    } else {
      band = 'reactive';
      const issues: string[] = [];
      if (momentumNote) issues.push(momentumNote);
      if (overdueTasks.length > 0) issues.push('follow-ups lagging');
      if (staleAccounts > 5) issues.push('territory going cold');
      if (atRiskRenewals > 0) issues.push('renewal risk');
      sentence = `Reactive — ${issues.slice(0, 2).join(', ') || 'too many open loops'}.`;
    }

    return { sentence, band, momentumNote };
  }, [opportunities, tasks, renewals, staleAccounts, oppsNoNextStep, atRiskRenewals, momentum]);
}
