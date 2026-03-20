import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  GraduationCap, TrendingUp, Target, Mic, Sparkles, ArrowRight, ArrowUp, ArrowDown, Minus,
  CheckCircle2, AlertTriangle, Lightbulb, BarChart3, Loader2, MessageSquareQuote,
  ShieldCheck, ShieldAlert, Brain, Crosshair, Zap, Clock, Eye, FileText,
  Upload, Plus, ChevronDown, ChevronUp, Wand2, Swords, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCallTranscripts, useSaveTranscript } from '@/hooks/useCallTranscripts';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useStore } from '@/store/useStore';
import {
  useAllTranscriptGrades, useGradeTranscript, useTranscriptGrade,
  useBehavioralPatterns, useMeddiccCompleteness,
  type TranscriptGrade, type EvidenceItem,
} from '@/hooks/useTranscriptGrades';
import { format, parseISO } from 'date-fns';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, Cell,
} from 'recharts';
import {
  detectAccountFromTranscript,
  SideBySideViewer,
  PreCallCoach,
  DealIntelligence,
  WeeklyCoachingDigest,
  CoachingStreaks,
  CoachingFocus,
  MockCallSimulator,
  ObjectionDrillReps,
} from '@/components/coach';

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-grade-excellent', A: 'text-grade-excellent', 'A-': 'text-grade-excellent',
  'B+': 'text-grade-good', B: 'text-grade-good', 'B-': 'text-grade-good',
  'C+': 'text-grade-average', C: 'text-grade-average', 'C-': 'text-grade-average',
  'D+': 'text-grade-poor', D: 'text-grade-poor', F: 'text-grade-failing',
};

const CATEGORY_LABELS: Record<string, { label: string; icon: any }> = {
  structure: { label: 'Structure', icon: Clock },
  cotm: { label: 'Command of Message', icon: Crosshair },
  meddicc: { label: 'MEDDICC', icon: ShieldCheck },
  discovery: { label: 'Discovery Depth', icon: Eye },
  presence: { label: 'Executive Presence', icon: Brain },
  commercial: { label: 'Commercial Acumen', icon: Zap },
  next_step: { label: 'Next Step Control', icon: Target },
};

const MEDDICC_LABELS: Record<string, string> = {
  metrics: 'Metrics',
  economic_buyer: 'Economic Buyer',
  decision_criteria: 'Decision Criteria',
  decision_process: 'Decision Process',
  identify_pain: 'Identify Pain',
  champion: 'Champion',
  competition: 'Competition',
};

function ScoreBlock({ score, label, max = 5 }: { score: number; label: string; max?: number }) {
  const pct = (score / max) * 100;
  const color = pct >= 80 ? 'bg-grade-excellent' : pct >= 60 ? 'bg-grade-good' : pct >= 40 ? 'bg-grade-average' : 'bg-grade-failing';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-bold">{score}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div className={cn('h-full rounded-full', color)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
      </div>
    </div>
  );
}

// ─── CALL SCORECARD ──────────────────────────────────────────
function CallScorecard({ grade, onRegrade }: { grade: TranscriptGrade; onRegrade?: () => void }) {
  const [showEvidence, setShowEvidence] = useState(false);

  const categories = Object.entries(CATEGORY_LABELS).map(([key, { label, icon }]) => ({
    key, label, icon,
    score: (grade as any)[`${key}_score`] || 0,
  }));

  const cotm = grade.cotm_signals || {} as any;
  const meddicc = grade.meddicc_signals || {} as any;
  const disc = grade.discovery_stats || {} as any;
  const pres = grade.presence_stats || {} as any;

  const cotmCovered = ['before_identified', 'negative_consequences', 'after_defined', 'pbo_articulated', 'required_capabilities', 'metrics_captured']
    .filter(k => cotm[k]).length;
  const meddiccCovered = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition']
    .filter(k => meddicc[k]).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-sm text-muted-foreground leading-relaxed">{grade.summary}</p>
        </div>
        <div className="text-right flex-shrink-0 ml-4 space-y-1">
          <span className={cn('text-5xl font-black font-mono', GRADE_COLORS[grade.overall_grade])}>
            {grade.overall_grade}
          </span>
          {onRegrade && (
            <Button variant="ghost" size="sm" onClick={onRegrade} className="text-[10px] h-6 gap-1">
              <Wand2 className="h-3 w-3" /> Re-analyze
            </Button>
          )}
        </div>
      </div>

      {/* Outcome Card — Deal Progression */}
      {(grade as any).deal_progressed !== undefined && (
        <Card className={cn("border-border/50", (grade as any).deal_progressed ? "bg-grade-excellent/5 border-grade-excellent/20" : "bg-grade-failing/5 border-grade-failing/20")}>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              {(grade as any).deal_progressed ? <TrendingUp className="h-4 w-4 text-grade-excellent" /> : <AlertTriangle className="h-4 w-4 text-grade-failing" />}
              <span className="text-xs font-bold uppercase tracking-wider">
                {(grade as any).deal_progressed ? 'Deal Progressed' : 'No Deal Progression'}
              </span>
              {(grade as any).likelihood_impact && (
                <Badge variant="outline" className={cn("text-[10px] ml-auto",
                  (grade as any).likelihood_impact === 'increased' ? 'border-grade-excellent/30 text-grade-excellent' :
                  (grade as any).likelihood_impact === 'decreased' ? 'border-grade-failing/30 text-grade-failing' :
                  'border-muted-foreground/30 text-muted-foreground'
                )}>
                  Win likelihood: {(grade as any).likelihood_impact}
                </Badge>
              )}
            </div>
            {(grade as any).progression_evidence && (
              <p className="text-xs text-muted-foreground">{(grade as any).progression_evidence}</p>
            )}
            {/* Goals achieved */}
            {((grade as any).goals_achieved || []).length > 0 && (
              <div className="space-y-1 pt-1 border-t border-border/30">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Call Goals</p>
                {((grade as any).goals_achieved || []).map((g: any, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    {g.achieved ? <CheckCircle2 className="h-3 w-3 text-grade-excellent mt-0.5 shrink-0" /> : <ShieldAlert className="h-3 w-3 text-grade-failing mt-0.5 shrink-0" />}
                    <div>
                      <span className={g.achieved ? 'text-foreground' : 'text-muted-foreground'}>{g.goal}</span>
                      {g.evidence && <p className="text-[10px] text-muted-foreground">{g.evidence}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Competitors */}
            {((grade as any).competitors_mentioned || []).length > 0 && (
              <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
                <Swords className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Competitors: </span>
                {((grade as any).competitors_mentioned || []).map((c: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-[10px] h-4">{c}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Category scores grid */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Category Scores</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-2">
          {categories.map(c => <ScoreBlock key={c.key} score={c.score} label={c.label} />)}
        </CardContent>
      </Card>

      {/* PRIMARY COACHING ACTION */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Primary Coaching Action — {grade.feedback_focus?.toUpperCase()}
            </span>
          </div>
          {grade.coaching_issue && <p className="text-sm font-semibold">{grade.coaching_issue}</p>}
          {grade.coaching_why && <p className="text-xs text-muted-foreground">{grade.coaching_why}</p>}
          {grade.transcript_moment && (
            <div className="rounded bg-muted/50 p-2 border-l-2 border-primary/50">
              <p className="text-xs italic text-muted-foreground">
                <MessageSquareQuote className="h-3 w-3 inline mr-1" />
                "{grade.transcript_moment}"
              </p>
            </div>
          )}
          {grade.replacement_behavior && (
            <div className="rounded bg-grade-excellent/10 border border-grade-excellent/20 p-2">
              <p className="text-xs font-medium text-grade-excellent mb-1">→ Instead, do this:</p>
              <p className="text-sm">{grade.replacement_behavior}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Framework coverage */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/50">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Crosshair className="h-3 w-3" /> CotM Coverage
              <Badge variant="outline" className="ml-auto text-[10px]">{cotmCovered}/6</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            {[
              { key: 'before_identified', label: 'Before (Current State)' },
              { key: 'negative_consequences', label: 'Neg. Consequences' },
              { key: 'after_defined', label: 'After (Desired State)' },
              { key: 'pbo_articulated', label: 'PBOs' },
              { key: 'required_capabilities', label: 'Required Capabilities' },
              { key: 'metrics_captured', label: 'Metrics' },
            ].map(item => (
              <div key={item.key} className="flex items-center gap-1.5 text-xs">
                {cotm[item.key]
                  ? <CheckCircle2 className="h-3 w-3 text-grade-excellent flex-shrink-0" />
                  : <ShieldAlert className="h-3 w-3 text-grade-failing flex-shrink-0" />}
                <span className={cotm[item.key] ? 'text-foreground' : 'text-muted-foreground'}>{item.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> MEDDICC
              <Badge variant="outline" className="ml-auto text-[10px]">{meddiccCovered}/7</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            {Object.entries(MEDDICC_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center gap-1.5 text-xs">
                {meddicc[key]
                  ? <CheckCircle2 className="h-3 w-3 text-grade-excellent flex-shrink-0" />
                  : <ShieldAlert className="h-3 w-3 text-grade-failing flex-shrink-0" />}
                <span className={meddicc[key] ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Discovery + Presence stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Discovery Stats</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div><p className="text-lg font-mono font-bold">{disc.total_questions || 0}</p><p className="text-[10px] text-muted-foreground">Questions</p></div>
              <div><p className="text-lg font-mono font-bold">{disc.open_ended_pct || 0}%</p><p className="text-[10px] text-muted-foreground">Open-ended</p></div>
              <div><p className="text-lg font-mono font-bold">{disc.impact_questions || 0}</p><p className="text-[10px] text-muted-foreground">Impact Q's</p></div>
              <div><p className="text-lg font-mono font-bold">{disc.follow_up_depth || 0}/5</p><p className="text-[10px] text-muted-foreground">Follow-up Depth</p></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Executive Presence</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div><p className="text-lg font-mono font-bold">{pres.talk_ratio_estimate || 0}%</p><p className="text-[10px] text-muted-foreground">Talk Ratio</p></div>
              <div><p className="text-lg font-mono font-bold">{pres.flow_control || 0}/5</p><p className="text-[10px] text-muted-foreground">Flow Control</p></div>
              <div className="text-xs text-muted-foreground col-span-2 flex gap-3 justify-center">
                <span className={pres.rambling_detected ? 'text-grade-failing' : 'text-grade-excellent'}>
                  {pres.rambling_detected ? '⚠ Rambling' : '✓ Concise'}
                </span>
                <span className={pres.interruptions_detected ? 'text-grade-failing' : 'text-grade-excellent'}>
                  {pres.interruptions_detected ? '⚠ Interrupts' : '✓ Listens'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strengths & Missed Opps */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-grade-excellent flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> What You Did Well
            </p>
            {(grade.strengths || []).map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground">• {s}</p>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-grade-failing flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Missed Opportunities
            </p>
            {((grade.missed_opportunities as any[]) || []).map((m: any, i: number) => (
              <div key={i} className="text-xs text-muted-foreground">
                <p>• {typeof m === 'string' ? m : m.opportunity}</p>
                {typeof m !== 'string' && m.example && (
                  <p className="ml-3 italic text-[10px]">→ {m.example}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Suggested questions */}
      {((grade.suggested_questions as any[]) || []).length > 0 && (
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-grade-good flex items-center gap-1">
              <Lightbulb className="h-3 w-3" /> Questions You Should Have Asked
            </p>
            {((grade.suggested_questions as any[]) || []).map((q: any, i: number) => (
              <div key={i} className="text-xs border-l-2 border-grade-good/30 pl-2 space-y-0.5">
                <p className="font-medium">"{q.question}"</p>
                <p className="text-[10px] text-muted-foreground">
                  {q.framework && <Badge variant="outline" className="text-[9px] h-3.5 mr-1">{q.framework}</Badge>}
                  {q.why}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Evidence toggle */}
      <Button variant="ghost" size="sm" onClick={() => setShowEvidence(!showEvidence)} className="w-full text-xs">
        <FileText className="h-3 w-3 mr-1" />
        {showEvidence ? 'Hide' : 'Show'} Evidence ({((grade.evidence as any[]) || []).length} quotes)
      </Button>
      <AnimatePresence>
        {showEvidence && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-2">
            {((grade.evidence as any[]) || []).map((e: EvidenceItem, i: number) => (
              <div key={i} className="rounded bg-muted/30 p-2 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[9px] h-4">{e.category}</Badge>
                  <span className="font-mono text-[10px]">{e.score_given}/5</span>
                </div>
                <p className="italic text-muted-foreground">"{e.quote}"</p>
                <p className="text-foreground">{e.assessment}</p>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {grade.methodology_alignment && (
        <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">
          📚 {grade.methodology_alignment}
        </p>
      )}
    </div>
  );
}

// ─── TRENDS DASHBOARD ──────────────────────────────────────
function TrendsDashboard() {
  const { data: allGrades } = useAllTranscriptGrades();
  const { patterns, weakestArea, trendSummary } = useBehavioralPatterns();
  const meddicc = useMeddiccCompleteness();

  if (!allGrades?.length || allGrades.length < 2) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">Grade at least 2 transcripts to see trends</p>
        <p className="text-sm">Your performance intelligence builds with every call analyzed</p>
      </div>
    );
  }

  const categories = Object.entries(CATEGORY_LABELS);

  const radarData = categories.map(([key, { label }]) => ({
    dimension: label.length > 12 ? label.substring(0, 12) + '…' : label,
    score: Math.round(allGrades.reduce((s, g) => s + ((g as any)[`${key}_score`] || 0), 0) / allGrades.length * 20),
    fullMark: 100,
  }));

  const trendData = [...allGrades]
    .sort((a, b) => {
      const dA = (a as any).call_transcripts?.call_date || a.created_at;
      const dB = (b as any).call_transcripts?.call_date || b.created_at;
      return dA.localeCompare(dB);
    })
    .map((g: any) => ({
      date: g.call_transcripts?.call_date
        ? format(parseISO(g.call_transcripts.call_date), 'M/d')
        : format(parseISO(g.created_at), 'M/d'),
      overall: g.overall_score,
      cotm: (g.cotm_score || 0) * 20,
      meddicc: (g.meddicc_score || 0) * 20,
      discovery: (g.discovery_score || 0) * 20,
    }));

  const meddiccBarData = meddicc?.completeness?.map(c => ({
    name: MEDDICC_LABELS[c.field] || c.field,
    pct: c.pct,
  })) || [];

  return (
    <div className="space-y-4">
      {/* #1 Focus Recommendation */}
      <CoachingFocus />

      {/* Weekly Coaching Digest */}
      <WeeklyCoachingDigest />

      {/* Coaching Streaks */}
      <CoachingStreaks />

      {/* Trend direction badges */}
      {trendSummary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {trendSummary.filter(t => t.direction !== 'stable').map(t => (
            <Badge key={t.dimension} variant="outline" className={cn(
              'text-xs',
              t.direction === 'improving' ? 'border-grade-excellent/30 text-grade-excellent' : 'border-grade-failing/30 text-grade-failing'
            )}>
              {t.direction === 'improving' ? <ArrowUp className="h-3 w-3 mr-1" /> : <ArrowDown className="h-3 w-3 mr-1" />}
              {CATEGORY_LABELS[t.dimension]?.label || t.dimension}: {t.direction === 'improving' ? '+' : ''}{t.delta}
            </Badge>
          ))}
        </div>
      )}

      {/* Weakest area callout */}
      {weakestArea && (
        <Card className="border-grade-failing/20 bg-grade-failing/5">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-grade-failing flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold">Consistent Gap: {CATEGORY_LABELS[weakestArea.category]?.label || weakestArea.category}</p>
              <p className="text-xs text-muted-foreground">Avg score: {weakestArea.avg.toFixed(1)}/5 — This is your highest-ROI improvement area</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Skill Profile Radar */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Skill Profile</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="dimension" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Score trend over time */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Score Trends Over Time</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="overall" stroke="hsl(var(--primary))" strokeWidth={2} name="Overall" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="cotm" stroke="hsl(var(--coach-cotm))" strokeWidth={1.5} name="CotM" strokeDasharray="4 2" />
              <Line type="monotone" dataKey="meddicc" stroke="hsl(var(--coach-meddicc))" strokeWidth={1.5} name="MEDDICC" strokeDasharray="4 2" />
              <Line type="monotone" dataKey="discovery" stroke="hsl(var(--coach-discovery))" strokeWidth={1.5} name="Discovery" strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* MEDDICC completeness bar chart */}
      {meddiccBarData.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm flex items-center justify-between">
              MEDDICC Completeness Across Calls
              <Badge variant="outline">{meddicc?.overallPct}% avg</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={meddiccBarData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} width={100} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {meddiccBarData.map((entry, i) => (
                    <Cell key={i} fill={entry.pct >= 70 ? 'hsl(var(--grade-excellent))' : entry.pct >= 40 ? 'hsl(var(--grade-average))' : 'hsl(var(--grade-failing))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Deal-Level Intelligence */}
      <DealIntelligence />

      {/* Behavioral patterns */}
      {patterns.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">Behavioral Patterns Detected</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {patterns.slice(0, 6).map(p => (
              <div key={p.flag} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{p.label}</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-grade-failing" style={{ width: `${p.pct}%` }} />
                  </div>
                  <span className="text-xs font-mono w-10 text-right">{p.pct}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const CALL_TYPES = [
  'Discovery Call', 'Demo', 'Technical Review', 'Executive Meeting',
  'Pricing Discussion', 'Contract Review', 'Renewal Check-in',
  'QBR', 'Follow-up', 'Other',
];

// ─── TRANSCRIPT INGESTION ──────────────────────────────────
function TranscriptIngestion({ onSaved }: { onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [title, setTitle] = useState('');
  const [callType, setCallType] = useState('');
  const [callDate, setCallDate] = useState(new Date().toISOString().split('T')[0]);
  const [participants, setParticipants] = useState('');
  const [accountId, setAccountId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [autoDetected, setAutoDetected] = useState<{ name: string; confidence: number } | null>(null);
  const [callGoals, setCallGoals] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTranscript = useSaveTranscript();
  const { user } = useAuth();
  const accounts = useStore(s => s.accounts);
  const opportunities = useStore(s => s.opportunities);

  // Auto-detect account when content or participants change
  const manuallySelected = useRef(false);
  useEffect(() => {
    if (!pasteContent && !participants) {
      setAutoDetected(null);
      return;
    }
    if (manuallySelected.current) return; // User manually picked one
    if (accountId && !autoDetected) return; // Already has a manual selection

    const timer = setTimeout(() => {
      const result = detectAccountFromTranscript(pasteContent, participants, accounts);
      if (result) {
        setAccountId(result.accountId);
        setAutoDetected({ name: result.accountName, confidence: result.confidence });
      } else {
        setAutoDetected(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [pasteContent, participants, accounts]); // removed accountId to prevent loops

  const handleFile = useCallback(async (file: File) => {
    setFileLoading(true);
    try {
      const text = await file.text();
      if (!text.trim()) {
        toast.error('File appears to be empty');
        return;
      }
      setPasteContent(text);
      if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ''));
      toast.success(`Loaded ${file.name} (${(text.length / 1000).toFixed(0)}k chars)`);
    } catch {
      toast.error('Could not read file. Please use a text-based file (.txt, .md, .vtt, .srt)');
    } finally {
      setFileLoading(false);
    }
  }, [title]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSave = async () => {
    if (!pasteContent.trim()) {
      toast.error('Paste or upload a transcript first');
      return;
    }
    const autoTitle = title.trim() || `${callType || 'Call'} — ${callDate}`;
    try {
      await saveTranscript.mutateAsync({
        title: autoTitle,
        content: pasteContent.trim(),
        call_date: callDate,
        call_type: callType || undefined,
        participants: participants.trim() || undefined,
        account_id: accountId || undefined,
        opportunity_id: opportunityId || undefined,
      });
      toast.success('Transcript saved — ready to analyze');
      setPasteContent('');
      setTitle('');
      setCallType('');
      setParticipants('');
      setCallGoals('');
      setAccountId('');
      setOpportunityId('');
      setAutoDetected(null);
      manuallySelected.current = false;
      setExpanded(false);
      onSaved();
    } catch (err: any) {
      toast.error('Failed to save', { description: err.message });
    }
  };

  return (
    <Card className={cn(
      'border-dashed transition-all',
      isDragging ? 'border-primary bg-primary/5' : 'border-border/50',
    )}>
      <CardContent
        className="p-0"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors rounded-lg"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Plus className="h-4 w-4 text-primary" />
            Add Transcript
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Paste or drag a file</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Transcript</Label>
                    <div className="flex gap-1.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md,.vtt,.srt,.doc,.csv,.text"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFile(file);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={fileLoading}
                      >
                        {fileLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                        Upload File
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    placeholder="Paste your call transcript here, or drag & drop a .txt / .vtt / .srt file..."
                    value={pasteContent}
                    onChange={e => setPasteContent(e.target.value)}
                    rows={6}
                    className="font-mono text-xs resize-y"
                  />
                  <div className="flex items-center justify-between">
                    {pasteContent && (
                      <p className="text-[10px] text-muted-foreground">{(pasteContent.length / 1000).toFixed(1)}k characters</p>
                    )}
                    {autoDetected && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 text-primary">
                        <Wand2 className="h-2.5 w-2.5" />
                        Auto-detected: {autoDetected.name} ({autoDetected.confidence}%)
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Pre-call coach (shows when account is selected) */}
                {accountId && (
                  <PreCallCoach accountId={accountId} opportunityId={opportunityId} callType={callType} />
                )}

                {/* Metadata row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Title</Label>
                    <Input placeholder="Auto-generated" value={title} onChange={e => setTitle(e.target.value)} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Call Type</Label>
                    <Select value={callType || "__none__"} onValueChange={(v) => setCallType(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Type..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Any</SelectItem>
                        {CALL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Date</Label>
                    <Input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Account {autoDetected && <span className="text-primary">(auto)</span>}</Label>
                    <Select value={accountId || "__none__"} onValueChange={(v) => { const val = v === "__none__" ? "" : v; setAccountId(val); setOpportunityId(''); setAutoDetected(null); manuallySelected.current = !!val; }}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Link account..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {accounts.sort((a, b) => a.name.localeCompare(b.name)).map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Opportunity</Label>
                    <Select value={opportunityId || "__none__"} onValueChange={(v) => setOpportunityId(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Link opp..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {opportunities
                          .filter(o => !accountId || o.accountId === accountId)
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(o => (
                            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Participants</Label>
                    <Input placeholder="Names..." value={participants} onChange={e => setParticipants(e.target.value)} className="h-7 text-xs" />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!pasteContent.trim() || saveTranscript.isPending}
                    className="gap-1.5"
                  >
                    {saveTranscript.isPending
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</>
                      : <><FileText className="h-3.5 w-3.5" /> Save & Ready to Analyze</>}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// ─── MAIN COACH PAGE ──────────────────────────────────────────
export default function Coach() {
  const [tab, setTab] = useState('simulate');
  const { data: transcripts, refetch: refetchTranscripts } = useCallTranscripts();
  const { data: allGrades, isLoading } = useAllTranscriptGrades();
  const gradeTranscript = useGradeTranscript();
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string | null>(null);
  const { data: selectedGrade } = useTranscriptGrade(selectedTranscriptId || undefined);

  // Voice event listeners for Dave integration
  useEffect(() => {
    const handleStartRoleplay = () => setTab('simulate');
    const handleStartDrill = () => setTab('drills');
    const handleGradeCall = () => {
      setTab('scorecard');
      // Auto-grade the latest ungraded transcript if available
      const gradedIds = new Set((allGrades || []).map(g => g.transcript_id));
      const ungraded = (transcripts || []).filter(t => !gradedIds.has(t.id));
      if (ungraded.length > 0) {
        setSelectedTranscriptId(ungraded[0].id);
        gradeTranscript.mutate(ungraded[0].id);
      }
    };

    window.addEventListener('voice-start-roleplay', handleStartRoleplay);
    window.addEventListener('voice-start-drill', handleStartDrill);
    window.addEventListener('voice-grade-call', handleGradeCall);
    return () => {
      window.removeEventListener('voice-start-roleplay', handleStartRoleplay);
      window.removeEventListener('voice-start-drill', handleStartDrill);
      window.removeEventListener('voice-grade-call', handleGradeCall);
    };
  }, [allGrades, transcripts, gradeTranscript]);

  // Get transcript content for side-by-side
  const selectedTranscript = (transcripts || []).find(t => t.id === selectedTranscriptId);

  const gradedIds = new Set((allGrades || []).map(g => g.transcript_id));
  const ungraded = (transcripts || []).filter(t => !gradedIds.has(t.id));

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Sales Coach</h1>
              <p className="text-xs text-muted-foreground">Performance enforcement engine — not a summarizer</p>
            </div>
          </div>
          {(allGrades?.length || 0) > 0 && (
            <Badge variant="secondary">{allGrades!.length} calls graded</Badge>
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="simulate" className="gap-1">
              <Swords className="h-3.5 w-3.5" /> Simulate
            </TabsTrigger>
            <TabsTrigger value="drills" className="gap-1">
              <Shield className="h-3.5 w-3.5" /> Drills
            </TabsTrigger>
            <TabsTrigger value="scorecard">Scorecard</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
          </TabsList>

          {/* ── SIMULATE TAB ── */}
          <TabsContent value="simulate" className="mt-4">
            <MockCallSimulator />
          </TabsContent>

          {/* ── DRILLS TAB ── */}
          <TabsContent value="drills" className="mt-4">
            <ObjectionDrillReps />
          </TabsContent>

          {/* ── SCORECARD TAB ── */}
          <TabsContent value="scorecard" className="mt-4">
            {selectedGrade ? (
              <div className="space-y-3">
                <Button variant="ghost" size="sm" onClick={() => setSelectedTranscriptId(null)}>
                  ← Back to transcripts
                </Button>
                {/* Side-by-side viewer when transcript content is available */}
                {selectedTranscript?.content ? (
                  <SideBySideViewer
                    transcriptContent={selectedTranscript.content}
                    grade={selectedGrade}
                    renderScorecard={() => <CallScorecard grade={selectedGrade} onRegrade={() => gradeTranscript.mutate(selectedTranscriptId!)} />}
                  />
                ) : (
                  <CallScorecard grade={selectedGrade} onRegrade={() => gradeTranscript.mutate(selectedTranscriptId!)} />
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <TranscriptIngestion onSaved={() => refetchTranscripts()} />

                {ungraded.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ready to Grade</p>
                    {ungraded.map(t => (
                      <Card key={t.id} className="border-border/50 hover:border-primary/30 transition-colors">
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{t.title || 'Untitled Call'}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{format(parseISO(t.call_date), 'MMM d, yyyy')}</span>
                              {t.call_type && <Badge variant="outline" className="text-[10px] h-4">{t.call_type}</Badge>}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => { setSelectedTranscriptId(t.id); gradeTranscript.mutate(t.id); }}
                            disabled={gradeTranscript.isPending}
                          >
                            {gradeTranscript.isPending && gradeTranscript.variables === t.id
                              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Analyzing...</>
                              : <><Sparkles className="h-3.5 w-3.5 mr-1" /> Analyze</>}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {ungraded.length === 0 && !transcripts?.length && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Mic className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">No transcripts yet</p>
                    <p className="text-sm">Upload call transcripts to start your coaching journey</p>
                  </div>
                )}

                {ungraded.length === 0 && (transcripts?.length || 0) > 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-grade-excellent" />
                    <p className="font-medium">All transcripts graded</p>
                  </div>
                )}

                {(allGrades || []).length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recently Graded</p>
                    {(allGrades || []).slice(0, 8).map((g: any) => (
                      <div
                        key={g.id}
                        className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => { setSelectedTranscriptId(g.transcript_id); }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{g.call_transcripts?.title || 'Call'}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{g.call_transcripts?.call_date ? format(parseISO(g.call_transcripts.call_date), 'MMM d') : ''}</span>
                            {g.feedback_focus && (
                              <Badge variant="outline" className="text-[9px] h-3.5">Focus: {g.feedback_focus}</Badge>
                            )}
                          </div>
                        </div>
                        <span className={cn('text-xl font-black font-mono', GRADE_COLORS[g.overall_grade])}>
                          {g.overall_grade}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── HISTORY TAB ── */}
          <TabsContent value="history" className="mt-4 space-y-3">
            {(allGrades || []).length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>No grades yet. Analyze some transcripts first.</p>
              </div>
            ) : (
              (allGrades || []).map((g: any) => (
                <Card
                  key={g.id}
                  className="border-border/50 hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => { setSelectedTranscriptId(g.transcript_id); setTab('scorecard'); }}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">{g.call_transcripts?.title || 'Call'}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.call_transcripts?.call_date ? format(parseISO(g.call_transcripts.call_date), 'MMM d, yyyy') : ''}
                          {g.call_transcripts?.call_type && ` · ${g.call_transcripts.call_type}`}
                        </p>
                      </div>
                      <span className={cn('text-2xl font-black font-mono', GRADE_COLORS[g.overall_grade])}>
                        {g.overall_grade}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                      {Object.entries(CATEGORY_LABELS).slice(0, 4).map(([key, { label }]) => (
                        <span key={key}>{label}: <strong className="text-foreground">{(g as any)[`${key}_score`] || '-'}/5</strong></span>
                      ))}
                    </div>
                    {g.coaching_issue && (
                      <p className="text-xs mt-2 text-primary truncate">
                        🎯 {g.coaching_issue}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── TRENDS TAB ── */}
          <TabsContent value="trends" className="mt-4">
            <TrendsDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
