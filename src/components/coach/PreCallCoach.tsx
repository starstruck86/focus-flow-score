import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Target, AlertTriangle, CheckCircle2, Brain, Crosshair, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { useAllTranscriptGrades, useBehavioralPatterns } from '@/hooks/useTranscriptGrades';
import { useTranscriptsForAccount } from '@/hooks/useCallTranscripts';
import { format, parseISO } from 'date-fns';

interface Props {
  accountId?: string;
  opportunityId?: string;
  callType?: string;
}

export function PreCallCoach({ accountId, opportunityId, callType }: Props) {
  const accounts = useStore(s => s.accounts);
  const opportunities = useStore(s => s.opportunities);
  const { data: allGrades } = useAllTranscriptGrades();
  const { patterns, weakestArea } = useBehavioralPatterns();
  const { data: accountTranscripts } = useTranscriptsForAccount(accountId);

  const account = accounts.find(a => a.id === accountId);
  const opportunity = opportunities.find(o => o.id === opportunityId);

  // Find previous grades for this account
  const accountGrades = useMemo(() => {
    if (!allGrades || !accountId) return [];
    return allGrades.filter((g: any) => g.call_transcripts?.account_id === accountId);
  }, [allGrades, accountId]);

  // Build coaching plan
  const plan = useMemo(() => {
    const items: { icon: any; label: string; detail: string; type: 'focus' | 'reminder' | 'context' }[] = [];

    // Account context
    if (account) {
      if (account.tier) items.push({ icon: Target, label: 'Account Tier', detail: `${account.tier} — ${account.motion || 'unknown'} motion`, type: 'context' });
      if (account.nextStep) items.push({ icon: Crosshair, label: 'Pending Next Step', detail: account.nextStep, type: 'context' });
    }

    // Opportunity context
    if (opportunity) {
      if (opportunity.stage) items.push({ icon: Target, label: 'Deal Stage', detail: `${opportunity.stage} — $${((opportunity.arr || 0) / 1000).toFixed(0)}k ARR`, type: 'context' });
      if (opportunity.nextStep) items.push({ icon: Crosshair, label: 'Opp Next Step', detail: opportunity.nextStep, type: 'context' });
    }

    // Previous call insights
    if (accountGrades.length > 0) {
      const lastGrade = accountGrades[0];
      if (lastGrade.coaching_issue) {
        items.push({ icon: AlertTriangle, label: 'Last Call Issue', detail: `${lastGrade.coaching_issue}`, type: 'focus' });
      }
      if (lastGrade.replacement_behavior) {
        items.push({ icon: Lightbulb, label: 'Behavior to Practice', detail: lastGrade.replacement_behavior, type: 'focus' });
      }

      // Check what MEDDICC elements are still missing
      const lastMeddicc = lastGrade.meddicc_signals as any || {};
      const missing = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition']
        .filter(k => !lastMeddicc[k]);
      if (missing.length > 0 && missing.length < 5) {
        items.push({ icon: Brain, label: 'MEDDICC Gaps to Close', detail: `Uncover: ${missing.map(m => m.replace(/_/g, ' ')).join(', ')}`, type: 'focus' });
      }
    }

    // Personal behavioral patterns to watch
    if (weakestArea) {
      items.push({ icon: AlertTriangle, label: 'Your Weakest Area', detail: `${weakestArea.category.replace(/_/g, ' ')} (avg ${weakestArea.avg.toFixed(1)}/5) — focus here`, type: 'reminder' });
    }
    if (patterns.length > 0) {
      const topBad = patterns[0];
      items.push({ icon: AlertTriangle, label: 'Watch Out For', detail: `${topBad.label} (detected in ${topBad.pct}% of calls)`, type: 'reminder' });
    }

    // Call type specific advice
    if (callType === 'Discovery Call') {
      items.push({ icon: Lightbulb, label: 'Discovery Reminder', detail: 'Lead with open-ended impact questions. Aim for <30% talk ratio.', type: 'reminder' });
    } else if (callType === 'Demo') {
      items.push({ icon: Lightbulb, label: 'Demo Reminder', detail: 'Confirm pain & decision criteria before showing. Tailor to their Before/After.', type: 'reminder' });
    } else if (callType === 'Pricing Discussion') {
      items.push({ icon: Lightbulb, label: 'Pricing Reminder', detail: 'Anchor to business value first. Quantify ROI before discussing price.', type: 'reminder' });
    }

    return items;
  }, [account, opportunity, accountGrades, weakestArea, patterns, callType]);

  if (!accountId && !opportunityId) {
    return (
      <Card className="border-dashed border-border/50">
        <CardContent className="p-6 text-center text-muted-foreground">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">Select an account or opportunity</p>
          <p className="text-xs">Link a transcript to an account to generate a pre-call coaching plan</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Pre-Call Coaching Plan
          {account && <Badge variant="outline" className="text-[10px]">{account.name}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {plan.length === 0 ? (
          <p className="text-xs text-muted-foreground">No prior data for this account yet — this will populate after your first graded call.</p>
        ) : (
          plan.map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2 p-2 rounded text-xs',
                  item.type === 'focus' && 'bg-grade-failing/5 border border-grade-failing/15',
                  item.type === 'reminder' && 'bg-grade-average/5 border border-grade-average/15',
                  item.type === 'context' && 'bg-muted/30',
                )}
              >
                <Icon className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 mt-0.5',
                  item.type === 'focus' && 'text-grade-failing',
                  item.type === 'reminder' && 'text-grade-average',
                  item.type === 'context' && 'text-muted-foreground',
                )} />
                <div>
                  <span className="font-semibold">{item.label}: </span>
                  <span className="text-muted-foreground">{item.detail}</span>
                </div>
              </div>
            );
          })
        )}

        {/* Recent transcript summaries */}
        {(accountTranscripts || []).length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recent Calls with {account?.name}</p>
            {(accountTranscripts || []).slice(0, 3).map(t => (
              <div key={t.id} className="text-[11px] text-muted-foreground py-0.5">
                • {format(parseISO(t.call_date), 'MMM d')} — {t.title || 'Call'} {t.summary && `— ${t.summary.substring(0, 80)}…`}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
