import { useState, useEffect } from 'react';
import { TrendingUp, UserPlus, Phone, Mail, Calendar, Target, Lightbulb, ArrowRight, Zap, ChevronDown } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useWeekToDateMetrics } from '@/hooks/useGoodDayMetrics';
import { cn } from '@/lib/utils';
import { DRIVER_TAG_META, DEFAULT_DRIVER_TARGETS, type DriverTag } from './constants';

export function MomentumHeader({ workstreamFilter }: { workstreamFilter: 'pg' | 'renewals' | 'all' }) {
  const { currentDay, initializeToday } = useStore();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { initializeToday(); }, [initializeToday]);

  const isPG = workstreamFilter !== 'renewals';
  const pointsToday = currentDay?.scores?.dailyScore ?? 0;
  const hasCheckIn = currentDay && (currentDay.scores?.dailyScore ?? 0) > 0;

  const todayActuals = {
    prospectsAdded: currentDay?.rawInputs?.prospectsAddedToCadence ?? 0,
    conversations: currentDay?.rawInputs?.coldCallsWithConversations ?? 0,
    managerPlusMessages: currentDay?.rawInputs?.emailsInMailsToManager ?? 0,
    meetingsSet: currentDay?.rawInputs?.initialMeetingsSet ?? 0,
    oppsCreated: currentDay?.rawInputs?.opportunitiesCreated ?? 0,
    pd: currentDay?.rawInputs?.personalDevelopment ?? 0,
  };

  const drivers = isPG ? [
    { key: 'prospectsAdded', label: 'Prospects', actual: todayActuals.prospectsAdded, target: DEFAULT_DRIVER_TARGETS.prospectsAdded, icon: UserPlus, action: 'quick-log' },
    { key: 'conversations', label: 'Convos', actual: todayActuals.conversations, target: DEFAULT_DRIVER_TARGETS.conversations, icon: Phone, action: 'power-hour' },
    { key: 'managerPlusMessages', label: 'Mgr+', actual: todayActuals.managerPlusMessages, target: DEFAULT_DRIVER_TARGETS.managerPlusMessages, icon: Mail, action: 'quick-log' },
    { key: 'meetingsSet', label: 'Mtgs', actual: todayActuals.meetingsSet, target: DEFAULT_DRIVER_TARGETS.meetingsSet, icon: Calendar, action: 'quick-log' },
    { key: 'oppsCreated', label: 'Opps', actual: todayActuals.oppsCreated, target: DEFAULT_DRIVER_TARGETS.oppsCreated, icon: Target, action: 'add-opp' },
  ] : [
    { key: 'conversations', label: 'Convos', actual: todayActuals.conversations, target: DEFAULT_DRIVER_TARGETS.conversations, icon: Phone, action: 'power-hour' },
    { key: 'meetingsSet', label: 'Mtgs', actual: todayActuals.meetingsSet, target: DEFAULT_DRIVER_TARGETS.meetingsSet, icon: Calendar, action: 'quick-log' },
  ];

  const triggerAction = (action: string) => {
    if (action === 'quick-log' || action === 'power-hour') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    } else if (action === 'add-opp') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    }
  };

  const gaps = isPG ? [
    { tag: 'cadence' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.prospectsAdded - todayActuals.prospectsAdded), action: 'quick-log' },
    { tag: 'calls' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.conversations - todayActuals.conversations), action: 'power-hour' },
    { tag: 'manager-outreach' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.managerPlusMessages - todayActuals.managerPlusMessages), action: 'quick-log' },
    { tag: 'meeting-set' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.meetingsSet - todayActuals.meetingsSet), action: 'quick-log' },
    { tag: 'opp-creation' as DriverTag, gap: Math.max(0, DEFAULT_DRIVER_TARGETS.oppsCreated - todayActuals.oppsCreated), action: 'add-opp' },
  ].filter(g => g.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3) : [];

  const pointsColor = pointsToday >= 8 ? 'text-status-green' : pointsToday >= 5 ? 'text-status-yellow' : 'text-foreground';
  const metCount = drivers.filter(d => d.target > 0 ? d.actual >= d.target : d.actual > 0).length;

  return (
    <div className="rounded-lg border border-border bg-card mb-4">
      {/* Slim always-visible bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left"
      >
        <TrendingUp className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-semibold">{isPG ? 'Momentum' : 'Renewals'}</span>

        {/* Inline mini chips */}
        <div className="flex items-center gap-1 flex-1 overflow-hidden">
          {drivers.map(d => {
            const met = d.target > 0 ? d.actual >= d.target : d.actual > 0;
            return (
              <span
                key={d.key}
                className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded",
                  met ? "bg-status-green/15 text-status-green" : "bg-muted/60 text-muted-foreground"
                )}
              >
                {d.actual}{d.target > 0 ? `/${d.target}` : ''}
              </span>
            );
          })}
        </div>

        <span className={cn("text-sm font-bold shrink-0", pointsColor)}>{pointsToday}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">/ 8</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", expanded && "rotate-180")} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/50 pt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {drivers.map(d => {
              const met = d.target > 0 ? d.actual >= d.target : d.actual > 0;
              const Icon = d.icon;
              return (
                <button
                  key={d.key}
                  onClick={() => !met && triggerAction(d.action)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium transition-all",
                    met
                      ? "bg-status-green/10 text-status-green border-status-green/20"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-primary/10 hover:border-primary/30 hover:text-primary cursor-pointer"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {d.label} <span className="font-bold">{d.actual}</span>
                  {d.target > 0 && <span className="opacity-60">/{d.target}</span>}
                </button>
              );
            })}
            {isPG && (
              <span className={cn(
                "flex items-center gap-1 px-1.5 py-1 rounded-full border text-[10px] font-medium",
                todayActuals.pd ? "bg-status-green/10 text-status-green border-status-green/20" : "bg-muted/30 text-muted-foreground/60 border-border/50"
              )}>
                <Lightbulb className="h-2.5 w-2.5" /> PD {todayActuals.pd ? '✓' : '—'}
              </span>
            )}
          </div>

          {!hasCheckIn && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-1.5">
              <Zap className="h-3 w-3 text-primary" />
              <span>No activity logged.</span>
              <button onClick={() => triggerAction('quick-log')} className="text-primary font-medium hover:underline">Quick Log →</button>
            </div>
          )}

          {isPG && pointsToday < 8 && gaps.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs bg-primary/5 rounded-lg px-3 py-1.5 border border-primary/10">
              <ArrowRight className="h-3 w-3 text-primary shrink-0" />
              <span className="text-muted-foreground text-[11px]">Focus:</span>
              {gaps.map(g => {
                const meta = DRIVER_TAG_META[g.tag];
                const Icon = meta.icon;
                return (
                  <button key={g.tag} onClick={() => triggerAction(g.action)}
                    className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[9px] font-medium cursor-pointer hover:opacity-80", meta.color)}>
                    <Icon className="h-2.5 w-2.5" /> {meta.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
