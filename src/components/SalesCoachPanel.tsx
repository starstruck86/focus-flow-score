import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  GraduationCap, TrendingUp, Target, Mic, Sparkles, ArrowRight,
  CheckCircle2, AlertTriangle, Lightbulb, BarChart3, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCallTranscripts } from '@/hooks/useCallTranscripts';
import { useAllTranscriptGrades, useGradeTranscript, useTranscriptGrade, type TranscriptGrade } from '@/hooks/useTranscriptGrades';
import { format, parseISO } from 'date-fns';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend,
} from 'recharts';

interface SalesCoachPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-400', A: 'text-emerald-400', 'A-': 'text-emerald-500',
  'B+': 'text-blue-400', B: 'text-blue-400', 'B-': 'text-blue-500',
  'C+': 'text-amber-400', C: 'text-amber-400', 'C-': 'text-amber-500',
  'D+': 'text-orange-400', D: 'text-orange-500', F: 'text-red-500',
};

const FOCUS_ICONS: Record<string, typeof Target> = {
  style: Mic, acumen: Lightbulb, cadence: Target,
};

function ScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: any }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-blue-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="font-mono font-bold">{score}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full', color)}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function GradeCard({ grade }: { grade: TranscriptGrade }) {
  const FocusIcon = FOCUS_ICONS[grade.feedback_focus] || Target;
  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-4">
        {/* Header with grade */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{grade.summary}</p>
          </div>
          <div className="text-right">
            <span className={cn('text-4xl font-black font-mono', GRADE_COLORS[grade.overall_grade] || 'text-foreground')}>
              {grade.overall_grade}
            </span>
            <p className="text-xs text-muted-foreground">{grade.overall_score}/100</p>
          </div>
        </div>

        {/* Dimension scores */}
        <div className="space-y-2.5">
          <ScoreBar label="Style" score={grade.style_score} icon={Mic} />
          <ScoreBar label="Acumen" score={grade.acumen_score} icon={Lightbulb} />
          <ScoreBar label="Cadence" score={grade.cadence_score} icon={Target} />
        </div>

        {/* Actionable feedback */}
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <FocusIcon className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Focus: {grade.feedback_focus}
            </span>
          </div>
          <p className="text-sm leading-relaxed">{grade.actionable_feedback}</p>
        </div>

        {/* Strengths & Improvements */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Strengths
            </p>
            {grade.strengths?.map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground">• {s}</p>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Improve
            </p>
            {grade.improvements?.map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground">• {s}</p>
            ))}
          </div>
        </div>

        {grade.methodology_alignment && (
          <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">
            📚 {grade.methodology_alignment}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SalesCoachPanel({ open, onOpenChange }: SalesCoachPanelProps) {
  const [tab, setTab] = useState('grade');
  const { data: transcripts, isLoading: loadingTranscripts } = useCallTranscripts();
  const { data: allGrades, isLoading: loadingGrades } = useAllTranscriptGrades();
  const gradeTranscript = useGradeTranscript();
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string | null>(null);
  const { data: selectedGrade } = useTranscriptGrade(selectedTranscriptId || undefined);

  // Ungraded transcripts
  const gradedIds = new Set((allGrades || []).map(g => g.transcript_id));
  const ungraded = (transcripts || []).filter(t => !gradedIds.has(t.id));

  // Trend data from all grades sorted by date
  const trendData = (allGrades || [])
    .sort((a, b) => {
      const dateA = (a as any).call_transcripts?.call_date || a.created_at;
      const dateB = (b as any).call_transcripts?.call_date || b.created_at;
      return dateA.localeCompare(dateB);
    })
    .map((g: any) => ({
      date: g.call_transcripts?.call_date
        ? format(parseISO(g.call_transcripts.call_date), 'M/d')
        : format(parseISO(g.created_at), 'M/d'),
      style: g.style_score,
      acumen: g.acumen_score,
      cadence: g.cadence_score,
      overall: g.overall_score,
      title: g.call_transcripts?.title || 'Call',
    }));

  // Averages for radar
  const avg = (field: 'style_score' | 'acumen_score' | 'cadence_score') => {
    if (!allGrades?.length) return 0;
    return Math.round(allGrades.reduce((s, g) => s + g[field], 0) / allGrades.length);
  };
  const radarData = [
    { dimension: 'Style', score: avg('style_score'), fullMark: 100 },
    { dimension: 'Acumen', score: avg('acumen_score'), fullMark: 100 },
    { dimension: 'Cadence', score: avg('cadence_score'), fullMark: 100 },
  ];

  // Recent trend direction
  const recentGrades = (allGrades || []).slice(0, 5);
  const olderGrades = (allGrades || []).slice(5, 10);
  const trendDirection = recentGrades.length >= 2 && olderGrades.length >= 2
    ? (recentGrades.reduce((s, g) => s + g.overall_score, 0) / recentGrades.length) -
      (olderGrades.reduce((s, g) => s + g.overall_score, 0) / olderGrades.length)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Sales Coach
            {(allGrades?.length || 0) > 0 && (
              <Badge variant="secondary" className="ml-2">
                {allGrades!.length} graded
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="grade" className="flex-1">Grade Call</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
            <TabsTrigger value="trends" className="flex-1">Trends</TabsTrigger>
          </TabsList>

          {/* GRADE TAB */}
          <TabsContent value="grade" className="space-y-4 mt-4">
            {selectedGrade ? (
              <div className="space-y-3">
                <Button variant="ghost" size="sm" onClick={() => setSelectedTranscriptId(null)}>
                  ← Back to transcripts
                </Button>
                <GradeCard grade={selectedGrade} />
              </div>
            ) : (
              <>
                {ungraded.length === 0 && (transcripts?.length || 0) === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Mic className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">No transcripts yet</p>
                    <p className="text-sm">Upload call transcripts to get AI coaching</p>
                  </div>
                )}
                {ungraded.length === 0 && (transcripts?.length || 0) > 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                    <p className="font-medium">All transcripts graded!</p>
                    <p className="text-sm">Check your trends in the Trends tab</p>
                  </div>
                )}
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
                        onClick={() => {
                          setSelectedTranscriptId(t.id);
                          gradeTranscript.mutate(t.id);
                        }}
                        disabled={gradeTranscript.isPending}
                      >
                        {gradeTranscript.isPending && gradeTranscript.variables === t.id ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Grading...</>
                        ) : (
                          <><Sparkles className="h-3.5 w-3.5 mr-1" /> Grade</>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {/* Already graded - quick access */}
                {(allGrades || []).length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recently Graded</p>
                    {(allGrades || []).slice(0, 5).map((g: any) => (
                      <div
                        key={g.id}
                        className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => { setSelectedTranscriptId(g.transcript_id); }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{g.call_transcripts?.title || 'Call'}</p>
                          <p className="text-xs text-muted-foreground">
                            {g.call_transcripts?.call_date ? format(parseISO(g.call_transcripts.call_date), 'MMM d') : ''}
                          </p>
                        </div>
                        <span className={cn('text-lg font-black font-mono', GRADE_COLORS[g.overall_grade])}>
                          {g.overall_grade}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* HISTORY TAB */}
          <TabsContent value="history" className="space-y-3 mt-4">
            {(allGrades || []).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>No grades yet. Grade some transcripts first.</p>
              </div>
            ) : (
              (allGrades || []).map((g: any) => (
                <div
                  key={g.id}
                  className="cursor-pointer"
                  onClick={() => { setSelectedTranscriptId(g.transcript_id); setTab('grade'); }}
                >
                  <Card className="border-border/50 hover:border-primary/30 transition-colors">
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
                      <div className="flex gap-4 text-xs">
                        <span>Style: <strong>{g.style_score}</strong></span>
                        <span>Acumen: <strong>{g.acumen_score}</strong></span>
                        <span>Cadence: <strong>{g.cadence_score}</strong></span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ))
            )}
          </TabsContent>

          {/* TRENDS TAB */}
          <TabsContent value="trends" className="space-y-4 mt-4">
            {trendData.length < 2 ? (
              <div className="text-center py-8 text-muted-foreground">
                <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>Grade at least 2 transcripts to see trends</p>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  {radarData.map(d => (
                    <Card key={d.dimension} className="border-border/50">
                      <CardContent className="p-3 text-center">
                        <p className="text-xs text-muted-foreground">{d.dimension}</p>
                        <p className="text-2xl font-black font-mono">{d.score}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Trend direction */}
                {Math.abs(trendDirection) > 2 && (
                  <div className={cn(
                    'rounded-lg p-3 text-sm flex items-center gap-2',
                    trendDirection > 0
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  )}>
                    <TrendingUp className={cn('h-4 w-4', trendDirection < 0 && 'rotate-180')} />
                    {trendDirection > 0
                      ? `Trending up +${Math.round(trendDirection)} pts — keep pushing!`
                      : `Down ${Math.round(Math.abs(trendDirection))} pts — time to refocus.`}
                  </div>
                )}

                {/* Radar chart */}
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Skill Profile</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="dimension" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Line chart over time */}
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Score Trends Over Time</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                          labelStyle={{ color: 'hsl(var(--foreground))' }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="overall" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 4 }} name="Overall" />
                        <Line type="monotone" dataKey="style" stroke="#f472b6" strokeWidth={1.5} dot={{ r: 3 }} name="Style" />
                        <Line type="monotone" dataKey="acumen" stroke="#60a5fa" strokeWidth={1.5} dot={{ r: 3 }} name="Acumen" />
                        <Line type="monotone" dataKey="cadence" stroke="#34d399" strokeWidth={1.5} dot={{ r: 3 }} name="Cadence" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Focus area breakdown */}
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Coaching Focus Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {['style', 'acumen', 'cadence'].map(focus => {
                      const count = (allGrades || []).filter(g => g.feedback_focus === focus).length;
                      const pct = allGrades?.length ? Math.round((count / allGrades.length) * 100) : 0;
                      return (
                        <div key={focus} className="flex items-center gap-3 py-1.5">
                          <span className="text-sm capitalize w-20">{focus}</span>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', focus === 'style' ? 'bg-pink-400' : focus === 'acumen' ? 'bg-blue-400' : 'bg-emerald-400')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-12 text-right">{count}× ({pct}%)</span>
                        </div>
                      );
                    })}
                    <p className="text-xs text-muted-foreground mt-2">
                      The AI prioritizes your highest-ROI improvement area per call.
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
