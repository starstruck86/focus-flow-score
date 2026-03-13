import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Target, Trophy, TrendingUp, AlertTriangle, Calendar, BookOpen, 
  Plus, X, Compass, DollarSign, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  useWeeklyMetricsAggregation, 
  usePipelineForReview, 
  useSaveWeeklyReview, 
  getCurrentWeekRange 
} from '@/hooks/useWeeklyReview';

interface Props {
  open: boolean;
  onComplete: () => void;
}

const STAGE_ORDER = ['1 - Prospect', '2 - Discover', '3 - Demo', '4 - Proposal', '5 - Negotiate'];

export function WeeklyRealignmentModal({ open, onComplete }: Props) {
  const { data: metrics, isLoading: metricsLoading } = useWeeklyMetricsAggregation();
  const { data: pipeline, isLoading: pipelineLoading } = usePipelineForReview();
  const saveReview = useSaveWeeklyReview();
  const { weekStart, weekEnd } = getCurrentWeekRange();

  // North Star goals (persistent)
  const [northStarGoals, setNorthStarGoals] = useState<string[]>([
    "President's Club - 125% of quota - top rep",
    'Most Dials Every Week',
    'Most New Logo Opps + Pipeline every week',
  ]);

  // User inputs
  const [commitment, setCommitment] = useState('');
  const [keyGoals, setKeyGoals] = useState<string[]>(['', '', '']);
  const [keyMeetings, setKeyMeetings] = useState('');
  const [skillDevelopment, setSkillDevelopment] = useState('');
  const [biggestWin, setBiggestWin] = useState('');
  const [biggestFailure, setBiggestFailure] = useState('');
  const [failureChange, setFailureChange] = useState('');

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

  const pipelineByStage = STAGE_ORDER.map(stage => ({
    stage,
    opps: (pipeline || []).filter(o => o.stage === stage),
  })).filter(g => g.opps.length > 0);

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
        keyClientMeetings: keyMeetings,
        skillDevelopment,
        northStarGoals,
      });
      toast.success('Weekly realignment complete!');
      onComplete();
    } catch {
      toast.error('Failed to save weekly review');
    }
  };

  const isLoading = metricsLoading || pipelineLoading;

  return (
    <Dialog open={open} onOpenChange={() => {/* Blocking - can't dismiss */}}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 [&>button]:hidden" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
        <DialogHeader className="p-6 pb-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Compass className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="font-display text-xl">Weekly Realignment</DialogTitle>
              <DialogDescription className="text-xs">
                Week of {new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — Your North Star
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-180px)]">
          <div className="p-6 space-y-6">
            {/* North Star Goals */}
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

            {/* Commitment for the Week */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="h-4 w-4 text-status-yellow" />
                <h3 className="font-display text-sm font-bold">Commitment for the Week</h3>
              </div>
              <Textarea
                value={commitment}
                onChange={e => setCommitment(e.target.value)}
                placeholder="What is your #1 commitment this week?"
                className="min-h-[60px] text-sm"
              />
            </section>

            {/* Key Goals */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <ChevronRight className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-bold">Key Goals for This Week</h3>
                <span className="text-xs text-muted-foreground italic">(Key outcomes)</span>
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
            </section>

            {/* Key Client Meetings */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-status-green" />
                <h3 className="font-display text-sm font-bold">Key Client Meetings This Week</h3>
                <span className="text-xs text-muted-foreground italic">(deal progression, new opps, etc)</span>
              </div>
              <Textarea
                value={keyMeetings}
                onChange={e => setKeyMeetings(e.target.value)}
                placeholder="List key meetings and their purpose..."
                className="min-h-[60px] text-sm"
              />
            </section>

            {/* Skill Development */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="h-4 w-4 text-accent-foreground" />
                <h3 className="font-display text-sm font-bold">How I'm Up-Leveling My Skills</h3>
                <span className="text-xs text-muted-foreground italic">(Podcasts, books, training, etc)</span>
              </div>
              <Textarea
                value={skillDevelopment}
                onChange={e => setSkillDevelopment(e.target.value)}
                placeholder="What are you learning this week?"
                className="min-h-[50px] text-sm"
              />
            </section>

            <Separator />

            {/* Weekly Recap (last week auto-populated) */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-bold">Last Week Recap</h3>
                <Badge variant="outline" className="text-[10px]">Auto-populated</Badge>
              </div>
              {isLoading ? (
                <div className="text-xs text-muted-foreground">Loading metrics...</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {[
                    { label: 'Dials', value: metrics?.totalDials || 0 },
                    { label: 'Conversations', value: metrics?.totalConversations || 0 },
                    { label: 'Meetings Set', value: metrics?.totalMeetingsSet || 0 },
                    { label: 'Meetings Held', value: metrics?.totalMeetingsHeld || 0 },
                    { label: 'Opps Created', value: metrics?.totalOppsCreated || 0 },
                    { label: 'Prospects Added', value: metrics?.totalProspectsAdded || 0 },
                    { label: 'Days Goal Met', value: `${metrics?.daysGoalMet || 0}/${metrics?.daysLogged || 0}` },
                    { label: 'Avg Score', value: (metrics?.avgDailyScore || 0).toFixed(1) },
                  ].map(m => (
                    <Card key={m.label} className="p-2 text-center">
                      <div className="text-lg font-bold font-mono">{m.value}</div>
                      <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Biggest Win */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold flex items-center gap-1 mb-1">
                    <Trophy className="h-3 w-3 text-status-yellow" /> Biggest wins last week?
                  </label>
                  <Textarea
                    value={biggestWin}
                    onChange={e => setBiggestWin(e.target.value)}
                    placeholder="New opps, closed deals, big meetings..."
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
                    placeholder="Where did you fall short?"
                    className="min-h-[50px] text-sm"
                  />
                </div>
                {biggestFailure.trim() && (
                  <div>
                    <label className="text-xs font-semibold mb-1 block">What are you going to change?</label>
                    <Textarea
                      value={failureChange}
                      onChange={e => setFailureChange(e.target.value)}
                      placeholder="Concrete change you'll make..."
                      className="min-h-[40px] text-sm"
                    />
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* Pipeline Overview */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-status-green" />
                <h3 className="font-display text-sm font-bold">Pipeline Overview</h3>
                <Badge variant="outline" className="text-[10px]">Auto-populated</Badge>
              </div>
              {pipelineLoading ? (
                <div className="text-xs text-muted-foreground">Loading pipeline...</div>
              ) : pipelineByStage.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active pipeline opportunities.</p>
              ) : (
                <div className="space-y-3">
                  {pipelineByStage.map(({ stage, opps }) => (
                    <div key={stage}>
                      <h4 className="text-xs font-bold mb-1">{stage} <span className="text-muted-foreground font-normal">({opps.length})</span></h4>
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
          <Button onClick={handleSave} disabled={saveReview.isPending} className="min-w-[140px]">
            {saveReview.isPending ? 'Saving...' : 'Complete Realignment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
