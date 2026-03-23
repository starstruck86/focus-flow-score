// Today's Agenda - Unified timeline of meetings + tasks
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, MapPin, CheckSquare, Building2, Video, AlertTriangle, Zap } from 'lucide-react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useStore } from '@/store/useStore';
import { format, differenceInMinutes, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { toAppTime, APP_TIMEZONE } from '@/lib/timeFormat';
import { Badge } from '@/components/ui/badge';
import type { Task } from '@/types';

interface AgendaItem {
  type: 'meeting' | 'task';
  time: Date | null; // null = unscheduled task
  sortKey: number;
  id: string;
  title: string;
  subtitle?: string;
  location?: string;
  allDay?: boolean;
  matchedAccount?: string;
  matchedAccountId?: string;
  isOverdue?: boolean;
  priority?: string;
  status?: string;
  minutesUntil?: number;
  needsPrep?: boolean;
}

export function TodayAgenda() {
  const { data: events, isLoading: eventsLoading } = useCalendarEvents();
  const { tasks, accounts } = useStore();
  
  const now = toZonedTime(new Date(), TIMEZONE);
  const todayStr = format(now, 'yyyy-MM-dd');

  const agenda = useMemo(() => {
    const items: AgendaItem[] = [];

    // Add today's calendar events
    if (events) {
      events.forEach(event => {
        const utcDate = parseISO(event.start_time);
        if (!isValid(utcDate)) return;

        const estDate = toZonedTime(utcDate, TIMEZONE);
        if (!isValid(estDate)) return;

        const eventDateStr = format(estDate, 'yyyy-MM-dd');
        
        if (eventDateStr !== todayStr) return;

        // Try to match event title to an account
        const titleLower = event.title.toLowerCase();
        const matchedAccount = accounts.find(a => 
          titleLower.includes(a.name.toLowerCase()) ||
          a.name.toLowerCase().split(' ').some(word => word.length > 3 && titleLower.includes(word))
        );

        const minutesUntil = differenceInMinutes(estDate, now);
        
        // Check if there are prep tasks for this account
        const hasPrepTask = matchedAccount && tasks.some(t => 
          t.linkedAccountId === matchedAccount.id && 
          t.status !== 'done' && t.status !== 'dropped' &&
          (t.title.toLowerCase().includes('prep') || t.title.toLowerCase().includes('research'))
        );

        items.push({
          type: 'meeting',
          time: estDate,
          sortKey: event.all_day ? -1 : estDate.getTime(),
          id: event.id,
          title: event.title,
          location: event.location || undefined,
          allDay: event.all_day,
          matchedAccount: matchedAccount?.name,
          matchedAccountId: matchedAccount?.id,
          minutesUntil,
          needsPrep: matchedAccount && !hasPrepTask && minutesUntil > 0 && minutesUntil < 120,
        });
      });
    }

    // Add today's tasks (due today or overdue)
    tasks.forEach(task => {
      if (task.status === 'done' || task.status === 'dropped') return;
      if (!task.dueDate) return;
      
      const isToday = task.dueDate === todayStr;
      const isOverdue = task.dueDate < todayStr;
      
      if (!isToday && !isOverdue) return;

      const accountName = task.linkedAccountId 
        ? accounts.find(a => a.id === task.linkedAccountId)?.name 
        : undefined;

      items.push({
        type: 'task',
        time: null,
        sortKey: isOverdue ? -2 : 999999999,
        id: task.id,
        title: task.title,
        subtitle: accountName,
        isOverdue,
        priority: task.priority,
        status: task.status,
      });
    });

    return items.sort((a, b) => a.sortKey - b.sortKey);
  }, [events, tasks, accounts, todayStr, now]);

  const meetingCount = agenda.filter(i => i.type === 'meeting').length;
  const taskCount = agenda.filter(i => i.type === 'task').length;
  const nextMeeting = agenda.find(i => i.type === 'meeting' && i.minutesUntil && i.minutesUntil > 0);

  if (eventsLoading) {
    return (
      <motion.div className="metric-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold">Today's Agenda</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-1" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div className="metric-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold">Today's Agenda</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {meetingCount > 0 && (
            <span className="flex items-center gap-1">
              <Video className="h-3 w-3" /> {meetingCount} meeting{meetingCount !== 1 ? 's' : ''}
            </span>
          )}
          {taskCount > 0 && (
            <span className="flex items-center gap-1">
              <CheckSquare className="h-3 w-3" /> {taskCount} task{taskCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Next meeting countdown */}
      {nextMeeting && nextMeeting.minutesUntil !== undefined && nextMeeting.minutesUntil <= 60 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 mb-3 text-xs">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-primary">
            Next: {nextMeeting.title} in {nextMeeting.minutesUntil} min
          </span>
          {nextMeeting.matchedAccount && (
            <Badge variant="outline" className="text-[10px] h-4 ml-auto">
              <Building2 className="h-2.5 w-2.5 mr-1" />
              {nextMeeting.matchedAccount}
            </Badge>
          )}
        </div>
      )}

      {agenda.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">
          <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No meetings or due tasks today</p>
        </div>
      ) : (
        <div className="space-y-1">
          {agenda.map((item, idx) => (
            <div
              key={`${item.type}-${item.id}`}
              className={cn(
                "flex items-start gap-3 px-3 py-2 rounded-lg transition-colors",
                item.type === 'meeting' 
                  ? "bg-muted/30 hover:bg-muted/50" 
                  : item.isOverdue 
                    ? "bg-destructive/5 hover:bg-destructive/10 border border-destructive/20" 
                    : "hover:bg-muted/30"
              )}
            >
              {/* Time column */}
              <div className="w-16 shrink-0 text-xs text-muted-foreground pt-0.5">
                {item.type === 'meeting' ? (
                  item.allDay ? (
                    <span className="font-medium">All Day</span>
                  ) : item.time ? (
                    <span className={cn(
                      "font-medium",
                      item.minutesUntil !== undefined && item.minutesUntil >= 0 && item.minutesUntil <= 30 && "text-primary font-bold"
                    )}>
                      {format(item.time, 'h:mm a')}
                    </span>
                  ) : null
                ) : (
                  <span className={cn(item.isOverdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                    {item.isOverdue ? 'Overdue' : 'Today'}
                  </span>
                )}
              </div>

              {/* Icon */}
              <div className={cn(
                "mt-0.5 shrink-0",
                item.type === 'meeting' ? "text-primary" : item.isOverdue ? "text-destructive" : "text-muted-foreground"
              )}>
                {item.type === 'meeting' ? (
                  <Video className="h-3.5 w-3.5" />
                ) : (
                  <CheckSquare className="h-3.5 w-3.5" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {item.matchedAccount && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Building2 className="h-3 w-3" />
                      {item.matchedAccount}
                    </span>
                  )}
                  {item.subtitle && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Building2 className="h-3 w-3" />
                      {item.subtitle}
                    </span>
                  )}
                  {item.location && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate max-w-[150px]">{item.location}</span>
                    </span>
                  )}
                  {item.priority && (
                    <Badge className={cn("text-[9px] h-4 px-1", 
                      item.priority === 'P0' ? "bg-destructive text-destructive-foreground" :
                      item.priority === 'P1' ? "bg-destructive/70 text-destructive-foreground" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {item.priority}
                    </Badge>
                  )}
                </div>
                {/* Prep warning */}
                {item.needsPrep && (
                  <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    <span>No prep task found for this account</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
