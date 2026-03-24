/**
 * WeeklyQueueOverview — shows all 15 weekly research queue accounts
 * grouped by day (Mon–Fri, 3 each) with state badges and progress.
 */
import { memo, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, ArrowRight, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWeeklyResearchQueue, type AccountState, type QueueAccount, type WeeklyAssignments } from '@/hooks/useWeeklyResearchQueue';

const DAY_LABELS: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
};

function StateBadge({ state }: { state: AccountState }) {
  switch (state) {
    case 'added_to_cadence':
      return (
        <Badge className="gap-1 bg-primary/15 text-primary text-[10px] border-0">
          <CheckCircle2 className="h-3 w-3" /> In Cadence
        </Badge>
      );
    case 'researched':
      return (
        <Badge className="gap-1 bg-status-green/15 text-status-green text-[10px] border-0">
          <CheckCircle2 className="h-3 w-3" /> Researched
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground text-[10px]">
          <Circle className="h-3 w-3" /> Not Started
        </Badge>
      );
  }
}

function DayRow({ dayKey, label, accounts, isToday, onAdvance }: {
  dayKey: string;
  label: string;
  accounts: QueueAccount[];
  isToday: boolean;
  onAdvance: (day: keyof WeeklyAssignments, accountId: string, newState: 'researched' | 'added_to_cadence') => void;
}) {
  const completed = accounts.filter(a => a.state !== 'not_started').length;

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2",
      isToday ? "border-primary/40 bg-primary/5" : "border-border bg-card"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-semibold", isToday && "text-primary")}>{label}</span>
          {isToday && <Badge className="text-[9px] bg-primary/20 text-primary border-0">Today</Badge>}
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {completed}/{accounts.length}
        </span>
      </div>

      {accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No accounts assigned</p>
      ) : (
        <div className="space-y-1.5">
          {accounts.map(account => (
            <div key={account.id} className="flex items-center justify-between gap-2 group">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-sm truncate">{account.name}</span>
                {account.tier && (
                  <span className={cn(
                    "text-[9px] font-bold shrink-0",
                    account.tier === 'A' ? 'text-status-green' : account.tier === 'B' ? 'text-status-yellow' : 'text-muted-foreground'
                  )}>
                    {account.tier}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <StateBadge state={account.state} />
                {account.state === 'not_started' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onAdvance(dayKey as keyof WeeklyAssignments, account.id, 'researched')}
                    title="Mark as researched"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
                {account.state === 'researched' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onAdvance(dayKey as keyof WeeklyAssignments, account.id, 'added_to_cadence')}
                    title="Mark as added to cadence"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const WeeklyQueueOverview = memo(function WeeklyQueueOverview() {
  const {
    assignments,
    todayKey,
    loading,
    isEmpty,
    weeklyResearched,
    weeklyAddedToCadence,
    weeklyTotal,
    generateQueue,
    advanceState,
    DAY_KEYS,
    weekStart,
  } = useWeeklyResearchQueue();

  const progress = useMemo(() => {
    const completed = weeklyResearched; // researched + added_to_cadence
    return weeklyTotal > 0 ? Math.round((completed / weeklyTotal) * 100) : 0;
  }, [weeklyResearched, weeklyTotal]);

  if (loading) {
    return (
      <div className="metric-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading weekly queue...
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="metric-card p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">No weekly research queue generated yet.</p>
        <Button onClick={generateQueue} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Generate Queue (15 Accounts)
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">
            Weekly Research Queue
          </span>
          <span className="text-xs text-muted-foreground">
            Week of {weekStart}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Progress:</span>
            <span className="font-mono font-bold">{weeklyResearched}/{weeklyTotal}</span>
            <span className="text-muted-foreground">({progress}%)</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">In Cadence:</span>
            <span className="font-mono font-bold text-primary">{weeklyAddedToCadence}</span>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={generateQueue}>
            <RefreshCw className="h-3 w-3" /> Regenerate
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500 rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Day cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {DAY_KEYS.map((day: string) => (
          <DayRow
            key={day}
            dayKey={day}
            label={DAY_LABELS[day] || day}
            accounts={assignments[day as keyof WeeklyAssignments] || []}
            isToday={todayKey === day}
            onAdvance={advanceState}
          />
        ))}
      </div>
    </div>
  );
});
