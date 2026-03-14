// Calendar Intelligence Overlay - Analyzes calendar patterns
import { useMemo } from 'react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useStore } from '@/store/useStore';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Users, Clock, TrendingUp, AlertTriangle, Zap } from 'lucide-react';
import { parseISO, format, getHours, differenceInMinutes, startOfWeek, endOfWeek, isWithinInterval, isValid } from 'date-fns';
import { cn } from '@/lib/utils';

interface CalendarInsight {
  icon: typeof Calendar;
  label: string;
  value: string;
  detail?: string;
  status: 'good' | 'warning' | 'neutral';
}

export function CalendarIntelligence() {
  const { data: events } = useCalendarEvents();
  const { accounts } = useStore();

  const insights = useMemo((): CalendarInsight[] => {
    if (!events || events.length === 0) return [];

    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

    // Filter to this week's events
    const thisWeekEvents = events.filter(e => {
      const start = parseISO(e.start_time);
      return isWithinInterval(start, { start: weekStart, end: weekEnd });
    });

    const nonAllDay = thisWeekEvents.filter(e => !e.all_day && e.end_time);

    // Total meeting minutes
    const totalMeetingMinutes = nonAllDay.reduce((sum, e) => {
      if (!e.end_time) return sum;
      return sum + Math.max(0, differenceInMinutes(parseISO(e.end_time), parseISO(e.start_time)));
    }, 0);

    const meetingHours = Math.round(totalMeetingMinutes / 60 * 10) / 10;

    // Internal vs External meetings
    const accountNamesLower = accounts.map(a => a.name.toLowerCase());
    let externalCount = 0;
    let internalCount = 0;

    nonAllDay.forEach(e => {
      const titleLower = e.title.toLowerCase();
      const isExternal = accountNamesLower.some(name =>
        name.length > 3 && titleLower.includes(name)
      ) || titleLower.includes('demo') || titleLower.includes('discovery') || titleLower.includes('review');

      if (isExternal) externalCount++;
      else internalCount++;
    });

    // Morning vs afternoon distribution
    let morningMeetings = 0;
    let afternoonMeetings = 0;
    nonAllDay.forEach(e => {
      const hour = getHours(parseISO(e.start_time));
      if (hour < 12) morningMeetings++;
      else afternoonMeetings++;
    });

    // Find longest meeting-free block (simplified)
    const result: CalendarInsight[] = [];

    result.push({
      icon: Clock,
      label: 'Meeting Load',
      value: `${meetingHours}h this week`,
      detail: `${nonAllDay.length} meetings scheduled`,
      status: meetingHours > 20 ? 'warning' : meetingHours > 10 ? 'neutral' : 'good',
    });

    const externalPct = nonAllDay.length > 0 ? Math.round((externalCount / nonAllDay.length) * 100) : 0;
    result.push({
      icon: Users,
      label: 'External vs Internal',
      value: `${externalCount} external · ${internalCount} internal`,
      detail: externalPct > 50 ? 'Good customer-facing ratio' : 'Consider more customer time',
      status: externalPct >= 40 ? 'good' : 'warning',
    });

    result.push({
      icon: TrendingUp,
      label: 'Time Distribution',
      value: `${morningMeetings} AM · ${afternoonMeetings} PM`,
      detail: morningMeetings > afternoonMeetings
        ? 'Heavy mornings — protect prospecting blocks'
        : 'Afternoons are busier — use mornings for deep work',
      status: 'neutral',
    });

    // Free hours estimate (assuming 8h workday, 5 days)
    const totalWorkMinutes = 5 * 8 * 60;
    const freeMinutes = totalWorkMinutes - totalMeetingMinutes;
    const freeHours = Math.round(freeMinutes / 60 * 10) / 10;
    result.push({
      icon: Zap,
      label: 'Available Focus Time',
      value: `~${Math.max(0, freeHours)}h this week`,
      detail: freeHours < 15 ? 'Very limited — prioritize ruthlessly' : 'Solid block time available',
      status: freeHours < 15 ? 'warning' : 'good',
    });

    return result;
  }, [events, accounts]);

  if (!events || insights.length === 0) {
    return null;
  }

  const STATUS_STYLES = {
    good: 'text-status-green',
    warning: 'text-status-yellow',
    neutral: 'text-muted-foreground',
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-accent flex items-center justify-center">
            <Calendar className="h-4 w-4 text-accent-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Calendar Intelligence</h3>
            <p className="text-[11px] text-muted-foreground">This week's time patterns</p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border/30">
        {insights.map((insight, i) => {
          const Icon = insight.icon;
          return (
            <div key={i} className="px-4 py-3 flex items-start gap-3">
              <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", STATUS_STYLES[insight.status])} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{insight.label}</span>
                  <span className="text-sm font-medium text-foreground">{insight.value}</span>
                </div>
                {insight.detail && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{insight.detail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
