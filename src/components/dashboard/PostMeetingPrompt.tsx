// Post-Meeting Prompt — surfaces after a calendar meeting ends to prompt next-step logging
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, Building2, X, ExternalLink, ChevronRight } from 'lucide-react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useStore } from '@/store/useStore';
import { format, parseISO, differenceInMinutes, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { matchAccountToEvent } from '@/lib/accountMatcher';

const TIMEZONE = 'America/New_York';
const DISMISSED_KEY = 'post_meeting_dismissed';

interface PostMeetingItem {
  eventId: string;
  eventTitle: string;
  endedMinutesAgo: number;
  accountId: string;
  accountName: string;
  salesforceLink?: string;
  hasOpenOpp: boolean;
  primaryOppId?: string;
}

export function PostMeetingPrompt() {
  const { data: events } = useCalendarEvents();
  const { accounts, opportunities, updateAccount, updateOpportunity } = useStore();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = sessionStorage.getItem(DISMISSED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [nextSteps, setNextSteps] = useState<Record<string, string>>({});

  const now = toZonedTime(new Date(), TIMEZONE);

  const recentlyEndedMeetings = useMemo(() => {
    if (!events) return [];
    const items: PostMeetingItem[] = [];

    events.forEach(event => {
      if (event.all_day || !event.end_time) return;

      const endUtc = parseISO(event.end_time);
      if (!isValid(endUtc)) return;

      const endEst = toZonedTime(endUtc, TIMEZONE);
      const minutesSinceEnd = differenceInMinutes(now, endEst);

      // Show for meetings that ended 0–90 minutes ago
      if (minutesSinceEnd < 0 || minutesSinceEnd > 90) return;

      const matched = matchAccountToEvent(event.title, accounts);
      if (!matched) return;

      const accountOpps = opportunities.filter(
        o => o.accountId === matched.id && o.status === 'active'
      );
      const primaryOpp = accountOpps.sort((a, b) => (b.arr || 0) - (a.arr || 0))[0];

      items.push({
        eventId: event.id,
        eventTitle: event.title,
        endedMinutesAgo: minutesSinceEnd,
        accountId: matched.id,
        accountName: matched.name,
        salesforceLink: matched.salesforceLink,
        hasOpenOpp: accountOpps.length > 0,
        primaryOppId: primaryOpp?.id,
      });
    });

    // Dedupe by account
    const byAccount = new Map<string, PostMeetingItem>();
    items.forEach(item => {
      const existing = byAccount.get(item.accountId);
      if (!existing || item.endedMinutesAgo < existing.endedMinutesAgo) {
        byAccount.set(item.accountId, item);
      }
    });

    return Array.from(byAccount.values())
      .filter(m => !dismissed.has(m.eventId))
      .sort((a, b) => a.endedMinutesAgo - b.endedMinutesAgo);
  }, [events, accounts, opportunities, now, dismissed]);

  const handleDismiss = (eventId: string) => {
    const next = new Set(dismissed);
    next.add(eventId);
    setDismissed(next);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
  };

  const handleLogNextStep = (item: PostMeetingItem) => {
    const step = nextSteps[item.eventId]?.trim();
    if (!step) {
      toast.error('Enter a next step first');
      return;
    }

    // Update the account's next step
    updateAccount(item.accountId, {
      nextStep: step,
      lastTouchDate: format(new Date(), 'yyyy-MM-dd'),
      lastTouchType: 'meeting',
    });

    // If there's an open opp, update its next step too
    if (item.primaryOppId) {
      updateOpportunity(item.primaryOppId, {
        nextStep: step,
        lastTouchDate: format(new Date(), 'yyyy-MM-dd'),
      });
    }

    toast.success(`Next step logged for ${item.accountName}`);
    handleDismiss(item.eventId);
  };

  if (recentlyEndedMeetings.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="rounded-xl border-2 border-status-green/40 bg-status-green/5 p-4 space-y-2"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        layout
      >
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle2 className="h-4 w-4 text-status-green" />
          <h3 className="font-display text-sm font-semibold">
            Meeting Just Ended — Log Next Steps
          </h3>
          <span className="text-[10px] text-muted-foreground ml-auto">
            Update in Salesforce, capture next step here
          </span>
        </div>

        {recentlyEndedMeetings.slice(0, 3).map(item => (
          <div key={item.eventId} className="rounded-lg bg-card border border-border/50 p-3 space-y-2">
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{item.accountName}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Ended {item.endedMinutesAgo}m ago</span>
                  <span className="truncate">• {item.eventTitle}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.salesforceLink && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                    onClick={() => window.open(item.salesforceLink, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3" /> SF
                  </Button>
                )}
                <Button
                  size="sm" variant="ghost" className="h-7 w-7 p-0"
                  onClick={() => handleDismiss(item.eventId)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="What's the next step? (e.g. Send proposal by Friday)"
                className="text-xs h-8 flex-1"
                value={nextSteps[item.eventId] || ''}
                onChange={e => setNextSteps(prev => ({ ...prev, [item.eventId]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleLogNextStep(item)}
              />
              <Button
                size="sm" className="h-8 text-xs gap-1 shrink-0"
                onClick={() => handleLogNextStep(item)}
              >
                <ChevronRight className="h-3 w-3" /> Log
              </Button>
            </div>
          </div>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
