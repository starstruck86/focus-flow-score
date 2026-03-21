import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Target, AlertTriangle, CheckCircle2, Brain, Crosshair, Lightbulb, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { useAllTranscriptGrades, useBehavioralPatterns } from '@/hooks/useTranscriptGrades';
import { useTranscriptsForAccount } from '@/hooks/useCallTranscripts';
import { useOpportunityMethodology, type CallGoal } from '@/hooks/useOpportunityMethodology';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, parseISO } from 'date-fns';

interface Props {
  accountId?: string;
  opportunityId?: string;
  callType?: string;
}

export function PreCallCoach({ accountId, opportunityId, callType }: Props) {
  const { user } = useAuth();
  const accounts = useStore(s => s.accounts);
  const opportunities = useStore(s => s.opportunities);
  const { data: allGrades } = useAllTranscriptGrades();
  const { patterns, weakestArea } = useBehavioralPatterns();
  const { data: accountTranscripts } = useTranscriptsForAccount(accountId);
  const { data: methodology } = useOpportunityMethodology(opportunityId);

  const account = accounts.find(a => a.id === accountId);
  const opportunity = opportunities.find(o => o.id === opportunityId);

  // Find previous grades for this account
  const accountGrades = useMemo(() => {
    if (!allGrades || !accountId) return [];
    return allGrades.filter((g: any) => g.call_transcripts?.account_id === accountId);
  }, [allGrades, accountId]);

  // Build cumulative MEDDICC from methodology tracker (not just last call)
  const meddiccGaps = useMemo(() => {
    if (!methodology) return [];
    const fields = [
      { key: 'metrics', label: 'Metrics' },
      { key: 'economic_buyer', label: 'Economic Buyer' },
      { key: 'decision_criteria', label: 'Decision Criteria' },
      { key: 'decision_process', label: 'Decision Process' },
      { key: 'identify_pain', label: 'Identify Pain' },
      { key: 'champion', label: 'Champion' },
      { key: 'competition', label: 'Competition' },
    ];
    return fields.filter(f => !(methodology as any)[`${f.key}_confirmed`]);
  }, [methodology]);

  // Pre-call resource recommendations from resource_digests
  const { data: recommendedResources } = useQuery({
    queryKey: ['precall-resources', user?.id, accountId, callType],
    queryFn: async () => {
      if (!user) return [];
      const { data: digests } = await supabase
        .from('resource_digests')
        .select('resource_id, use_cases, takeaways, summary')
        .eq('user_id', user.id);
      if (!digests?.length) return [];

      // Build context terms from call type, account industry, MEDDICC gaps
      const contextTerms: string[] = [];
      if (callType) contextTerms.push(callType.toLowerCase());
      if (account?.industry) contextTerms.push(account.industry.toLowerCase());
      meddiccGaps.forEach(g => contextTerms.push(g.label.toLowerCase()));
      if (weakestArea) contextTerms.push(weakestArea.category.replace(/_/g, ' ').toLowerCase());

      if (contextTerms.length === 0) return [];

      // Score digests by use_case relevance
      const scored = (digests as any[]).map(d => {
        const useCases = (d.use_cases || []) as string[];
        const matches = useCases.filter((uc: string) =>
          contextTerms.some(term => uc.toLowerCase().includes(term) || term.includes(uc.toLowerCase()))
        ).length;
        return { ...d, relevance: matches };
      }).filter(d => d.relevance > 0).sort((a, b) => b.relevance - a.relevance);

      if (!scored.length) return [];

      // Fetch resource titles
      const ids = scored.slice(0, 3).map(s => s.resource_id);
      const { data: resources } = await supabase
        .from('resources' as any)
        .select('id, title')
        .in('id', ids);

      return scored.slice(0, 3).map(s => ({
        title: (resources as any[])?.find(r => r.id === s.resource_id)?.title || 'Resource',
        takeaway: s.takeaways?.[0] || s.summary?.slice(0, 100) || '',
      }));
    },
    enabled: !!user && (!!accountId || !!callType),
  });

  // Build coaching plan
  const plan = useMemo(() => {
    const items: { icon: any; label: string; detail: string; type: 'focus' | 'reminder' | 'context' | 'goal' }[] = [];

    // Call goals from methodology tracker — top priority
    const activeGoals = (methodology?.call_goals || []).filter((g: CallGoal) => !g.completed);
    if (activeGoals.length > 0) {
      items.push({
        icon: Crosshair,
        label: 'Call Goal Outcomes',
        detail: activeGoals.map((g: CallGoal) => g.text).join(' • '),
        type: 'goal',
      });
    }

    // Cumulative MEDDICC gaps (from methodology tracker, not single call)
    if (meddiccGaps.length > 0 && meddiccGaps.length < 6) {
      items.push({
        icon: Brain,
        label: 'MEDDICC Gaps to Close',
        detail: `Still need: ${meddiccGaps.map(g => g.label).join(', ')}`,
        type: 'focus',
      });
    }

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

    // Previous call insights — behavioral, not MEDDICC (cumulative MEDDICC is above)
    if (accountGrades.length > 0) {
      const lastGrade = accountGrades[0];
      if (lastGrade.coaching_issue) {
        items.push({ icon: AlertTriangle, label: 'Last Call Issue', detail: `${lastGrade.coaching_issue}`, type: 'focus' });
      }
      if (lastGrade.replacement_behavior) {
        items.push({ icon: Lightbulb, label: 'Behavior to Practice', detail: lastGrade.replacement_behavior, type: 'focus' });
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
  }, [account, opportunity, accountGrades, weakestArea, patterns, callType, methodology, meddiccGaps]);

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
          {methodology && (
            <Badge variant="outline" className="text-[10px] ml-auto">
              MEDDICC {7 - meddiccGaps.length}/7
            </Badge>
          )}
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
                  item.type === 'goal' && 'bg-primary/5 border border-primary/20',
                  item.type === 'focus' && 'bg-grade-failing/5 border border-grade-failing/15',
                  item.type === 'reminder' && 'bg-grade-average/5 border border-grade-average/15',
                  item.type === 'context' && 'bg-muted/30',
                )}
              >
                <Icon className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 mt-0.5',
                  item.type === 'goal' && 'text-primary',
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

        {/* Pre-call resource recommendations */}
        {(recommendedResources || []).length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1 flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> Recommended Reading
            </p>
            {(recommendedResources || []).map((r, i) => (
              <div key={i} className="text-[11px] text-muted-foreground py-0.5">
                <span className="font-medium text-foreground">📚 {r.title}</span>
                {r.takeaway && <span className="text-[10px]"> — {r.takeaway}</span>}
              </div>
            ))}
          </div>
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