/**
 * Roleplay Block Card
 *
 * Inline card rendered inside the Daily Game Plan for the daily
 * Dave-led roleplay block. Provides start / skip / reschedule controls.
 */
import { memo, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mic, SkipForward, Clock } from 'lucide-react';
import {
  getRoleplayBlockConfig,
  getTodayRoleplayStatus,
  recordRoleplayBlockEvent,
  getRoleplayStreak,
  buildDaveConfirmationPrompt,
} from '@/lib/dailyRoleplayBlock';
import { todayInAppTz } from '@/lib/timeFormat';
import { useCopilot } from '@/contexts/CopilotContext';

interface RoleplayBlockCardProps {
  blockStartTime: string;
  blockEndTime: string;
  isMissedNoSlot?: boolean;
}

export const RoleplayBlockCard = memo(function RoleplayBlockCard({ blockStartTime, blockEndTime, isMissedNoSlot }: RoleplayBlockCardProps) {
  const today = todayInAppTz();
  const config = getRoleplayBlockConfig();
  const todayStatus = getTodayRoleplayStatus(today);
  const streak = getRoleplayStreak();
  const { ask: askCopilot } = useCopilot();
  const [localStatus, setLocalStatus] = useState(
    isMissedNoSlot ? 'missed_no_slot' : (todayStatus?.status || 'scheduled')
  );

  const handleStart = useCallback(() => {
    recordRoleplayBlockEvent({
      date: today,
      status: 'started',
      scenarioType: config.defaultScenarioType,
      persona: config.defaultPersona,
      industry: config.defaultIndustry,
      startedAt: new Date().toISOString(),
    });
    setLocalStatus('started');

    // Launch Dave with the confirmation prompt
    const prompt = buildDaveConfirmationPrompt(config);
    askCopilot(prompt, 'deal-strategy');
  }, [today, config, askCopilot]);

  const handleSkip = useCallback(() => {
    recordRoleplayBlockEvent({
      date: today,
      status: 'skipped',
      scenarioType: config.defaultScenarioType,
      persona: config.defaultPersona,
      industry: config.defaultIndustry,
    });
    setLocalStatus('skipped');
  }, [today, config]);

  if (localStatus === 'completed') {
    return (
      <div className="mt-2 py-2 px-3 rounded-md bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-2 text-[11px] text-primary">
          <Mic className="h-3.5 w-3.5" />
          <span className="font-medium">Roleplay completed</span>
          {streak > 0 && (
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-auto">
              🔥 {streak + 1} day streak
            </Badge>
          )}
        </div>
      </div>
    );
  }

  if (localStatus === 'skipped') {
    return (
      <div className="mt-2 py-2 px-3 rounded-md bg-muted/30 border border-border/30">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <SkipForward className="h-3.5 w-3.5" />
          <span>Roleplay skipped</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] ml-auto"
            onClick={handleStart}
          >
            Undo
          </Button>
        </div>
      </div>
    );
  }

  if (localStatus === 'missed_no_slot') {
    return (
      <div className="mt-2 py-2 px-3 rounded-md bg-muted/30 border border-border/30">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>No morning slot available for roleplay today</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 py-2.5 px-3 rounded-md bg-orange-500/5 border border-orange-500/20">
      <div className="flex items-center gap-2 mb-1.5">
        <Mic className="h-3.5 w-3.5 text-orange-500" />
        <span className="text-[11px] font-medium text-foreground">Dave Roleplay</span>
        <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-orange-500/30 text-orange-600 dark:text-orange-400">
          {config.defaultScenarioType.replace('_', ' ')}
        </Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">
          <Clock className="h-3 w-3 inline mr-0.5" />
          {config.durationMinutes}m
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">
        {config.defaultPersona} · {config.defaultIndustry}
      </p>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-6 text-[10px] px-3 gap-1 bg-orange-500 hover:bg-orange-600 text-white"
          onClick={handleStart}
        >
          <Mic className="h-3 w-3" /> Start with Dave
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2 text-muted-foreground"
          onClick={handleSkip}
        >
          Skip
        </Button>
      </div>
      {streak > 0 && (
        <p className="text-[9px] text-muted-foreground mt-1.5">🔥 {streak} day streak</p>
      )}
    </div>
  );
});
