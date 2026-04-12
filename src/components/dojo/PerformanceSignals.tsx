import { Card, CardContent } from '@/components/ui/card';
import {
  BarChart3, TrendingUp, TrendingDown, AlertTriangle, Target, Brain,
  CheckCircle2, ArrowUpRight, XCircle, Shield, Zap, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import type { SkillStat } from '@/lib/dojo/scenarios';
import type { CoachingInsights } from '@/lib/dojo/types';
import type { SkillProfile, ProgressSignal } from '@/lib/dojo/skillMemory';
import type { CapabilityProfile } from '@/lib/dojo/v4/capabilityModel';

interface PerformanceSignalsProps {
  skillStats: SkillStat[];
  coachingInsights: CoachingInsights | null;
  skillProfiles?: SkillProfile[] | null;
  progressSignals?: ProgressSignal[] | null;
  capabilityProfiles?: CapabilityProfile[] | null;
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
  capabilityProfiles,
}: PerformanceSignalsProps) {
  if (skillStats.length === 0 && !coachingInsights && !progressSignals?.length) return null;

  const activeCapabilities = capabilityProfiles?.filter(c => c.firstAttemptStrength > 0) ?? [];

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

      {/* V4 Capability section */}
      {activeCapabilities.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Capability
          </p>
          <div className="space-y-1.5">
            {activeCapabilities.map(cap => {
              const readinessColor = cap.pressureReadiness === 'ready' ? 'text-green-500'
                : cap.pressureReadiness === 'building' ? 'text-amber-500'
                : 'text-red-500';
              const readinessBg = cap.pressureReadiness === 'ready' ? 'bg-green-500/10 border-green-500/20'
                : cap.pressureReadiness === 'building' ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-red-500/10 border-red-500/20';
              const readinessLabel = cap.pressureReadiness === 'ready' ? '● Ready'
                : cap.pressureReadiness === 'building' ? '◐ Building'
                : '○ Low';
              return (
                <div key={cap.skill} className="px-2.5 py-2.5 rounded-md border border-border/40 bg-muted/30 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">{cap.label}</p>
                    <Badge variant="outline" className={cn('text-[9px] h-4 px-1.5', readinessBg, readinessColor)}>
                      {readinessLabel}
                    </Badge>
                  </div>
                  {/* Metrics row */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Consistency</span>
                      <span className="font-medium text-foreground">{cap.consistency || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">1st Attempt</span>
                      <span className="font-medium text-foreground">{cap.firstAttemptStrength || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground"><Zap className="h-2.5 w-2.5 inline mr-0.5" />Pressure</span>
                      <span className="font-medium text-foreground">{cap.pressureScore != null ? cap.pressureScore : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Recovery</span>
                      <span className="font-medium text-foreground">{cap.recoveryRate != null ? `+${cap.recoveryRate}` : '—'}</span>
                    </div>
                  </div>
                  {/* Summary line */}
                  <p className="text-[10px] text-muted-foreground italic leading-snug">{cap.summary}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
