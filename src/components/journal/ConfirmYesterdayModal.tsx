import { format, isValid } from 'date-fns';
import { useYesterdayJournalEntry, useConfirmJournalEntry } from '@/hooks/useDailyJournal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2, 
  Edit, 
  Flame, 
  Zap, 
  Target,
  Calendar,
} from 'lucide-react';

import { RingGauge } from '@/components/RingGauge';
import { cn } from '@/lib/utils';
import type { DailyJournalEntry } from '@/types/journal';
import { toast } from 'sonner';

interface ConfirmYesterdayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: DailyJournalEntry | null;
  onEdit?: () => void;
}

export function ConfirmYesterdayModal({
  open,
  onOpenChange,
  entry: propEntry,
  onEdit,
}: ConfirmYesterdayModalProps) {
  // Allow entry to come from props or fetch it ourselves
  const { data: fetchedEntry } = useYesterdayJournalEntry();
  const entry = propEntry || fetchedEntry;
  const confirmEntry = useConfirmJournalEntry();
  
  const handleConfirm = async () => {
    if (!entry) return;
    try {
      await confirmEntry.mutateAsync(entry.date);
      toast.success('Yesterday confirmed!', {
        description: 'Your streak credit is now locked in.',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to confirm:', error);
      toast.error('Failed to confirm entry');
    }
  };
  
  const handleEdit = () => {
    onOpenChange(false);
    onEdit?.();
  };
  
  // Don't render if no entry
  if (!entry) {
    return null;
  }
  
  const dateDisplay = format(new Date(entry.date + 'T12:00:00'), 'EEEE, MMMM d');
  const strainBand = (entry.salesStrain || 0) <= 6 ? 'low' : (entry.salesStrain || 0) <= 11 ? 'moderate' : 'high';
  const recoveryBand = (entry.salesRecovery || 0) >= 67 ? 'green' : (entry.salesRecovery || 0) >= 34 ? 'yellow' : 'red';
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Confirm Yesterday
          </DialogTitle>
          <DialogDescription>
            Quick review of {dateDisplay}. Lock it in or make edits.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Goal Status */}
          <div className={cn(
            "p-3 rounded-lg text-center",
            entry.goalMet 
              ? "bg-status-green/10 border border-status-green/30" 
              : "bg-muted border border-border"
          )}>
            <span className={cn(
              "font-semibold",
              entry.goalMet ? "text-status-green" : "text-muted-foreground"
            )}>
              {entry.goalMet ? "✓ Goal Met" : "Goal Not Met"}
            </span>
          </div>
          
          {/* Mini Gauges */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="flex justify-center mb-1">
                <RingGauge
                  value={entry.salesStrain || 0}
                  max={21}
                  type="strain"
                  size={60}
                />
              </div>
              <div className="flex items-center justify-center gap-1">
                <Flame className="h-3 w-3 text-strain" />
                <span className="text-xs">Strain</span>
              </div>
            </div>
            
            <div className="text-center">
              <div className="flex justify-center mb-1">
                <RingGauge
                  value={entry.salesRecovery || 0}
                  max={100}
                  type="recovery"
                  size={60}
                  label="%"
                />
              </div>
              <div className="flex items-center justify-center gap-1">
                <Zap className="h-3 w-3 text-recovery" />
                <span className="text-xs">Recovery</span>
              </div>
            </div>
            
            <div className="text-center">
              <div className="flex justify-center mb-1">
                <RingGauge
                  value={entry.salesProductivity || 0}
                  max={100}
                  type="productivity"
                  size={60}
                  label="%"
                />
              </div>
              <div className="flex items-center justify-center gap-1">
                <Target className="h-3 w-3 text-productivity" />
                <span className="text-xs">Productivity</span>
              </div>
            </div>
          </div>
          
          {/* Key Stats */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="p-2 bg-secondary/30 rounded flex justify-between">
              <span className="text-muted-foreground">Daily Score</span>
              <span className="font-mono font-medium">{entry.dailyScore || 0}/8</span>
            </div>
            <div className="p-2 bg-secondary/30 rounded flex justify-between">
              <span className="text-muted-foreground">Conversations</span>
              <span className="font-mono font-medium">{entry.activity.conversations}</span>
            </div>
            <div className="p-2 bg-secondary/30 rounded flex justify-between">
              <span className="text-muted-foreground">Meetings Set</span>
              <span className="font-mono font-medium">{entry.activity.meetingsSet}</span>
            </div>
            <div className="p-2 bg-secondary/30 rounded flex justify-between">
              <span className="text-muted-foreground">Sleep</span>
              <span className="font-mono font-medium">{entry.recovery.sleepHours}hrs</span>
            </div>
          </div>
        </div>
        
        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={handleEdit} className="gap-1 flex-1">
            <Edit className="h-4 w-4" />
            Edit
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={confirmEntry.isPending}
            className="gap-1 flex-1"
          >
            <CheckCircle2 className="h-4 w-4" />
            {confirmEntry.isPending ? 'Confirming...' : 'Looks Right'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
