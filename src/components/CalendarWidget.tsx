import { Calendar, RefreshCw, Clock, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useCalendarEvents, useSyncCalendar, useAutoSyncCalendar } from '@/hooks/useCalendarEvents';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { cn } from '@/lib/utils';

const TIMEZONE = 'America/New_York';

export function CalendarWidget() {
  const { data: events, isLoading } = useCalendarEvents();
  const syncMutation = useSyncCalendar();
  useAutoSyncCalendar();

  const formatEventTime = (startTime: string, allDay: boolean) => {
    const utcDate = parseISO(startTime);
    const estDate = toZonedTime(utcDate, TIMEZONE);
    
    // For day comparison, we need EST date
    const today = toZonedTime(new Date(), TIMEZONE);
    const isSameDay = estDate.toDateString() === today.toDateString();
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrowDay = estDate.toDateString() === tomorrow.toDateString();
    
    if (allDay) {
      if (isSameDay) return 'Today (All Day)';
      if (isTomorrowDay) return 'Tomorrow (All Day)';
      return format(estDate, 'EEE, MMM d') + ' (All Day)';
    }
    
    if (isSameDay) return `Today, ${format(estDate, 'h:mm a')}`;
    if (isTomorrowDay) return `Tomorrow, ${format(estDate, 'h:mm a')}`;
    return format(estDate, 'EEE, MMM d, h:mm a');
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
