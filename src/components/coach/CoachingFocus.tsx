import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Crosshair, Target, AlertTriangle, CheckCircle2, Lightbulb,
  ArrowRight, TrendingUp, TrendingDown, Flame, Zap, Brain,
  Clock, Eye, ShieldCheck, MessageSquareQuote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllTranscriptGrades, useBehavioralPatterns, useMeddiccCompleteness } from '@/hooks/useTranscriptGrades';

const CATEGORY_META: Record<string, { label: string; icon: any; drills: string[] }> = {
  structure: {
    label: 'Call Structure',
    icon: Clock,
    drills: [
      'Open every call stating: purpose, agenda, and time check — get verbal confirmation',
      'Write your call plan on paper before dialing: 3 objectives, 2 discovery questions, 1 close action',
      'Record yourself doing a 60-second opening pitch and time it — under 45s is the goal',
    ],
  },
  cotm: {
    label: 'Command of the Message',
    icon: Crosshair,
    drills: [
      'Before your next call, write out the Before → Negative Consequences → After framework for this specific prospect',
      'Practice articulating 3 PBOs (Positive Business Outcomes) tied to metrics the buyer cares about',
      'After each call, score yourself: did you get the prospect to describe their "After" state in their own words?',
    ],
  },
  meddicc: {
    label: 'MEDDICC Qualification',
    icon: ShieldCheck,
    drills: [
      'Create a MEDDICC scorecard for your top 3 deals — highlight which letters are still blank',
      'On your next call, ask one question specifically designed to uncover the Decision Process',
      'Before every demo, confirm: "Who else needs to see this before a decision can be made?"',
    ],
  },
  discovery: {
    label: 'Discovery Depth',
    icon: Eye,
    drills: [
      'Use the "Tell me more" technique: after every prospect answer, ask one follow-up before moving on',
      'Prepare 5 open-ended impact questions before each call — no yes/no questions allowed',
      'Practice the 3-deep drill: Topic → Impact → Quantify. Never stop at the surface answer.',
    ],
  },
  presence: {
    label: 'Executive Presence',
    icon: Brain,
    drills: [
      'Set a timer: aim for <30% talk ratio. After asking a question, count to 5 silently before speaking',
      'Record your next call and listen for filler words (um, like, so) — aim to cut them by 50%',
      'Practice the "pause and summarize" technique: pause after the prospect speaks, then summarize what you heard',
    ],
  },
  commercial: {
    label: 'Commercial Acumen',
    icon: Zap,
    drills: [
      'Before discussing pricing, always anchor to the business value: "Based on what you told me, the cost of inaction is..."',
      'Practice handling the "how much does it cost?" question with a value bridge, not a number',
      'Quantify ROI in the prospect\'s language: hours saved, revenue gained, risk reduced — before every pricing conversation',
    ],
  },
  next_step: {
    label: 'Next Step Control',
    icon: Target,
    drills: [
      'Never end a call without a calendar invite sent. Practice: "Let me send you an invite right now for [date]"',
      'Use the assumptive close: "I\'ll send over the proposal Tuesday and we\'ll review it together Thursday at 2?"',
      'Write your desired next step BEFORE the call starts. If you don\'t achieve it, note why in your CRM.',
    ],
  },
};

interface FocusRecommendation {
  category: string;
  label: string;
  icon: any;
  avgScore: number;
  trend: 'improving' | 'declining' | 'stuck';
  trendDelta: number;
  callCount: number;
  topIssue: string | null;
  topReplacement: string | null;
  evidenceQuote: string | null;
  drills: string[];
  behavioralFlags: string[];
  meddiccGaps: string[];
  urgencyReason: string;
}

export function CoachingFocus() {
  const { data: allGrades } = useAllTranscriptGrades();
  const { patterns, weakestArea, trendSummary } = useBehavioralPatterns();
  const meddicc = useMeddiccCompleteness();

  const focus = useMemo((): FocusRecommendation | null => {
    if (!allGrades?.length || allGrades.length < 2) return null;

    const categories = Object.keys(CATEGORY_META);
    const recent = allGrades.slice(0, 5);
    const older = allGrades.slice(5, 10);

    // Score each category by: avg score (lower = more opportunity), trend (declining = urgent), frequency of related issues
    const scored = categories.map(cat => {
      const scores = allGrades.map(g => (g as any)[`${cat}_score`] || 0);
      const recentScores = recent.map(g => (g as any)[`${cat}_score`] || 0);
      const olderScores = older.length > 0 ? older.map(g => (g as any)[`${cat}_score`] || 0) : [];

      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      const olderAvg = olderScores.length > 0
        ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length
        : recentAvg;

      const delta = recentAvg - olderAvg;
      const trend: 'improving' | 'declining' | 'stuck' =
        delta > 0.3 ? 'improving' : delta < -0.3 ? 'declining' : 'stuck';

      // Issues related to this category from coaching_issue field
      const relatedIssues = recent.filter(g => {
        const focus = g.feedback_focus?.toLowerCase() || '';
        if (cat === 'cotm' && (focus === 'acumen' || focus === 'style')) return true;
        if (cat === 'discovery' && focus === 'style') return true;
        if (cat === 'presence' && focus === 'style') return true;
        if (cat === 'commercial' && focus === 'acumen') return true;
        if (cat === 'next_step' && focus === 'cadence') return true;
        if (cat === 'structure' && focus === 'cadence') return true;
        if (cat === 'meddicc' && focus === 'acumen') return true;
        return false;
      });

      // Leverage score: lower avg = higher leverage, declining trend = higher urgency
      // Range: 0 = no leverage, 100 = maximum leverage
      const gapScore = Math.max(0, (5 - avg) / 5) * 100; // 0-100, higher when score is lower
      const trendPenalty = trend === 'declining' ? 20 : trend === 'stuck' ? 10 : 0;
      const issuePenalty = Math.min(relatedIssues.length * 8, 25);
      const leverageScore = gapScore + trendPenalty + issuePenalty;

      return { cat, avg, recentAvg, delta, trend, leverageScore, relatedIssues };
    });

    // Pick highest leverage
    scored.sort((a, b) => b.leverageScore - a.leverageScore);
    const top = scored[0];
    const meta = CATEGORY_META[top.cat];

    // Get the most recent coaching issue and replacement for this area
    const relevantGrades = recent.filter(g => {
      const focus = g.feedback_focus?.toLowerCase() || '';
      // Broad matching
      return true; // We'll take any recent one
    });

    // Find the coaching issue most related to this category
    let topIssue: string | null = null;
    let topReplacement: string | null = null;
    let evidenceQuote: string | null = null;

    for (const g of recent) {
      if (g.coaching_issue && !topIssue) {
        topIssue = g.coaching_issue;
        topReplacement = g.replacement_behavior || null;
        evidenceQuote = g.transcript_moment || null;
      }
    }

    // Related behavioral flags
    const relatedFlags = patterns
      .filter(p => {
        if (top.cat === 'presence' && ['over_talking', 'rambling'].some(f => p.flag.includes(f))) return true;
        if (top.cat === 'discovery' && ['weak_questioning', 'skipped_discovery'].some(f => p.flag.includes(f))) return true;
        if (top.cat === 'next_step' && ['no_next_step', 'weak_close'].some(f => p.flag.includes(f))) return true;
        if (top.cat === 'commercial' && ['no_business_case', 'premature_solution'].some(f => p.flag.includes(f))) return true;
        if (top.cat === 'meddicc' && ['no_metrics', 'no_economic_buyer', 'no_pain_quantified'].some(f => p.flag.includes(f))) return true;
        if (top.cat === 'cotm' && ['premature_solution', 'no_business_case'].some(f => p.flag.includes(f))) return true;
        return false;
      })
      .map(p => `${p.label} (${p.pct}% of calls)`);

    // MEDDICC gaps if relevant
    const meddiccGaps = top.cat === 'meddicc' && meddicc?.completeness
      ? meddicc.completeness.filter(c => c.pct < 50).map(c => c.field.replace(/_/g, ' '))
      : [];

    // Urgency reason
    let urgencyReason = '';
    if (top.trend === 'declining') {
      urgencyReason = `This area is actively declining (${top.delta > 0 ? '+' : ''}${top.delta.toFixed(1)} recent trend). Intervention needed now.`;
    } else if (top.trend === 'stuck') {
      urgencyReason = `You've been stuck at ${top.avg.toFixed(1)}/5 here — this is your ceiling until you deliberately practice.`;
    } else {
      urgencyReason = `Despite improvement, at ${top.avg.toFixed(1)}/5 this remains your biggest gap vs. elite performance (4.0+).`;
    }

    return {
      category: top.cat,
      label: meta.label,
      icon: meta.icon,
      avgScore: top.avg,
      trend: top.trend,
      trendDelta: top.delta,
      callCount: allGrades.length,
      topIssue,
      topReplacement,
      evidenceQuote,
      drills: meta.drills,
      behavioralFlags: relatedFlags,
      meddiccGaps,
      urgencyReason,
    };
  }, [allGrades, patterns, trendSummary, meddicc]);

  if (!focus) {
    return (
      <Card className="border-dashed border-border/50">
        <CardContent className="p-6 text-center text-muted-foreground">
          <Crosshair className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">Grade at least 2 calls to unlock your coaching focus</p>
          <p className="text-xs">Your personalized improvement plan builds from transcript analysis</p>
        </CardContent>
      </Card>
    );
  }

  const Icon = focus.icon;
  const scorePct = (focus.avgScore / 5) * 100;
  const targetPct = 80; // 4.0/5

  return (
    <Card className="border-primary/25 bg-gradient-to-br from-primary/[0.04] via-transparent to-primary/[0.02] overflow-hidden relative">
      {/* Accent stripe */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-primary/80 to-primary/40" />

      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-base flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Crosshair className="h-4.5 w-4.5 text-primary" />
          </div>
          Your #1 Focus
          <Badge
            variant="outline"
            className={cn(
              'ml-auto text-[10px]',
              focus.trend === 'declining' ? 'border-destructive/30 text-destructive' :
              focus.trend === 'stuck' ? 'border-orange-500/30 text-orange-500' :
              'border-primary/30 text-primary'
            )}
          >
            {focus.trend === 'declining' && <TrendingDown className="h-2.5 w-2.5 mr-0.5" />}
            {focus.trend === 'stuck' && <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />}
            {focus.trend === 'improving' && <TrendingUp className="h-2.5 w-2.5 mr-0.5" />}
            {focus.trend}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="px-5 pb-5 space-y-4">
        {/* Focus Area Header */}
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="h-5.5 w-5.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold leading-tight">{focus.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{focus.urgencyReason}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-black font-mono">{focus.avgScore.toFixed(1)}</p>
            <p className="text-[10px] text-muted-foreground">/5.0 avg</p>
          </div>
        </div>

        {/* Progress to elite */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Current performance</span>
            <span>Elite target (4.0/5)</span>
          </div>
          <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                scorePct >= 80 ? 'bg-grade-excellent' : scorePct >= 60 ? 'bg-grade-good' : scorePct >= 40 ? 'bg-grade-average' : 'bg-grade-failing'
              )}
              style={{ width: `${scorePct}%` }}
            />
            <div
              className="absolute top-0 h-full w-0.5 bg-foreground/40"
              style={{ left: `${targetPct}%` }}
            />
          </div>
        </div>

        {/* What's going wrong - from real coaching data */}
        {focus.topIssue && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/15 p-3 space-y-2">
            <p className="text-xs font-bold flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              What's Happening
            </p>
            <p className="text-sm">{focus.topIssue}</p>
            {focus.evidenceQuote && (
              <div className="rounded bg-muted/50 p-2 border-l-2 border-destructive/30">
                <p className="text-[11px] italic text-muted-foreground">
                  <MessageSquareQuote className="h-3 w-3 inline mr-1" />
                  "{focus.evidenceQuote}"
                </p>
              </div>
            )}
          </div>
        )}

        {/* The fix */}
        {focus.topReplacement && (
          <div className="rounded-lg bg-grade-excellent/5 border border-grade-excellent/20 p-3 space-y-1.5">
            <p className="text-xs font-bold flex items-center gap-1.5 text-grade-excellent">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Instead, Do This
            </p>
            <p className="text-sm">{focus.topReplacement}</p>
          </div>
        )}

        {/* Behavioral patterns detected */}
        {focus.behavioralFlags.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Patterns Working Against You
            </p>
            {focus.behavioralFlags.map((flag, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Flame className="h-3 w-3 text-grade-failing flex-shrink-0 mt-0.5" />
                {flag}
              </p>
            ))}
          </div>
        )}

        {/* MEDDICC gaps if relevant */}
        {focus.meddiccGaps.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              MEDDICC Elements You're Missing Most
            </p>
            <div className="flex flex-wrap gap-1.5">
              {focus.meddiccGaps.map(gap => (
                <Badge key={gap} variant="outline" className="text-[10px] border-grade-failing/30 text-grade-failing capitalize">
                  {gap}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Specific Drills */}
        <div className="rounded-lg bg-primary/[0.04] border border-primary/15 p-3 space-y-2.5">
          <p className="text-xs font-bold flex items-center gap-1.5 text-primary">
            <Zap className="h-3.5 w-3.5" />
            Your Practice Drills — Do These This Week
          </p>
          {focus.drills.map((drill, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px]">
                {i + 1}
              </span>
              <p className="text-foreground/90 leading-relaxed">{drill}</p>
            </div>
          ))}
        </div>

        {/* Based on data */}
        <p className="text-[10px] text-muted-foreground text-center">
          Based on {focus.callCount} graded call{focus.callCount !== 1 ? 's' : ''} • Updated automatically with each new transcript
        </p>
      </CardContent>
    </Card>
  );
}
