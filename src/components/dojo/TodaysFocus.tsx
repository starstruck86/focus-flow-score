import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Play, Swords, TrendingUp, TrendingDown, Flame, Target, Zap, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import type { SmartAutopilotResult } from '@/lib/dojo/smartAutopilot';
import type { SkillStat } from '@/lib/dojo/scenarios';
import type { LessonContext } from '@/lib/learning/practiceMapping';
import type { DailyFocus } from '@/lib/dojo/skillMemory';

interface TodaysFocusProps {
  recommendation: SmartAutopilotResult;
  skillStats: SkillStat[];
  streak: number;
  lastScore: number | null;
  bestScore: number | null;
  onStartAutopilot: () => void;
  lessonContext?: LessonContext | null;
  dailyFocus?: DailyFocus | null;
  hideScenarioPreview?: boolean;
  assignmentCompleted?: boolean;
}

export function TodaysFocus({
  recommendation,
  skillStats,
  streak,
  lastScore,
  bestScore,
  onStartAutopilot,
  lessonContext,
  dailyFocus,
  hideScenarioPreview,
  assignmentCompleted,
}: TodaysFocusProps) {
  const weakestSkill = skillStats.length > 0 ? skillStats[0] : null;
  const strongestSkill = skillStats.length > 0 ? skillStats[skillStats.length - 1] : null;

  const navigate = useNavigate();

  // Use daily focus message if available, otherwise fall back to recommendation
  const daveMessage = dailyFocus?.daveMessage ?? recommendation.daveMessage;

  return (
    <div className="space-y-4">
      {/* Lesson-linked override */}
      {lessonContext ? (
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">Based on your last lesson</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You just finished <span className="font-medium text-foreground">{lessonContext.lessonTitle}</span>. 
              Jump into {lessonContext.modeLabel} to lock it in.
            </p>
          </div>
        </div>
      ) : (
        /* Dave's assignment — skill-memory-aware */
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Swords className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">Dave</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {daveMessage}
            </p>
            {/* Daily focus skills */}
            {dailyFocus && (
              <div className="flex gap-1.5 pt-1">
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                  {SKILL_LABELS[dailyFocus.primary]}
                </Badge>
                {dailyFocus.secondary && (
                  <Badge variant="outline" className="text-[10px] border-muted-foreground/30">
                    {SKILL_LABELS[dailyFocus.secondary]}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick insight chips */}
      {(strongestSkill || weakestSkill) && (
        <div className="flex gap-2">
          {strongestSkill && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-green-500/5 border border-green-500/15 flex-1 min-w-0">
              <TrendingUp className="h-3 w-3 text-green-500 shrink-0" />
              <p className="text-[11px] text-muted-foreground truncate">
                <span className="font-medium text-foreground">Strong: </span>
                {SKILL_LABELS[strongestSkill.skill]}
              </p>
            </div>
          )}
          {weakestSkill && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-500/5 border border-red-500/15 flex-1 min-w-0">
              <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />
              <p className="text-[11px] text-muted-foreground truncate">
                <span className="font-medium text-foreground">Weak: </span>
                {SKILL_LABELS[weakestSkill.skill]}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Start CTA */}
      {lessonContext ? (
        <Button
          size="lg"
          className="w-full h-14 text-base font-semibold gap-2"
          onClick={() => {
            if (lessonContext.recommendedMode === 'drill' || lessonContext.recommendedMode === 'roleplay') {
              navigate('/dojo/session', {
                state: {
                  skillFocus: lessonContext.skillFocus,
                  mode: lessonContext.recommendedMode === 'drill' ? 'custom' : 'roleplay',
                  sessionType: lessonContext.recommendedMode,
                  fromLessonId: lessonContext.lessonId,
                },
              });
            }
          }}
        >
          <Play className="h-5 w-5" />
          Start {lessonContext.modeLabel}
        </Button>
      ) : (
        <Button
          size="lg"
          className="w-full h-14 text-base font-semibold gap-2"
          onClick={onStartAutopilot}
        >
          <Play className="h-5 w-5" />
          {assignmentCompleted ? 'Do Another Rep' : 'Start Today\'s Rep'}
        </Button>
      )}

      {/* Scenario preview — hidden when assignment card is already showing */}
      {!hideScenarioPreview && (
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
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={Flame} label="Streak" value={`${streak}d`} color="text-orange-500" />
        <StatCard icon={Target} label="Last Score" value={lastScore != null ? `${lastScore}` : '—'} color="text-blue-500" />
        <StatCard icon={Zap} label="Best" value={bestScore ? `${bestScore}` : '—'} color="text-yellow-500" />
      </div>
    </div>
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
