import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Flame, Play, Swords, Target, MessageSquare, Zap } from 'lucide-react';
import { getAutopilotRecommendation, SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import { useDojoStats } from '@/lib/dojo/useDojoStreak';

export default function Dojo() {
  const navigate = useNavigate();
  const { data: stats } = useDojoStats();

  const recommendation = useMemo(
    () => getAutopilotRecommendation(stats?.skillBreakdown),
    [stats?.skillBreakdown]
  );

  const startAutopilot = () => {
    navigate('/dojo/session', { state: { scenario: recommendation.scenario, mode: 'autopilot' } });
  };

  const startCustom = (skill: SkillFocus) => {
    navigate('/dojo/session', { state: { skillFocus: skill, mode: 'custom' } });
  };

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

        {/* ── Custom Session ── */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Custom Session
          </p>
          <div className="grid grid-cols-1 gap-2">
            {(['objection_handling', 'discovery', 'executive_response'] as SkillFocus[]).map(skill => (
              <button
                key={skill}
                onClick={() => startCustom(skill)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card hover:bg-accent/50 transition-colors text-left"
              >
                <SkillIcon skill={skill} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{SKILL_LABELS[skill]}</p>
                  <p className="text-xs text-muted-foreground">5 min drill</p>
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

function SkillIcon({ skill }: { skill: SkillFocus }) {
  const icons: Record<SkillFocus, React.ElementType> = {
    objection_handling: Swords,
    discovery: Target,
    executive_response: MessageSquare,
  };
  const Icon = icons[skill];
  return (
    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
      <Icon className="h-4 w-4 text-primary" />
    </div>
  );
}
