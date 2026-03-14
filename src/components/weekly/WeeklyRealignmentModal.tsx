import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Target, Trophy, TrendingUp, AlertTriangle, Calendar, BookOpen, 
  Plus, X, Compass, DollarSign, ChevronRight, RefreshCw, CheckCircle2, XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  useWeeklyMetricsAggregation, 
  usePipelineForReview, 
  useRenewalsForReview,
  usePreviousWeekReview,
  useSaveWeeklyReview, 
  getCurrentWeekRange 
} from '@/hooks/useWeeklyReview';
import { useQuotaTargets } from '@/hooks/useSalesAge';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';

interface Props {
  open: boolean;
  onComplete: () => void;
  onOpenChange?: (open: boolean) => void;
}

interface ClientMeeting {
  date: string;
  client: string;
  goal: string;
}

const STAGE_ORDER = ['1 - Prospect', '2 - Discover', '3 - Demo', '4 - Proposal', '5 - Negotiate'];

const RISK_COLORS: Record<string, string> = {
  '1 - Low Risk': 'text-status-green',
  '2 - Medium Risk': 'text-status-yellow',
  '3 - High Risk': 'text-status-red',
  '4 - OOB / Churning': 'text-status-red',
  low: 'text-status-green',
  medium: 'text-status-yellow',
  high: 'text-status-red',
};

export function WeeklyRealignmentModal({ open, onComplete, onOpenChange }: Props) {
  const { data: metrics, isLoading: metricsLoading } = useWeeklyMetricsAggregation();
  const { data: pipeline, isLoading: pipelineLoading } = usePipelineForReview();
  const { data: renewals, isLoading: renewalsLoading } = useRenewalsForReview();
  const { data: prevReview, isLoading: prevLoading } = usePreviousWeekReview();
  const saveReview = useSaveWeeklyReview();
  const { weekStart, weekEnd } = getCurrentWeekRange();
  const { data: quotaTargets } = useQuotaTargets();
  const targets = quotaTargets || DEFAULT_QUOTA_TARGETS;

  const [northStarGoals] = useState<string[]>([
    "President's Club - 125% of quota - top rep",
    'Most Dials Every Week',
    'Most New Logo Opps + Pipeline every week',
  ]);

  // This week planning
  const [commitment, setCommitment] = useState('');
  const [keyGoals, setKeyGoals] = useState<string[]>(['', '', '']);
  const [clientMeetings, setClientMeetings] = useState<ClientMeeting[]>([
    { date: '', client: '', goal: '' },
    { date: '', client: '', goal: '' },
  ]);
  const [skillDevelopment, setSkillDevelopment] = useState('');

  // Last week accountability
  const [biggestWin, setBiggestWin] = useState('');
  const [biggestFailure, setBiggestFailure] = useState('');
  const [failureChange, setFailureChange] = useState('');
  const [prevGoalsAchieved, setPrevGoalsAchieved] = useState<Record<number, boolean>>({});
  const [prevMeetingOutcomes, setPrevMeetingOutcomes] = useState<Record<number, string>>({});
  const [prevCommitmentMet, setPrevCommitmentMet] = useState<boolean | null>(null);
  const [prevCommitmentReflection, setPrevCommitmentReflection] = useState('');
  const [prevLearningFollowThrough, setPrevLearningFollowThrough] = useState<boolean | null>(null);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

  const pipelineByStage = STAGE_ORDER.map(stage => ({
    stage,
    opps: (pipeline || []).filter(o => o.stage === stage),
  })).filter(g => g.opps.length > 0);

  const totalPipelineArr = (pipeline || []).reduce((s, o) => s + (Number(o.arr) || 0), 0);
  const totalRenewalArr = (renewals || []).reduce((s, r) => s + (Number(r.arr) || 0), 0);

  // Parse previous week's client meetings
  const prevClientMeetings: ClientMeeting[] = (() => {
    try {
      const parsed = JSON.parse(prevReview?.keyClientMeetings || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const updateMeeting = (index: number, field: keyof ClientMeeting, value: string) => {
    const next = [...clientMeetings];
    next[index] = { ...next[index], [field]: value };
    setClientMeetings(next);
  };

  const handleSave = async () => {
    if (!commitment.trim()) {
      toast.error('Please enter your commitment for the week');
      return;
    }
    if (!keyGoals.some(g => g.trim())) {
      toast.error('Please add at least one key goal');
      return;
    }

    try {
      await saveReview.mutateAsync({
        weekStart,
        weekEnd,
        totalDials: metrics?.totalDials || 0,
        totalConversations: metrics?.totalConversations || 0,
        totalMeetingsSet: metrics?.totalMeetingsSet || 0,
        totalMeetingsHeld: metrics?.totalMeetingsHeld || 0,
        totalOppsCreated: metrics?.totalOppsCreated || 0,
        totalProspectsAdded: metrics?.totalProspectsAdded || 0,
        totalPipelineMoved: metrics?.totalPipelineMoved || 0,
        daysLogged: metrics?.daysLogged || 0,
        daysGoalMet: metrics?.daysGoalMet || 0,
        avgDailyScore: metrics?.avgDailyScore || 0,
        avgSentiment: metrics?.avgSentiment ?? null,
        biggestWin,
        biggestFailure,
        failureChangePlan: failureChange,
        commitmentForWeek: commitment,
        keyGoals: keyGoals.filter(g => g.trim()),
        keyClientMeetings: JSON.stringify(clientMeetings.filter(m => m.client.trim())),
        skillDevelopment,
        northStarGoals,
      });
      toast.success('Weekly review complete! 🎯');
      onComplete();
    } catch {
      toast.error('Failed to save weekly review');
    }
  };

  const hasPrevReview = !!prevReview;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 [&>button]:hidden" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
        <DialogHeader className="p-6 pb-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Compass className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="font-display text-lg">Weekly Goals, Commitments, & Pipeline Review</DialogTitle>
              <DialogDescription className="text-xs">
                Week of {new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — Your North Star
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-180px)]">
          <div className="p-6 space-y-6">
            {/* ===== NORTH STAR GOALS ===== */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-bold">Goals (North Star)</h3>
              </div>
              <div className="space-y-1.5">
                {northStarGoals.map((g, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-primary font-bold">•</span>
                    <span className="font-medium">{g}</span>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            {/* ===== LAST WEEK ACCOUNTABILITY ===== */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-bold">Last Week Accountability</h3>
                <Badge variant="outline" className="text-[10px]">How did you perform?</Badge>
              </div>

              {/* Auto-populated metrics */}
              {metricsLoading ? (
                <div className="text-xs text-muted-foreground mb-4">Loading metrics...</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {[
                    { label: 'Dials', value: metrics?.totalDials || 0, target: targets.targetDialsPerDay * 5 },
                    { label: 'Conversations', value: metrics?.totalConversations || 0, target: targets.targetConnectsPerDay * 5 },
                    { label: 'Meetings Set', value: metrics?.totalMeetingsSet || 0, target: targets.targetMeetingsSetPerWeek },
                    { label: 'Meetings Held', value: metrics?.totalMeetingsHeld || 0, target: targets.targetCustomerMeetingsPerWeek },
                    { label: 'Opps Created', value: metrics?.totalOppsCreated || 0, target: targets.targetOppsCreatedPerWeek },
                    { label: 'Prospects Added', value: metrics?.totalProspectsAdded || 0, target: null },
                    { label: 'Days Goal Met', value: `${metrics?.daysGoalMet || 0}/${metrics?.daysLogged || 0}`, target: null },
                    { label: 'Avg Score', value: (metrics?.avgDailyScore || 0).toFixed(1), target: null },
                  ].map(m => {
                    const numVal = typeof m.value === 'number' ? m.value : null;
                    const hitTarget = m.target && numVal != null ? numVal >= m.target : null;
                    return (
                      <Card key={m.label} className={cn("p-2 text-center", hitTarget === true && "border-status-green/30", hitTarget === false && "border-status-red/30")}>
                        <div className="text-lg font-bold font-mono">{m.value}</div>
                        {m.target != null && (
                          <div className={cn("text-[9px] font-mono", hitTarget ? "text-status-green" : "text-status-red")}>
                            / {m.target} target
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground">{m.label}</div>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Previous commitment accountability */}
              {hasPrevReview && prevReview.commitmentForWeek && (
                <div className="space-y-3 mb-4">
                  <div className="rounded-lg border border-border p-3 bg-muted/30">
                    <label className="text-xs font-semibold mb-1 block text-muted-foreground">Last week's commitment:</label>
                    <p className="text-sm font-medium mb-2">"{prevReview.commitmentForWeek}"</p>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-semibold">Did you achieve it?</span>
                      <Button
                        size="sm" variant={prevCommitmentMet === true ? 'default' : 'outline'}
                        className={cn("h-7 text-xs", prevCommitmentMet === true && "bg-status-green hover:bg-status-green")}
                        onClick={() => setPrevCommitmentMet(true)}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Yes
                      </Button>
                      <Button
                        size="sm" variant={prevCommitmentMet === false ? 'default' : 'outline'}
                        className={cn("h-7 text-xs", prevCommitmentMet === false && "bg-status-red hover:bg-status-red")}
                        onClick={() => setPrevCommitmentMet(false)}
                      >
                        <XCircle className="h-3 w-3 mr-1" /> No
                      </Button>
                    </div>
                    {prevCommitmentMet === false && (
                      <Textarea
                        value={prevCommitmentReflection}
                        onChange={e => setPrevCommitmentReflection(e.target.value)}
                        placeholder="What got in the way?"
                        className="min-h-[40px] text-sm mt-1"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Previous key goals accountability */}
              {hasPrevReview && prevReview.keyGoals.length > 0 && (
                <div className="mb-4">
                  <label className="text-xs font-semibold mb-2 block">Last week's key goals — did you achieve them?</label>
                  <div className="space-y-1.5">
                    {prevReview.keyGoals.map((goal, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 bg-muted/20">
                        <Checkbox
                          checked={prevGoalsAchieved[i] || false}
                          onCheckedChange={(checked) => setPrevGoalsAchieved(prev => ({ ...prev, [i]: !!checked }))}
                        />
                        <span className={cn("text-sm flex-1", prevGoalsAchieved[i] && "line-through text-muted-foreground")}>{goal}</span>
                        {prevGoalsAchieved[i] ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-status-green shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Previous client meeting outcomes */}
              {prevClientMeetings.length > 0 && (
                <div className="mb-4">
                  <label className="text-xs font-semibold mb-2 block">Client meeting outcomes — what happened?</label>
                  <div className="space-y-2">
                    {prevClientMeetings.map((m, i) => (
                      <div key={i} className="rounded-lg border border-border p-2.5 bg-muted/20 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">{m.date || 'No date'}</span>
                          <span className="font-semibold">{m.client}</span>
                          <span className="text-muted-foreground">— {m.goal}</span>
                        </div>
                        <Input
                          value={prevMeetingOutcomes[i] || ''}
                          onChange={e => setPrevMeetingOutcomes(prev => ({ ...prev, [i]: e.target.value }))}
                          placeholder="What was the outcome?"
                          className="text-sm h-7"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Learning follow-through */}
              {hasPrevReview && prevReview.skillDevelopment && (
                <div className="rounded-lg border border-border p-3 bg-muted/20 mb-4">
                  <label className="text-xs font-semibold mb-1 block text-muted-foreground">Last week's learning plan:</label>
                  <p className="text-sm mb-2">"{prevReview.skillDevelopment}"</p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold">Did you follow through?</span>
                    <Button
                      size="sm" variant={prevLearningFollowThrough === true ? 'default' : 'outline'}
                      className={cn("h-7 text-xs", prevLearningFollowThrough === true && "bg-status-green hover:bg-status-green")}
                      onClick={() => setPrevLearningFollowThrough(true)}
                    >Yes</Button>
                    <Button
                      size="sm" variant={prevLearningFollowThrough === false ? 'default' : 'outline'}
                      className={cn("h-7 text-xs", prevLearningFollowThrough === false && "bg-status-red hover:bg-status-red")}
                      onClick={() => setPrevLearningFollowThrough(false)}
                    >No</Button>
                  </div>
                </div>
              )}

              {/* Wins & Failures */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold flex items-center gap-1 mb-1">
                    <Trophy className="h-3 w-3 text-status-yellow" /> Biggest wins last week?
                  </label>
                  <Textarea
                    value={biggestWin}
                    onChange={e => setBiggestWin(e.target.value)}
                    placeholder="Where did you crush it? New Opps, closed deals, big meetings?"
                    className="min-h-[50px] text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold flex items-center gap-1 mb-1">
                    <AlertTriangle className="h-3 w-3 text-status-red" /> Most impactful failure
                  </label>
                  <Textarea
                    value={biggestFailure}
                    onChange={e => setBiggestFailure(e.target.value)}
                    placeholder="Where did you fall short + what are you going to change?"
                    className="min-h-[50px] text-sm"
                  />
                </div>
                {biggestFailure.trim() && (
                  <div>
                    <label className="text-xs font-semibold mb-1 block">What are you going to change?</label>
                    <Textarea
                      value={failureChange}
                      onChange={e => setFailureChange(e.target.value)}
                      placeholder="Concrete change you'll make this week..."
                      className="min-h-[40px] text-sm"
                    />
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* ===== THIS WEEK PLANNING ===== */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Compass className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-bold">This Week's Plan</h3>
              </div>

              {/* Commitment */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-3.5 w-3.5 text-status-yellow" />
                  <label className="text-xs font-semibold">Commitment for the Week</label>
                </div>
                <Textarea
                  value={commitment}
                  onChange={e => setCommitment(e.target.value)}
                  placeholder="What is your #1 commitment this week?"
                  className="min-h-[60px] text-sm"
                />
              </div>

              {/* Key Goals */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <ChevronRight className="h-3.5 w-3.5 text-primary" />
                  <label className="text-xs font-semibold">Key Goals for This Week</label>
                  <span className="text-[10px] text-muted-foreground italic">(Key outcomes)</span>
                </div>
                <div className="space-y-2">
                  {keyGoals.map((g, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                      <Input
                        value={g}
                        onChange={e => {
                          const next = [...keyGoals];
                          next[i] = e.target.value;
                          setKeyGoals(next);
                        }}
                        placeholder={`Goal ${i + 1}`}
                        className="text-sm h-8"
                      />
                      {keyGoals.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setKeyGoals(keyGoals.filter((_, j) => j !== i))}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {keyGoals.length < 5 && (
                    <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setKeyGoals([...keyGoals, ''])}>
                      <Plus className="h-3 w-3 mr-1" /> Add goal
                    </Button>
                  )}
                </div>
              </div>

              {/* Key Client Meetings — structured */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-3.5 w-3.5 text-status-green" />
                  <label className="text-xs font-semibold">Key Client Meetings This Week</label>
                  <span className="text-[10px] text-muted-foreground italic">(deal progression, new opps, etc)</span>
                </div>
                <div className="space-y-2">
                  {clientMeetings.map((m, i) => (
                    <div key={i} className="grid grid-cols-[90px_1fr_1fr_28px] gap-2 items-center">
                      <Input
                        type="date"
                        value={m.date}
                        onChange={e => updateMeeting(i, 'date', e.target.value)}
                        className="text-xs h-8"
                      />
                      <Input
                        value={m.client}
                        onChange={e => updateMeeting(i, 'client', e.target.value)}
                        placeholder="Client"
                        className="text-sm h-8"
                      />
                      <Input
                        value={m.goal}
                        onChange={e => updateMeeting(i, 'goal', e.target.value)}
                        placeholder="Goal / Purpose"
                        className="text-sm h-8"
                      />
                      {clientMeetings.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setClientMeetings(clientMeetings.filter((_, j) => j !== i))}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {clientMeetings.length < 8 && (
                    <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setClientMeetings([...clientMeetings, { date: '', client: '', goal: '' }])}>
                      <Plus className="h-3 w-3 mr-1" /> Add meeting
                    </Button>
                  )}
                </div>
              </div>

              {/* Skill Development */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="h-3.5 w-3.5 text-accent-foreground" />
                  <label className="text-xs font-semibold">How I'm Up-Leveling My Skills</label>
                  <span className="text-[10px] text-muted-foreground italic">(Podcasts, books, training, etc)</span>
                </div>
                <Textarea
                  value={skillDevelopment}
                  onChange={e => setSkillDevelopment(e.target.value)}
                  placeholder="What are you learning this week?"
                  className="min-h-[50px] text-sm"
                />
              </div>
            </section>

            <Separator />

            {/* ===== RENEWALS THIS QUARTER ===== */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <RefreshCw className="h-4 w-4 text-status-green" />
                <h3 className="font-display text-sm font-bold">Renewal Opportunities Due This Quarter</h3>
                <Badge variant="outline" className="text-[10px]">Auto-populated</Badge>
                {totalRenewalArr > 0 && (
                  <span className="text-xs font-mono text-muted-foreground ml-auto">{formatCurrency(totalRenewalArr)} ARR</span>
                )}
              </div>
              {renewalsLoading ? (
                <div className="text-xs text-muted-foreground">Loading renewals...</div>
              ) : !renewals?.length ? (
                <p className="text-xs text-muted-foreground">No renewals due this quarter.</p>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_90px_80px_90px] gap-2 px-3 py-1.5 bg-muted/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span>Account</span>
                    <span className="text-right">ARR</span>
                    <span>CSM</span>
                    <span>Due Date</span>
                  </div>
                  {renewals.map(r => (
                    <div key={r.id} className="grid grid-cols-[1fr_90px_80px_90px] gap-2 px-3 py-2 border-t border-border text-xs items-center">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium truncate">{r.account_name}</span>
                        {r.churn_risk && (
                          <span className={cn("text-[10px] shrink-0", RISK_COLORS[r.churn_risk] || 'text-muted-foreground')}>●</span>
                        )}
                      </div>
                      <span className="font-mono text-right">{formatCurrency(Number(r.arr))}</span>
                      <span className="text-muted-foreground truncate">{r.csm || '—'}</span>
                      <span className="text-muted-foreground">
                        {new Date(r.renewal_due + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            {/* ===== PIPELINE OVERVIEW ===== */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-bold">Pipeline Overview</h3>
                <Badge variant="outline" className="text-[10px]">Auto-populated</Badge>
                {totalPipelineArr > 0 && (
                  <span className="text-xs font-mono text-muted-foreground ml-auto">{formatCurrency(totalPipelineArr)} total</span>
                )}
              </div>
              {pipelineLoading ? (
                <div className="text-xs text-muted-foreground">Loading pipeline...</div>
              ) : pipelineByStage.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active pipeline opportunities.</p>
              ) : (
                <div className="space-y-3">
                  {pipelineByStage.map(({ stage, opps }) => (
                    <div key={stage}>
                      <h4 className="text-xs font-bold mb-1">
                        {stage} <span className="text-muted-foreground font-normal">({opps.length})</span>
                        <span className="font-mono text-muted-foreground ml-2">
                          {formatCurrency(opps.reduce((s, o) => s + (Number(o.arr) || 0), 0))}
                        </span>
                      </h4>
                      <div className="space-y-1 ml-3">
                        {opps.map(o => (
                          <div key={o.id} className="flex items-center gap-2 text-xs">
                            <span className="font-medium truncate flex-1">{o.name}</span>
                            {o.arr && <span className="font-mono text-muted-foreground">{formatCurrency(Number(o.arr))}</span>}
                            {o.next_step && <span className="text-muted-foreground truncate max-w-[150px]">→ {o.next_step}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-border flex justify-end">
          <Button onClick={handleSave} disabled={saveReview.isPending} className="min-w-[160px]">
            {saveReview.isPending ? 'Saving...' : 'Complete Weekly Review'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
