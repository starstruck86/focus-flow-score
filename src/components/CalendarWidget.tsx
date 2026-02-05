import { Calendar, RefreshCw, Clock, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useCalendarEvents, useSyncCalendar } from '@/hooks/useCalendarEvents';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

export function CalendarWidget() {
  const { data: events, isLoading } = useCalendarEvents();
  const syncMutation = useSyncCalendar();

  const formatEventTime = (startTime: string, allDay: boolean) => {
    const date = parseISO(startTime);
    
    if (allDay) {
      if (isToday(date)) return 'Today (All Day)';
      if (isTomorrow(date)) return 'Tomorrow (All Day)';
      return format(date, 'EEE, MMM d') + ' (All Day)';
    }
    
    if (isToday(date)) return `Today, ${format(date, 'h:mm a')}`;
    if (isTomorrow(date)) return `Tomorrow, ${format(date, 'h:mm a')}`;
    return format(date, 'EEE, MMM d, h:mm a');
  };

  return (
    <motion.div
      className="metric-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold">Upcoming Meetings</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <RefreshCw className={cn(
            "h-4 w-4",
            syncMutation.isPending && "animate-spin"
          )} />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-1" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : events && events.length > 0 ? (
        <div className="space-y-3">
          {events.slice(0, 5).map((event) => (
            <div
              key={event.id}
              className="p-3 rounded-lg bg-muted/50 border border-border/50"
            >
              <p className="font-medium text-sm truncate">{event.title}</p>
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{formatEventTime(event.start_time, event.all_day)}</span>
              </div>
              {event.location && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span className="truncate">{event.location}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-muted-foreground text-sm">
          <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No upcoming meetings</p>
          <Button
            variant="link"
            size="sm"
            className="mt-2"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            Sync Calendar
          </Button>
        </div>
      )}
    </motion.div>
  );
}
