import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap } from 'lucide-react';
import { useSaveJournalEntry, calculateJournalScores } from '@/hooks/useDailyJournal';
import { useRecordCheckIn } from '@/hooks/useStreakData';
import { getDefaultActivityTotals, getDefaultPreparednessInputs, getDefaultRecoveryJournalInputs } from '@/types/journal';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface QuickLogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickLogModal({ open, onOpenChange }: QuickLogModalProps) {
  const [dials, setDials] = useState(0);
  const [conversations, setConversations] = useState(0);
  const [prospects, setProspects] = useState(0);
  const [meetingsSet, setMeetingsSet] = useState(0);
  const [managerMsgs, setManagerMsgs] = useState(0);
  const [saving, setSaving] = useState(false);

  const saveJournal = useSaveJournalEntry();
  const recordCheckIn = useRecordCheckIn();
  const today = format(new Date(), 'yyyy-MM-dd');

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const activity = {
        ...getDefaultActivityTotals(),
        dials,
        conversations,
        prospectsAdded: prospects,
        meetingsSet,
        managerPlusMessages: managerMsgs,
      };
      const preparedness = getDefaultPreparednessInputs();
      const recovery = getDefaultRecoveryJournalInputs();

      await saveJournal.mutateAsync({
        date: today,
        activity,
        preparedness,
        recovery,
        markAsCheckedIn: true,
      });

      const scores = calculateJournalScores(activity, recovery);
      await recordCheckIn.mutateAsync({
        date: today,
        method: 'quick-log' as any,
        dailyScore: scores.dailyScore,
        isEligible: true,
        goalMet: scores.goalMet,
      });

      toast.success('Quick log saved!');
      onOpenChange(false);
      setDials(0); setConversations(0); setProspects(0); setMeetingsSet(0); setManagerMsgs(0);
    } catch (e) {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { label: 'Dials', value: dials, set: setDials },
    { label: 'Conversations', value: conversations, set: setConversations },
    { label: 'Prospects Added', value: prospects, set: setProspects },
    { label: 'Meetings Set', value: meetingsSet, set: setMeetingsSet },
    { label: 'Manager+ Messages', value: managerMsgs, set: setManagerMsgs },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Quick Log
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {fields.map((f) => (
            <div key={f.label} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <Input
                type="number"
                min={0}
                value={f.value}
                onChange={(e) => f.set(parseInt(e.target.value) || 0)}
                className="h-10 text-lg font-mono text-center"
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Log & Check In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
