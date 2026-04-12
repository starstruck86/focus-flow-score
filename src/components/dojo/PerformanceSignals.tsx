import { Card, CardContent } from '@/components/ui/card';
import {
  BarChart3, TrendingUp, TrendingDown, AlertTriangle, Target, Brain,
  CheckCircle2, ArrowUpRight, XCircle, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import type { SkillStat } from '@/lib/dojo/scenarios';
import type { CoachingInsights } from '@/lib/dojo/types';
import type { SkillProfile, ProgressSignal } from '@/lib/dojo/skillMemory';

interface PerformanceSignalsProps {
  skillStats: SkillStat[];
  coachingInsights: CoachingInsights | null;
  skillProfiles?: SkillProfile[] | null;
  progressSignals?: ProgressSignal[] | null;
}

const SIGNAL_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  fixed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/5 border-green-500/15' },
  improving: { icon: ArrowUpRight, color: 'text-blue-500', bg: 'bg-blue-500/5 border-blue-500/15' },
  still_breaking: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/15' },
  mastered: { icon: Shield, color: 'text-green-500', bg: 'bg-green-500/5 border-green-500/15' },
  new_issue: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/5 border-amber-500/15' },
};

export function PerformanceSignals({
  skillStats,
  coachingInsights,
  skillProfiles,
  progressSignals,
}: PerformanceSignalsProps) {
  if (skillStats.length === 0 && !coachingInsights && !progressSignals?.length) return null;

  // Use skill profiles for richer bars if available, otherwise fall back to skillStats
  const profilesAvailable = skillProfiles && skillProfiles.some(p => p.totalReps > 0);

  return (
    <div className="space-y-4">
      {/* Progress signals — the V3 coaching memory surface */}
      {progressSignals && progressSignals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5" />
            Progress
          </p>
          <div className="space-y-1.5">
            {progressSignals.map((signal, i) => {
              const config = SIGNAL_CONFIG[signal.type] ?? SIGNAL_CONFIG.new_issue;
              const Icon = config.icon;
              return (
                <div
                  key={`${signal.type}-${signal.skill}-${signal.pattern ?? i}`}
                  className={cn('flex items-start gap-2 px-2.5 py-2 rounded-md border', config.bg)}
                >
                  <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', config.color)} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{signal.label}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{signal.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Skill profile bars — enhanced with trend indicators */}
      {(profilesAvailable || skillStats.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Skill Profile
          </p>
          <div className="space-y-2">
            {profilesAvailable
              ? skillProfiles!
                  .filter(p => p.totalReps > 0)
                  .sort((a, b) => a.recentAvg - b.recentAvg)
                  .map(p => (
                    <SkillBarWithTrend key={p.skill} profile={p} />
                  ))
              : skillStats.map(s => (
                  <div key={s.skill} className="flex items-center gap-3 px-1">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs font-medium truncate">{SKILL_LABELS[s.skill]}</p>
                        <span className="text-xs text-muted-foreground">{s.avgFirstAttempt} avg · {s.count} reps</span>
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
                  </div>
                ))
            }
          </div>
        </div>
      )}

      {/* Coaching signals */}
      {coachingInsights && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            Coaching Signals
          </p>
          <Card className="border-border/60">
            <CardContent className="p-3 space-y-2.5">
              <SignalRow
                icon={AlertTriangle}
                label="You miss most"
                value={coachingInsights.whatYouMissMost}
                color="text-red-500"
              />
              <SignalRow
                icon={TrendingUp}
                label="Improving fastest"
                value={coachingInsights.whatYouImproveFastest}
                color="text-green-500"
              />
              <SignalRow
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
    </div>
  );
}

function SkillBarWithTrend({ profile }: { profile: SkillProfile }) {
  const TrendIcon = profile.trend === 'improving' ? TrendingUp
    : profile.trend === 'declining' ? TrendingDown
    : null;

  const trendColor = profile.trend === 'improving' ? 'text-green-500'
    : profile.trend === 'declining' ? 'text-red-500'
    : 'text-muted-foreground';

  const confidenceLabel = profile.confidence === 'high' ? '● Strong'
    : profile.confidence === 'building' ? '◐ Building'
    : profile.confidence === 'low' ? '○ Needs work'
    : '';

  return (
    <div className="flex items-center gap-3 px-1">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium truncate">{profile.label}</p>
            {TrendIcon && (
              <TrendIcon className={cn('h-3 w-3', trendColor)} />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">{confidenceLabel}</span>
            <span className="text-xs text-muted-foreground">{profile.recentAvg} avg · {profile.totalReps} reps</span>
          </div>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              profile.recentAvg >= 75 ? 'bg-green-500' :
              profile.recentAvg >= 60 ? 'bg-amber-500' : 'bg-red-500'
            )}
            style={{ width: `${Math.min(profile.recentAvg, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SignalRow({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
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
