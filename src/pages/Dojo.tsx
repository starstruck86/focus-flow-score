import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import {
  Flame, Play, Swords, Target, MessageSquare, Zap, Compass, ShieldCheck,
  TrendingUp, TrendingDown, BarChart3, Brain, Eye, AlertTriangle,
} from 'lucide-react';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import { useDojoStats } from '@/lib/dojo/useDojoStreak';
import { getSmartAutopilotRecommendation } from '@/lib/dojo/smartAutopilot';
import { buildPatternMemory, deriveCoachingInsights } from '@/lib/dojo/patternMemory';
import { useAuth } from '@/contexts/AuthContext';
import type { PatternMemory, CoachingInsights } from '@/lib/dojo/types';

export default function Dojo() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: stats } = useDojoStats();

  const { data: patternMemory } = useQuery<PatternMemory | null>({
    queryKey: ['dojo-pattern-memory', user?.id],
    enabled: !!user?.id && (stats?.totalSessions ?? 0) >= 3,
    queryFn: () => user ? buildPatternMemory(user.id) : null,
    staleTime: 5 * 60 * 1000,
  });

  const coachingInsights = useMemo<CoachingInsights | null>(
    () => patternMemory ? deriveCoachingInsights(patternMemory) : null,
    [patternMemory]
  );

  const recommendation = useMemo(
    () => getSmartAutopilotRecommendation(stats?.skillBreakdown, patternMemory),
    [stats?.skillBreakdown, patternMemory]
  );

  const startAutopilot = () => {
    navigate('/dojo/session', { state: { scenario: recommendation.scenario, mode: 'autopilot' } });
  };

  const startCustom = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'custom' } });
  };

  const startRoleplay = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'roleplay', sessionType: 'roleplay' } });
  };

  const startReview = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'review', sessionType: 'review' } });
  };

  // Skill breakdown for progress
  const skillStats = useMemo(() => {
    if (!stats?.skillBreakdown) return [];
    return stats.skillBreakdown
      .sort((a, b) => a.avgFirstAttempt - b.avgFirstAttempt);
  }, [stats?.skillBreakdown]);

  const weakestSkill = skillStats.length > 0 ? skillStats[0] : null;
  const strongestSkill = skillStats.length > 0 ? skillStats[skillStats.length - 1] : null;

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-5', SHELL.main.bottomPad)}>

        {/* ── Dave's message ── */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Swords className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">Dave</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {recommendation.daveMessage}
            </p>
          </div>
        </div>

        {/* ── Start Rep CTA ── */}
        <Button
          size="lg"
          className="w-full h-14 text-base font-semibold gap-2"
          onClick={startAutopilot}
        >
          <Play className="h-5 w-5" />
          Start Today's Rep
        </Button>

        {/* ── Scenario preview ── */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">
                {SKILL_LABELS[recommendation.scenario.skillFocus]}
              </Badge>
              <span className="text-xs text-muted-foreground">~5 min</span>
            </div>
            <p className="text-sm font-medium">{recommendation.scenario.title}</p>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {recommendation.scenario.context}
            </p>
          </CardContent>
        </Card>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={Flame} label="Streak" value={`${stats?.streak ?? 0}d`} color="text-orange-500" />
          <StatCard icon={Target} label="Last Score" value={stats?.lastScore != null ? `${stats.lastScore}` : '—'} color="text-blue-500" />
          <StatCard icon={Zap} label="Best" value={stats?.bestScore ? `${stats.bestScore}` : '—'} color="text-yellow-500" />
        </div>

        {/* ── Progress Dashboard ── */}
        {skillStats.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Skill Progress
            </p>
            <div className="space-y-2">
              {skillStats.map(s => (
                <div key={s.skill} className="flex items-center gap-3 px-1">
                  <SkillIcon skill={s.skill} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs font-medium truncate">{SKILL_LABELS[s.skill]}</p>
                      <span className="text-xs text-muted-foreground">{s.avgFirstAttempt} avg</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          s.avgFirstAttempt >= 75 ? 'bg-green-500' :
                          s.avgFirstAttempt >= 60 ? 'bg-amber-500' : 'bg-red-500'
                        )}
                        style={{ width: `${Math.min(s.avgFirstAttempt, 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground w-8 text-right">{s.count} reps</span>
                </div>
              ))}
            </div>

            {/* Quick insight row */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {strongestSkill && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-green-500/5 border border-green-500/15">
                  <TrendingUp className="h-3 w-3 text-green-500 shrink-0" />
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-medium text-foreground">Strongest:</span> {SKILL_LABELS[strongestSkill.skill]}
                  </p>
                </div>
              )}
              {weakestSkill && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-red-500/5 border border-red-500/15">
                  <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-medium text-foreground">Weakest:</span> {SKILL_LABELS[weakestSkill.skill]}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Coaching Patterns ── */}
        {coachingInsights && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5" />
              Your Coaching Patterns
            </p>
            <Card className="border-border/60">
              <CardContent className="p-3 space-y-2.5">
                <CoachingRow
                  icon={AlertTriangle}
                  label="You miss most"
                  value={coachingInsights.whatYouMissMost}
                  color="text-red-500"
                />
                <CoachingRow
                  icon={TrendingUp}
                  label="Improve fastest"
                  value={coachingInsights.whatYouImproveFastest}
                  color="text-green-500"
                />
                <CoachingRow
                  icon={Target}
                  label="Retries stick on"
                  value={coachingInsights.whereRetriesStick}
                  color="text-amber-500"
                />
                <div className="pt-1 border-t border-border/40">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Dave says: </span>
                    {coachingInsights.whatDaveWantsNext}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Training Modes ── */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Training Modes
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              icon={Swords}
              title="Drill"
              description="Single scenario, coached"
              onClick={() => startCustom('objection_handling')}
            />
            <ModeCard
              icon={MessageSquare}
              title="Roleplay"
              description="Multi-turn buyer sim"
              onClick={() => startRoleplay('discovery')}
            />
            <ModeCard
              icon={Eye}
              title="Review"
              description="Critique weak responses"
              onClick={() => startReview('objection_handling')}
            />
            <ModeCard
              icon={Compass}
              title="Autopilot"
              description="Dave picks your drill"
              onClick={startAutopilot}
            />
          </div>
        </div>

        {/* ── Custom Session ── */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Pick a Skill
          </p>
          <div className="grid grid-cols-1 gap-2">
            {(['objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification'] as SkillFocus[]).map(skill => (
              <button
                key={skill}
                onClick={() => startCustom(skill)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card hover:bg-accent/50 transition-colors text-left"
              >
                <SkillIcon skill={skill} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{SKILL_LABELS[skill]}</p>
                  <p className="text-xs text-muted-foreground">
                    {stats?.skillBreakdown?.find(s => s.skill === skill)?.count ?? 0} reps · {stats?.skillBreakdown?.find(s => s.skill === skill)?.avgFirstAttempt ?? '—'} avg
                  </p>
                </div>
                <Play className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex flex-col items-center gap-1">
        <Icon className={cn('h-4 w-4', color)} />
        <span className="text-lg font-bold">{value}</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

function SkillIcon({ skill, size = 'md' }: { skill: SkillFocus; size?: 'sm' | 'md' }) {
  const icons: Record<SkillFocus, React.ElementType> = {
    objection_handling: Swords,
    discovery: Target,
    executive_response: MessageSquare,
    deal_control: Compass,
    qualification: ShieldCheck,
  };
  const Icon = icons[skill];
  const sizeClasses = size === 'sm' ? 'h-7 w-7 rounded-md' : 'h-9 w-9 rounded-lg';
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <div className={cn(sizeClasses, 'bg-primary/10 flex items-center justify-center')}>
      <Icon className={cn(iconSize, 'text-primary')} />
    </div>
  );
}

function CoachingRow({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', color)} />
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}: </span>
        {value}
      </p>
    </div>
  );
}

function ModeCard({ icon: Icon, title, description, onClick }: {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/60 bg-card hover:bg-accent/50 transition-colors text-center"
    >
      <Icon className="h-5 w-5 text-primary" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-[10px] text-muted-foreground">{description}</p>
    </button>
  );
}
