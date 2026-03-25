// Proactive Meeting Prep Prompt - Shows a prominent banner for upcoming client meetings
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Building2, Clock, FileText, ChevronRight, X, Video, CheckCircle2, Plus, Target, RefreshCw, Sparkles, Mail } from 'lucide-react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useStore } from '@/store/useStore';
import { useRecentTranscriptsForMeetingPrep } from '@/hooks/useCallTranscripts';
import { useResourceLinksForAccount } from '@/hooks/useResourceLinks';
import { useCopilot } from '@/contexts/CopilotContext';
import { format, parseISO, differenceInMinutes, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { matchAccountToEvent } from '@/lib/accountMatcher';

import { APP_TIMEZONE } from '@/lib/timeFormat';
const TIMEZONE = APP_TIMEZONE;
const DISMISSED_KEY = 'meeting_prep_dismissed';

interface UpcomingClientMeeting {
  eventId: string;
  eventTitle: string;
  meetingTime: Date;
  minutesUntil: number;
  accountId: string;
  accountName: string;
  accountTier?: string;
  lastTouchDate?: string;
  hasOpenOpps: boolean;
  hasRenewals: boolean;
  hasPrepTask: boolean;
  oppCount: number;
  renewalCount: number;
  oppArr: number;
  renewalArr: number;
  nextStep?: string;
  nextStepDate?: string;
  oppStage?: string;
}

export function MeetingPrepPrompt() {
  const { data: events } = useCalendarEvents();
  const { tasks, accounts, opportunities, renewals, addTask } = useStore();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = sessionStorage.getItem(DISMISSED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const now = toZonedTime(new Date(), TIMEZONE);

  const upcomingMeetings = useMemo(() => {
    if (!events) return [];
    const items: UpcomingClientMeeting[] = [];

    events.forEach(event => {
      if (event.all_day) return;
      const utcDate = parseISO(event.start_time);
      if (!isValid(utcDate)) return;

      const estDate = toZonedTime(utcDate, TIMEZONE);
      if (!isValid(estDate)) return;

      const minutesUntil = differenceInMinutes(estDate, now);

      if (minutesUntil < -15 || minutesUntil > 240) return;

      const matchedAccount = matchAccountToEvent(event.title, accounts);
      if (!matchedAccount) return;

      const accountOpps = opportunities.filter(o => o.accountId === matchedAccount.id && o.status === 'active');
      const accountRenewals = renewals.filter(r => r.accountName === matchedAccount.name);
      const oppArr = accountOpps.reduce((sum, o) => sum + (o.arr || 0), 0);
      const renewalArr = accountRenewals.reduce((sum, r) => sum + r.arr, 0);

      // Get the most relevant opp's next step
      const primaryOpp = accountOpps.sort((a, b) => (b.arr || 0) - (a.arr || 0))[0];

      const hasPrepTask = tasks.some(t =>
        t.linkedAccountId === matchedAccount.id &&
        t.status !== 'done' && t.status !== 'dropped' &&
        (t.title.toLowerCase().includes('prep') || t.title.toLowerCase().includes('research'))
      );

      items.push({
        eventId: event.id,
        eventTitle: event.title,
        meetingTime: estDate,
        minutesUntil,
        accountId: matchedAccount.id,
        accountName: matchedAccount.name,
        accountTier: matchedAccount.tier,
        lastTouchDate: matchedAccount.lastTouchDate,
        hasOpenOpps: accountOpps.length > 0,
        hasRenewals: accountRenewals.length > 0,
        hasPrepTask,
        oppCount: accountOpps.length,
        renewalCount: accountRenewals.length,
        oppArr,
        renewalArr,
        nextStep: primaryOpp?.nextStep,
        nextStepDate: primaryOpp?.nextStepDate,
        oppStage: primaryOpp?.stage,
      });
    });

    const byAccount = new Map<string, UpcomingClientMeeting>();
    items.forEach(item => {
      const existing = byAccount.get(item.accountId);
      if (!existing || item.meetingTime < existing.meetingTime) {
        byAccount.set(item.accountId, item);
      }
    });

    return Array.from(byAccount.values())
      .filter(m => !dismissed.has(m.eventId))
      .sort((a, b) => a.minutesUntil - b.minutesUntil);
  }, [events, accounts, opportunities, renewals, tasks, now, dismissed]);

  // Auto-expand the most urgent meeting
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const autoExpandId = upcomingMeetings.length > 0 && upcomingMeetings[0].minutesUntil <= 60
    ? upcomingMeetings[0].eventId : null;
  const effectiveExpandedId = expandedId ?? autoExpandId;

  const handleDismiss = (eventId: string) => {
    const next = new Set(dismissed);
    next.add(eventId);
    setDismissed(next);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
  };

  const handleAddPrepTask = (meeting: UpcomingClientMeeting) => {
    addTask({
      title: `Prep for ${meeting.eventTitle}`,
      workstream: 'pg',
      status: 'next',
      priority: meeting.minutesUntil < 60 ? 'P0' : 'P1',
      dueDate: format(new Date(), 'yyyy-MM-dd'),
      linkedAccountId: meeting.accountId,
      motion: 'new-logo',
      linkedRecordType: 'account',
      linkedRecordId: meeting.accountId,
    });
    toast.success(`Prep task created for ${meeting.accountName}`);
  };

  if (upcomingMeetings.length === 0) return null;

  const urgentMeeting = upcomingMeetings[0];
  const isUrgent = urgentMeeting.minutesUntil <= 30;

  return (
    <AnimatePresence>
      <motion.div
        className={cn(
          "rounded-xl border-2 p-4 space-y-3",
          isUrgent
            ? "border-destructive/50 bg-destructive/5"
            : "border-primary/40 bg-primary/5"
        )}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        layout
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isUrgent ? (
              <AlertTriangle className="h-5 w-5 text-destructive animate-pulse" />
            ) : (
              <Video className="h-5 w-5 text-primary" />
            )}
            <h3 className={cn(
              "font-display text-sm font-bold",
              isUrgent ? "text-destructive" : "text-foreground"
            )}>
              {isUrgent ? '⚡ Meeting Starting Soon!' : 'Upcoming Client Meetings'}
            </h3>
            <Badge variant="outline" className="text-[10px] h-5">
              {upcomingMeetings.length} meeting{upcomingMeetings.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          {upcomingMeetings.slice(0, 4).map(meeting => (
            <MeetingCard
              key={meeting.eventId}
              meeting={meeting}
              isExpanded={effectiveExpandedId === meeting.eventId}
              onToggle={() => setExpandedId(
                effectiveExpandedId === meeting.eventId ? '__none__' : meeting.eventId
              )}
              onDismiss={() => handleDismiss(meeting.eventId)}
              onAddPrep={() => handleAddPrepTask(meeting)}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function MeetingCard({ meeting, isExpanded, onToggle, onDismiss, onAddPrep }: {
  meeting: UpcomingClientMeeting;
  isExpanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onAddPrep: () => void;
}) {
  const { ask, askBackground } = useCopilot();
  const isUrgent = meeting.minutesUntil <= 30;
  const daysSinceTouch = meeting.lastTouchDate
    ? Math.floor((Date.now() - new Date(meeting.lastTouchDate).getTime()) / 86400000)
    : null;

  const { data: recentTranscripts } = useRecentTranscriptsForMeetingPrep(
    isExpanded ? meeting.accountId : undefined
  );

  const { data: accountResources } = useResourceLinksForAccount(
    isExpanded ? meeting.accountId : undefined
  );

  return (
    <div className={cn(
      "rounded-lg bg-card border transition-all",
      isUrgent ? "border-destructive/30" : "border-border/50"
    )}>
      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={onToggle}>
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate">{meeting.accountName}</p>
            {meeting.accountTier && (
              <Badge variant="outline" className="text-[9px] h-4 px-1">Tier {meeting.accountTier}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            <Clock className="h-3 w-3" />
            <span className={cn(isUrgent && "text-destructive font-semibold")}>
              {meeting.minutesUntil <= 0 ? 'Happening now' :
               meeting.minutesUntil < 60 ? `In ${meeting.minutesUntil}m` :
               `In ${Math.round(meeting.minutesUntil / 60)}h`}
            </span>
            <span className="truncate">• {meeting.eventTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!meeting.hasPrepTask && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={e => { e.stopPropagation(); onAddPrep(); }}>
              <Plus className="h-3 w-3" /> Prep
            </Button>
          )}
          {meeting.hasPrepTask && <CheckCircle2 className="h-4 w-4 text-status-green" />}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => { e.stopPropagation(); onDismiss(); }}>
            <X className="h-3 w-3" />
          </Button>
          <ChevronRight className={cn("h-4 w-4 transition-transform text-muted-foreground", isExpanded && "rotate-90")} />
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="px-3 pb-3 space-y-2 border-t border-border/50 pt-2"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            {/* Quick Stats - separate opp vs renewal ARR */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-[10px] text-muted-foreground">Opps</p>
                <p className="text-sm font-bold">{meeting.oppCount}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-[10px] text-muted-foreground">Opp ARR</p>
                <p className="text-sm font-bold">${(meeting.oppArr / 1000).toFixed(0)}k</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-[10px] text-muted-foreground">Renewals</p>
                <p className="text-sm font-bold">{meeting.renewalCount}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-[10px] text-muted-foreground">Last Touch</p>
                <p className={cn("text-sm font-bold", daysSinceTouch != null && daysSinceTouch > 7 && "text-destructive")}>
                  {daysSinceTouch != null ? `${daysSinceTouch}d` : '—'}
                </p>
              </div>
            </div>

            {/* Next Step from primary opp */}
            {meeting.nextStep && (
              <div className="flex items-start gap-2 text-[11px] p-2 rounded-md bg-primary/5 border border-primary/10">
                <Target className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-primary">
                    Next Step{meeting.oppStage ? ` (${meeting.oppStage})` : ''}
                  </p>
                  <p className="text-foreground">{meeting.nextStep}</p>
                  {meeting.nextStepDate && (
                    <p className="text-muted-foreground mt-0.5">Due: {meeting.nextStepDate}</p>
                  )}
                </div>
              </div>
            )}

            {/* Warnings */}
            {daysSinceTouch != null && daysSinceTouch > 7 && (
              <div className="flex items-center gap-1 text-[11px] text-destructive">
                <AlertTriangle className="h-3 w-3" />
                <span>No touch in {daysSinceTouch} days — review recent context</span>
              </div>
            )}

            {/* Account Resources */}
            {accountResources && accountResources.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-muted-foreground">📎 Templates & Resources</p>
                {accountResources.map((r) => (
                  <a
                    key={r.id}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[11px] p-1.5 rounded bg-primary/5 border border-primary/10 hover:bg-primary/10 transition-colors"
                  >
                    <FileText className="h-3 w-3 text-primary shrink-0" />
                    <span className="font-medium truncate text-foreground">{r.label || 'Resource'}</span>
                    <span className="text-muted-foreground capitalize text-[9px]">{r.category}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Recent Transcripts */}
            {recentTranscripts && recentTranscripts.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-muted-foreground">Recent Call Transcripts</p>
                {recentTranscripts.map(t => (
                  <div key={t.id} className="flex items-start gap-2 text-[11px] p-1.5 rounded bg-muted/30">
                    <FileText className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{t.title || t.call_type || 'Call'}</p>
                      <p className="text-muted-foreground">{t.call_date} • {t.participants || 'No participants listed'}</p>
                      {t.summary && <p className="text-muted-foreground line-clamp-2 mt-0.5">{t.summary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {recentTranscripts && recentTranscripts.length === 0 && (
              <p className="text-[11px] text-muted-foreground italic">No call transcripts for this account yet</p>
            )}

            {/* AI Actions */}
            <div className="flex gap-1.5 pt-1 border-t border-border/30">
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 flex-1" onClick={e => { e.stopPropagation(); askBackground(`Prep me for my meeting with ${meeting.accountName}`, 'meeting', meeting.accountId); }}>
                <Sparkles className="h-3 w-3" /> AI Meeting Brief
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 flex-1" onClick={e => { e.stopPropagation(); askBackground(`Analyze my deal with ${meeting.accountName} using my frameworks`, 'deal-strategy', meeting.accountId); }}>
                <Target className="h-3 w-3" /> Deal Strategy
              </Button>
              {recentTranscripts && recentTranscripts.length > 0 && (
                <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 flex-1" onClick={e => { e.stopPropagation(); askBackground(`Draft a recap email for my last call with ${meeting.accountName}`, 'recap-email', meeting.accountId); }}>
                  <Mail className="h-3 w-3" /> Recap Email
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
