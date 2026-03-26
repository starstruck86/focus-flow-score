import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useStore } from '@/store/useStore';
import { useOppPlaybookRecommendation } from '@/hooks/usePlaybookRecommendation';
import { useOpportunityMethodology } from '@/hooks/useOpportunityMethodology';
import { cn } from '@/lib/utils';

interface DealIntelligenceCardProps {
  opportunityId: string;
}

interface DealSignals {
  topRisk: string | null;
  whatsMissing: string | null;
  nextMove: string;
  playbook: string | null;
}

export function DealIntelligenceCard({ opportunityId }: DealIntelligenceCardProps) {
  const { opportunities, accounts, contacts } = useStore();
  const opp = opportunities.find(o => o.id === opportunityId);
  const playbookRec = useOppPlaybookRecommendation(opportunityId);
  const { data: meth } = useOpportunityMethodology(opportunityId);

  const signals = useMemo<DealSignals | null>(() => {
    if (!opp) return null;
    if (opp.status === 'closed-won' || opp.status === 'closed-lost') return null;

    const oppContacts = opp.accountId
      ? contacts.filter(c => c.accountId === opp.accountId)
      : [];

    const daysSinceTouch = opp.lastTouchDate
      ? Math.floor((Date.now() - new Date(opp.lastTouchDate).getTime()) / 86400000)
      : null;
    const daysToClose = opp.closeDate
      ? Math.floor((new Date(opp.closeDate).getTime() - Date.now()) / 86400000)
      : null;
    const stage = opp.stage || '';

    // --- TOP RISK ---
    const risks: { text: string; severity: number }[] = [];

    if (daysSinceTouch !== null && daysSinceTouch > 21) {
      risks.push({ text: `No activity in ${daysSinceTouch} days — deal is going dark`, severity: 95 });
    } else if (daysSinceTouch !== null && daysSinceTouch > 10) {
      risks.push({ text: `Last touch ${daysSinceTouch}d ago — momentum fading`, severity: 70 });
    }

    if (daysToClose !== null && daysToClose < 0) {
      risks.push({ text: `Close date passed ${Math.abs(daysToClose)}d ago — update or close`, severity: 90 });
    } else if (daysToClose !== null && daysToClose < 14 && stage !== 'Negotiate' && stage !== 'Closed Won') {
      risks.push({ text: `${daysToClose}d to close but still in ${stage || 'early'} stage`, severity: 75 });
    }

    if (opp.status === 'stalled') {
      risks.push({ text: 'Deal marked stalled — needs re-engagement', severity: 85 });
    }

    if (meth && !meth.champion_confirmed) {
      risks.push({ text: 'No champion identified — deal has no internal advocate', severity: 80 });
    }

    if (meth && !meth.economic_buyer_confirmed && ['Demo', 'Proposal', 'Negotiate'].includes(stage)) {
      risks.push({ text: 'No economic buyer access in late stage', severity: 78 });
    }

    if (oppContacts.length === 0 && stage && stage !== 'Prospect') {
      risks.push({ text: 'Zero stakeholders mapped — single-threaded risk', severity: 72 });
    } else if (oppContacts.length === 1 && ['Demo', 'Proposal', 'Negotiate'].includes(stage)) {
      risks.push({ text: 'Only 1 contact — single-threaded in late stage', severity: 68 });
    }

    risks.sort((a, b) => b.severity - a.severity);
    const topRisk = risks[0]?.text || null;

    // --- WHAT'S MISSING ---
    const gaps: string[] = [];

    if (!opp.nextStep || opp.nextStep.trim().length < 5) {
      gaps.push('No concrete next step defined');
    }

    if (meth) {
      const meddiccFields = [
        { key: 'metrics_confirmed', label: 'Metrics' },
        { key: 'economic_buyer_confirmed', label: 'Economic Buyer' },
        { key: 'decision_criteria_confirmed', label: 'Decision Criteria' },
        { key: 'decision_process_confirmed', label: 'Decision Process' },
        { key: 'identify_pain_confirmed', label: 'Pain' },
        { key: 'champion_confirmed', label: 'Champion' },
        { key: 'competition_confirmed', label: 'Competition' },
      ] as const;
      const unconfirmed = meddiccFields.filter(f => !(meth as any)[f.key]);
      if (unconfirmed.length >= 4) {
        gaps.push(`MEDDICC: ${unconfirmed.slice(0, 3).map(u => u.label).join(', ')} unconfirmed`);
      } else if (unconfirmed.length >= 2) {
        gaps.push(`${unconfirmed.map(u => u.label).join(', ')} not confirmed`);
      }
    } else if (stage && stage !== 'Prospect') {
      gaps.push('No MEDDICC tracking started');
    }

    if (!opp.closeDate) {
      gaps.push('No close date set');
    }

    const whatsMissing = gaps[0] || null;

    // --- NEXT MOVE ---
    let nextMove = 'Maintain momentum — prepare for next stage gate';

    if (topRisk?.includes('going dark') || topRisk?.includes('momentum fading')) {
      nextMove = 'Schedule a touchpoint within 48 hours to re-engage';
    } else if (topRisk?.includes('Close date passed')) {
      nextMove = 'Update close date or move to Closed Lost';
    } else if (topRisk?.includes('No champion')) {
      nextMove = 'Identify and validate a champion before advancing';
    } else if (whatsMissing?.includes('next step')) {
      nextMove = 'Define a time-bound next step with the prospect';
    } else if (whatsMissing?.includes('MEDDICC')) {
      nextMove = 'Plan discovery questions to fill methodology gaps';
    } else if (oppContacts.length <= 1 && ['Demo', 'Proposal', 'Negotiate'].includes(stage)) {
      nextMove = 'Multi-thread: get introduced to another stakeholder';
    } else if (stage === 'Discover') {
      nextMove = 'Confirm pain and build business case for Demo';
    } else if (stage === 'Demo') {
      nextMove = 'Get decision criteria confirmed post-demo';
    } else if (stage === 'Proposal') {
      nextMove = 'Validate proposal with champion before formal send';
    } else if (stage === 'Negotiate') {
      nextMove = 'Confirm decision process and timeline to signature';
    }

    return {
      topRisk,
      whatsMissing,
      nextMove,
      playbook: playbookRec?.playbook.title || null,
    };
  }, [opp, accounts, contacts, meth, opportunityId, playbookRec]);

  if (!signals) return null;
  if (!signals.topRisk && !signals.whatsMissing && !signals.playbook) return null;

  return (
    <Card className="border-border/50 bg-muted/20">
      <CardContent className="p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {signals.topRisk && (
            <SignalRow emoji="🔥" label="Top Risk" value={signals.topRisk} variant="risk" />
          )}
          {signals.whatsMissing && (
            <SignalRow emoji="❗" label="What's Missing" value={signals.whatsMissing} variant="warning" />
          )}
          <SignalRow emoji="🎯" label="Next Move" value={signals.nextMove} variant="action" />
          {signals.playbook && (
            <SignalRow emoji="🧠" label="Playbook" value={signals.playbook} variant="info" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalRow({ emoji, label, value, variant }: {
  emoji: string;
  label: string;
  value: string;
  variant: 'risk' | 'warning' | 'action' | 'info';
}) {
  return (
    <div className={cn(
      "flex items-start gap-2 rounded-md px-2.5 py-2",
      variant === 'risk' && 'bg-destructive/5',
      variant === 'warning' && 'bg-status-yellow/5',
      variant === 'action' && 'bg-primary/5',
      variant === 'info' && 'bg-muted/40',
    )}>
      <span className="text-sm leading-5 shrink-0">{emoji}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
        <p className="text-xs leading-snug text-foreground">{value}</p>
      </div>
    </div>
  );
}
