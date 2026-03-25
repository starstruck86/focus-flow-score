// Meeting Prep Intelligence - Surfaces accounts with upcoming meetings that need prep
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Building2, Clock, Plus, CheckCircle2 } from 'lucide-react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useStore } from '@/store/useStore';
import { format, parseISO, differenceInMinutes, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { matchAccountToEvent } from '@/lib/accountMatcher';

import { APP_TIMEZONE } from '@/lib/timeFormat';
const TIMEZONE = APP_TIMEZONE;

interface PrepItem {
  accountId: string;
  accountName: string;
  meetingTitle: string;
  meetingTime: Date;
  minutesUntil: number;
  hasPrepTask: boolean;
  hasRecentTouch: boolean;
  lastTouchDate?: string;
}

export function MeetingPrepCard() {
  const { data: events } = useCalendarEvents();
  const { tasks, accounts, addTask } = useStore();
  
  const now = toZonedTime(new Date(), TIMEZONE);
  const todayStr = format(now, 'yyyy-MM-dd');

  const prepItems = useMemo(() => {
    if (!events) return [];
    
    const items: PrepItem[] = [];
    
    events.forEach(event => {
      if (event.all_day) return;
      
      const utcDate = parseISO(event.start_time);
      if (!isValid(utcDate)) return;

      const estDate = toZonedTime(utcDate, TIMEZONE);
      if (!isValid(estDate)) return;

      const eventDateStr = format(estDate, 'yyyy-MM-dd');
      
      // Only today + tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');
      
      if (eventDateStr !== todayStr && eventDateStr !== tomorrowStr) return;

      const matchedAccount = matchAccountToEvent(event.title, accounts);
      if (!matchedAccount) return;

      const minutesUntil = differenceInMinutes(estDate, now);
      if (minutesUntil < -30) return; // Skip past meetings

      const hasPrepTask = tasks.some(t => 
        t.linkedAccountId === matchedAccount.id && 
        t.status !== 'done' && t.status !== 'dropped' &&
        (t.title.toLowerCase().includes('prep') || t.title.toLowerCase().includes('research') || t.title.toLowerCase().includes('review'))
      );

      const hasRecentTouch = matchedAccount.lastTouchDate 
        ? (new Date().getTime() - new Date(matchedAccount.lastTouchDate).getTime()) < 7 * 24 * 60 * 60 * 1000
        : false;

      items.push({
        accountId: matchedAccount.id,
        accountName: matchedAccount.name,
        meetingTitle: event.title,
        meetingTime: estDate,
        minutesUntil,
        hasPrepTask,
        hasRecentTouch,
        lastTouchDate: matchedAccount.lastTouchDate,
      });
    });

    // Dedupe by account, keep earliest meeting
    const byAccount = new Map<string, PrepItem>();
    items.forEach(item => {
      const existing = byAccount.get(item.accountId);
      if (!existing || item.meetingTime < existing.meetingTime) {
        byAccount.set(item.accountId, item);
      }
    });

    return Array.from(byAccount.values())
      .filter(i => !i.hasPrepTask)
      .sort((a, b) => a.minutesUntil - b.minutesUntil);
  }, [events, tasks, accounts, todayStr, now]);

  const handleAddPrepTask = (item: PrepItem) => {
    addTask({
      title: `Prep for ${item.meetingTitle}`,
      workstream: 'pg',
      status: 'next',
      priority: item.minutesUntil < 120 ? 'P0' : 'P1',
      dueDate: todayStr,
      linkedAccountId: item.accountId,
      motion: 'new-logo',
      linkedRecordType: 'account',
      linkedRecordId: item.accountId,
    });
    toast.success(`Prep task created for ${item.accountName}`);
  };

  if (prepItems.length === 0) return null;

  return (
    <motion.div 
      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="font-display text-sm font-semibold text-amber-700 dark:text-amber-300">
          Meeting Prep Needed
        </h3>
        <span className="text-xs text-amber-600/70 dark:text-amber-400/70 ml-auto">
          {prepItems.length} account{prepItems.length !== 1 ? 's' : ''}
        </span>
      </div>
      
      <div className="space-y-2">
        {prepItems.slice(0, 3).map(item => (
          <div key={item.accountId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border/50">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.accountName}</p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>
                  {item.minutesUntil > 0 
                    ? `Meeting in ${item.minutesUntil < 60 ? `${item.minutesUntil}m` : `${Math.round(item.minutesUntil / 60)}h`}`
                    : 'Meeting now'
                  }
                </span>
                {!item.hasRecentTouch && (
                  <span className="text-amber-600 dark:text-amber-400">
                    • No touch in 7+ days
                  </span>
                )}
              </div>
            </div>
            <Button 
              size="sm" 
              variant="outline" 
              className="h-7 text-xs gap-1 shrink-0"
              onClick={() => handleAddPrepTask(item)}
            >
              <Plus className="h-3 w-3" />
              Prep
            </Button>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
