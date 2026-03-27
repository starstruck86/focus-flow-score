/**
 * AccountQuickActions — Inline outcome logging and next-step actions.
 * Feels immediate and low-friction.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Phone, PhoneOff, Voicemail, Calendar,
  ArrowRight, Ban, Clock, MessageSquare,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { recordAccountOutcome, type OutcomeType } from '@/lib/accountExecutionState';
import { appendTimelineEvent, type AccountEventType } from '@/lib/accountTimeline';
import { todayInAppTz } from '@/lib/timeFormat';
import { toast } from 'sonner';

interface AccountQuickActionsProps {
  accountId: string;
  accountName: string;
  loopId: string | null;
  onOutcomeLogged?: () => void;
  compact?: boolean;
}

const OUTCOME_BUTTONS: {
  type: OutcomeType;
  label: string;
  icon: typeof Phone;
  timelineType: AccountEventType;
  className: string;
}[] = [
  { type: 'no_answer', label: 'No Answer', icon: PhoneOff, timelineType: 'no_answer', className: 'text-muted-foreground hover:text-foreground' },
  { type: 'voicemail', label: 'Voicemail', icon: Voicemail, timelineType: 'voicemail', className: 'text-muted-foreground hover:text-foreground' },
  { type: 'connected', label: 'Connected', icon: Phone, timelineType: 'connected', className: 'text-primary hover:text-primary' },
  { type: 'meeting_booked', label: 'Meeting', icon: Calendar, timelineType: 'meeting_booked', className: 'text-status-green hover:text-status-green' },
  { type: 'follow_up_needed', label: 'Follow Up', icon: Clock, timelineType: 'follow_up_needed', className: 'text-status-yellow hover:text-status-yellow' },
  { type: 'not_now', label: 'Not Now', icon: ArrowRight, timelineType: 'not_now', className: 'text-muted-foreground hover:text-foreground' },
  { type: 'bad_fit', label: 'Bad Fit', icon: Ban, timelineType: 'bad_fit', className: 'text-destructive/70 hover:text-destructive' },
];

export function AccountQuickActions({
  accountId,
  accountName,
  loopId,
  onOutcomeLogged,
  compact = false,
}: AccountQuickActionsProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [pendingOutcome, setPendingOutcome] = useState<OutcomeType>(null);
  const [notes, setNotes] = useState('');

  const handleOutcome = (type: OutcomeType) => {
    if (!type) return;
    setPendingOutcome(type);
    setShowNotes(true);
  };

  const confirmOutcome = () => {
    if (!pendingOutcome) return;
    const today = todayInAppTz();

    recordAccountOutcome(
      today,
      accountId,
      accountName,
      loopId,
      null,
      pendingOutcome,
      notes || null,
    );

    const tlType = OUTCOME_BUTTONS.find(b => b.type === pendingOutcome)?.timelineType || 'attempted';
    appendTimelineEvent(accountId, accountName, tlType, {
      date: today,
      loopId,
      notes: notes || null,
    });

    toast.success(`${accountName}: ${pendingOutcome?.replace(/_/g, ' ')}`);
    setShowNotes(false);
    setPendingOutcome(null);
    setNotes('');
    onOutcomeLogged?.();
  };

  const cancelOutcome = () => {
    setShowNotes(false);
    setPendingOutcome(null);
    setNotes('');
  };

  if (showNotes) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          placeholder="Quick note (optional)…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && confirmOutcome()}
          className="h-7 text-xs flex-1"
        />
        <Button size="sm" variant="default" onClick={confirmOutcome} className="h-7 px-2 text-xs">
          Log
        </Button>
        <Button size="sm" variant="ghost" onClick={cancelOutcome} className="h-7 px-2 text-xs">
          ×
        </Button>
      </div>
    );
  }

  const buttons = compact ? OUTCOME_BUTTONS.slice(0, 4) : OUTCOME_BUTTONS;

  return (
    <div className="flex flex-wrap gap-1">
      {buttons.map(btn => {
        const Icon = btn.icon;
        return (
          <Button
            key={btn.type}
            size="sm"
            variant="ghost"
            onClick={() => handleOutcome(btn.type)}
            className={cn('h-7 px-2 text-[11px] gap-1', btn.className)}
          >
            <Icon className="h-3 w-3" />
            {!compact && btn.label}
          </Button>
        );
      })}
    </div>
  );
}
