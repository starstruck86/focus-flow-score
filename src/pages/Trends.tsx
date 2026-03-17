import { useState } from 'react';
import { Layout } from '@/components/Layout';
import {
  TrendingUp, BarChart3, Activity, Zap, Target, Brain,
  ArrowUpRight, ArrowDownRight, Minus, Phone, Users, Calendar,
  Lightbulb, Gauge,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useTrendsData, type TrendRange } from '@/hooks/useTrendsData';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart,
  RadialBarChart, RadialBar, Cell,
} from 'recharts';

const RANGES: { value: TrendRange; label: string }[] = [
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
];

export default function Trends() {
  const [range, setRange] = useState<TrendRange>('14d');
  const { data, isLoading } = useTrendsData(range);

  const metrics = data?.dailyMetrics || [];
  const weeks = data?.weeklyAggregates || [];
  const correlations = data?.correlations || [];
  const funnel = data?.funnel;

  const hasData = metrics.length >= 3;

  // Summary stats
  const avgScore = metrics.filter(m => m.dailyScore != null).length > 0
    ? Math.round(metrics.filter(m => m.dailyScore != null).reduce((s, m) => s + m.dailyScore!, 0) / metrics.filter(m => m.dailyScore != null).length * 10) / 10
    : null;
  const goalMetRate = metrics.length > 0
    ? Math.round(metrics.filter(m => m.goalMet).length / metrics.length * 100)
    : 0;
  const totalDials = metrics.reduce((s, m) => s + m.dials, 0);
  const totalMeetings = metrics.reduce((s, m) => s + m.meetingsSet, 0);

  return (
    <Layout>
      <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Trends & Insights
            </h1>
            <p className="text-sm text-muted-foreground">
              Performance analytics, correlations & patterns
            </p>
          </div>
          <Tabs value={range} onValueChange={(v) => setRange(v as TrendRange)}>
            <TabsList className="h-8">
              {RANGES.map(r => (
                <TabsTrigger key={r.value} value={r.value} className="text-xs px-3 h-7">
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {!hasData && !isLoading ? (
          <Card className="text-center py-16 border-dashed">
            <CardContent>
              <div className="flex items-center justify-center gap-4 mb-6">
                <BarChart3 className="h-12 w-12 text-muted-foreground/40" />
                <TrendingUp className="h-12 w-12 text-muted-foreground/40" />
              </div>
              <h2 className="font-display text-xl font-semibold mb-2">Not Enough Data Yet</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Log at least 3 days via your Daily Journal to start seeing trends, patterns, and correlations here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard label="Avg Daily Score" value={avgScore != null ? `${avgScore}` : '—'} icon={<Target className="h-4 w-4" />} accent="text-primary" />
              <SummaryCard label="Goal Met Rate" value={`${goalMetRate}%`} icon={<Zap className="h-4 w-4" />} accent="text-status-green" />
              <SummaryCard label="Total Dials" value={totalDials.toLocaleString()} icon={<Phone className="h-4 w-4" />} accent="text-strain" />
              <SummaryCard label="Meetings Set" value={totalMeetings.toString()} icon={<Calendar className="h-4 w-4" />} accent="text-recovery" />
            </div>

            {/* Activity Over Time */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Daily Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={metrics}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 15]} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="dials" name="Dials" fill="hsl(var(--strain))" opacity={0.7} radius={[2, 2, 0, 0]} />
                      <Bar yAxisId="left" dataKey="conversations" name="Convos" fill="hsl(var(--recovery))" opacity={0.8} radius={[2, 2, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="dailyScore" name="Score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Conversion Funnel + Weekly Trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Funnel */}
              {funnel && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Gauge className="h-4 w-4 text-primary" />
                      Conversion Funnel
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <FunnelStep label="Dials" value={funnel.dials} rate={null} color="bg-strain/20 text-strain" />
                    <FunnelArrow rate={funnel.dialToConversation} />
                    <FunnelStep label="Conversations" value={funnel.conversations} rate={funnel.dialToConversation} color="bg-recovery/20 text-recovery" />
                    <FunnelArrow rate={funnel.conversationToMeeting} />
                    <FunnelStep label="Meetings Set" value={funnel.meetingsSet} rate={funnel.conversationToMeeting} color="bg-productivity/20 text-productivity" />
                    <FunnelArrow rate={funnel.meetingToOpp} />
                    <FunnelStep label="Opps Created" value={funnel.oppsCreated} rate={funnel.meetingToOpp} color="bg-primary/20 text-primary" />
                  </CardContent>
                </Card>
              )}

              {/* Weekly trend */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Weekly Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weeks}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="dials" name="Dials" fill="hsl(var(--strain))" opacity={0.7} radius={[2, 2, 0, 0]} />
                        <Bar dataKey="meetingsSet" name="Mtgs Set" fill="hsl(var(--recovery))" opacity={0.8} radius={[2, 2, 0, 0]} />
                        <Bar dataKey="oppsCreated" name="Opps" fill="hsl(var(--primary))" opacity={0.8} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Biometric overlay (if WHOOP data exists) */}
            {metrics.some(m => m.recovery != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-recovery" />
                    Biometric × Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={metrics}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10 }} domain={[0, 100]} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 15]} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area yAxisId="left" type="monotone" dataKey="recovery" name="Recovery %" fill="hsl(var(--recovery))" fillOpacity={0.15} stroke="hsl(var(--recovery))" strokeWidth={2} />
                        <Area yAxisId="left" type="monotone" dataKey="strain" name="Strain" fill="hsl(var(--strain))" fillOpacity={0.1} stroke="hsl(var(--strain))" strokeWidth={1.5} />
                        <Line yAxisId="right" type="monotone" dataKey="dailyScore" name="Daily Score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Score + Focus trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    Daily Score Trend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={metrics.filter(m => m.dailyScore != null)}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, 15]} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                        <defs>
                          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="dailyScore" name="Score" fill="url(#scoreGrad)" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: 'hsl(var(--primary))' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {metrics.some(m => m.focusScore != null) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Brain className="h-4 w-4 text-productivity" />
                      Phone Focus Score
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={metrics.filter(m => m.focusScore != null)}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                          <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} domain={[0, 10]} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                          <defs>
                            <linearGradient id="focusGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--productivity))" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="hsl(var(--productivity))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Area type="monotone" dataKey="focusScore" name="Focus" fill="url(#focusGrad)" stroke="hsl(var(--productivity))" strokeWidth={2} dot={{ r: 3, fill: 'hsl(var(--productivity))' }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Correlations & Insights */}
            {correlations.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-status-amber" />
                    Correlations & Insights
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {correlations.map((c, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/40 border border-border/30 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{c.emoji}</span>
                          <span className="text-xs font-semibold">{c.label}</span>
                          <Badge variant="outline" className={cn(
                            'text-[10px] ml-auto',
                            c.strength === 'strong' ? 'border-status-green/50 text-status-green'
                              : c.strength === 'moderate' ? 'border-status-amber/50 text-status-amber'
                                : 'border-muted-foreground/50 text-muted-foreground'
                          )}>
                            {c.strength}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{c.description}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3 flex items-center gap-3">
        <div className={cn('p-2 rounded-lg bg-muted/60', accent)}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold font-display">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelStep({ label, value, rate, color }: { label: string; value: number; rate: number | null; color: string }) {
  return (
    <div className={cn('flex items-center justify-between px-3 py-2 rounded-lg', color)}>
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-sm font-bold">{value.toLocaleString()}</span>
    </div>
  );
}

function FunnelArrow({ rate }: { rate: number }) {
  return (
    <div className="flex items-center justify-center gap-1 py-0.5">
      <ArrowDownRight className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] font-semibold text-muted-foreground">{rate}%</span>
    </div>
  );
}
