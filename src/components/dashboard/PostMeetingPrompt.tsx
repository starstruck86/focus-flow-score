// Post-Meeting Prompt — surfaces after a calendar meeting ends to prompt next-step logging + transcript upload
import React, { useState, useMemo, useRef } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, Building2, X, ExternalLink, ChevronRight, FileText, Upload, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useStore } from '@/store/useStore';
import { useSaveTranscript } from '@/hooks/useCallTranscripts';
import { format, parseISO, differenceInMinutes, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
  primaryOppName?: string;
}

export function PostMeetingPrompt() {
  const { data: events } = useCalendarEvents();
  const { accounts, opportunities, updateAccount, updateOpportunity } = useStore();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = sessionStorage.getItem(DISMISSED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
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
        primaryOppName: primaryOpp?.name,
      });
    });

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

    updateAccount(item.accountId, {
      nextStep: step,
      lastTouchDate: format(new Date(), 'yyyy-MM-dd'),
      lastTouchType: 'meeting',
    });

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
          <PostMeetingCard
            key={item.eventId}
            item={item}
            nextStep={nextSteps[item.eventId] || ''}
            onNextStepChange={val => setNextSteps(prev => ({ ...prev, [item.eventId]: val }))}
            onLogNextStep={() => handleLogNextStep(item)}
            onDismiss={() => handleDismiss(item.eventId)}
          />
        ))}
      </motion.div>
    </AnimatePresence>
  );
}

const PostMeetingCard = React.forwardRef<HTMLDivElement, {
  item: PostMeetingItem;
  nextStep: string;
  onNextStepChange: (val: string) => void;
  onLogNextStep: () => void;
  onDismiss: () => void;
}>(({ item, nextStep, onNextStepChange, onLogNextStep, onDismiss }, ref) => {
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [autoExtract, setAutoExtract] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveTranscript = useSaveTranscript();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large — max 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        setTranscript(text);
        toast.success(`Loaded ${file.name}`);
      }
    };
    reader.readAsText(file);
  };

  const handleSaveTranscript = async () => {
    if (!transcript.trim()) {
      toast.error('Paste or upload a transcript first');
      return;
    }

    setSaving(true);
    try {
      const title = `${item.eventTitle} - ${format(new Date(), 'yyyy-MM-dd')}`;

      await saveTranscript.mutateAsync({
        title,
        content: transcript.trim(),
        call_date: format(new Date(), 'yyyy-MM-dd'),
        call_type: 'Meeting',
        account_id: item.accountId,
        opportunity_id: item.primaryOppId,
      });

      setSaved(true);
      toast.success('Transcript saved & linked to account');

      if (autoExtract) {
        setExtracting(true);
        try {
          const { data, error } = await trackedInvoke<any>('extract-tasks', {
            body: {
              transcript_content: transcript.trim(),
              transcript_title: title,
              account_id: item.accountId,
              opportunity_id: item.primaryOppId,
            },
          });
          if (!error && data?.tasks?.length > 0) {
            const { addTask } = useStore.getState();
            data.tasks.forEach((t: any) => {
              addTask({
                title: t.title,
                priority: t.priority || 'P2',
                status: 'next' as const,
                dueDate: t.due_date,
                notes: t.notes ? `[From transcript] ${t.notes}` : '[Auto-extracted from call transcript]',
                category: t.category || 'call',
                motion: 'new-logo' as const,
                workstream: 'pg' as const,
                linkedRecordType: item.primaryOppId ? 'opportunity' as const : 'account' as const,
                linkedRecordId: item.primaryOppId || item.accountId,
                linkedAccountId: item.accountId,
              } as any);
            });
            toast.success(`${data.tasks.length} action items extracted as tasks`);
          }
        } catch {
          // Non-critical — transcript is already saved
        } finally {
          setExtracting(false);
        }
      }
    } catch (err: unknown) {
      toast.error('Failed to save transcript', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="rounded-lg bg-card border border-border/50 p-3 space-y-2">
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
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              onClick={() => window.open(item.salesforceLink, '_blank')}
            >
              <ExternalLink className="h-3 w-3" /> SF
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDismiss}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="What's the next step? (e.g. Send proposal by Friday)"
          className="text-xs h-8 flex-1"
          value={nextStep}
          onChange={e => onNextStepChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onLogNextStep()}
        />
        <Button size="sm" className="h-8 text-xs gap-1 shrink-0" onClick={onLogNextStep}>
          <ChevronRight className="h-3 w-3" /> Log
        </Button>
      </div>

      <button
        className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium w-full"
        onClick={() => setShowTranscript(!showTranscript)}
      >
        <FileText className="h-3 w-3" />
        {saved ? '✓ Transcript saved' : 'Add call transcript'}
        <ChevronDown className={cn('h-3 w-3 ml-auto transition-transform', showTranscript && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {showTranscript && !saved && (
          <motion.div
            className="space-y-2 pt-1 border-t border-border/30"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="flex gap-2 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.vtt,.srt"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3" /> Upload file
              </Button>
              <span className="text-[10px] text-muted-foreground">
                .txt, .md, .vtt, .srt — or paste below
              </span>
            </div>

            <Textarea
              placeholder="Paste your meeting transcript here..."
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              rows={4}
              className="text-xs font-mono resize-none"
            />

            {item.hasOpenOpp && item.primaryOppName && (
              <p className="text-[10px] text-muted-foreground">
                Will be linked to: <span className="font-medium text-foreground">{item.primaryOppName}</span>
              </p>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`extract-${item.eventId}`}
                  checked={autoExtract}
                  onCheckedChange={(v) => setAutoExtract(!!v)}
                />
                <label htmlFor={`extract-${item.eventId}`} className="text-[11px] text-muted-foreground flex items-center gap-1 cursor-pointer">
                  <Sparkles className="h-3 w-3 text-primary" /> Auto-extract action items
                </label>
              </div>

              <Button
                size="sm"
                className="h-7 text-[11px] gap-1"
                onClick={handleSaveTranscript}
                disabled={saving || !transcript.trim()}
              >
                {saving ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>
                ) : extracting ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Extracting...</>
                ) : (
                  <><FileText className="h-3 w-3" /> Save Transcript</>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

PostMeetingCard.displayName = 'PostMeetingCard';
