import { useState } from 'react';
import { LogIn, LogOut, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useTodayJournalEntry } from '@/hooks/useDailyJournal';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';

export function WorkdayCheckInButton() {
  const { data: todayEntry } = useTodayJournalEntry();
  const queryClient = useQueryClient();
  const [showCheckInDialog, setShowCheckInDialog] = useState(false);
  const [showCheckOutDialog, setShowCheckOutDialog] = useState(false);
  const [showFirstCallDialog, setShowFirstCallDialog] = useState(false);
  const [focus, setFocus] = useState('');
  const [firstCallTime, setFirstCallTime] = useState(format(new Date(), 'HH:mm'));

  const today = format(new Date(), 'yyyy-MM-dd');

  // Derive state from journal entry
  const isCheckedIn = !!(todayEntry as any)?.workday_start_time;
  const isCheckedOut = !!(todayEntry as any)?.workday_end_time;
  const hasFirstCall = !!(todayEntry as any)?.first_call_logged;

  const ensureEntry = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Upsert a minimal entry if none exists
    const { error } = await supabase
      .from('daily_journal_entries')
      .upsert(
        { user_id: user.id, date: today },
        { onConflict: 'user_id,date' }
      );
    if (error) throw error;
    return user.id;
  };

  const handleCheckIn = async () => {
    try {
      await ensureEntry();
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('daily_journal_entries')
        .update({
          workday_start_time: now,
          ...(focus ? { workday_focus: focus } : {}),
        } as any)
        .eq('date', today);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['journal-entry', today] });
      toast.success('Checked in! Have a great day.', {
        description: focus ? `Focus: ${focus}` : undefined,
      });
      setShowCheckInDialog(false);
      setFocus('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to check in');
    }
  };

  const handleCheckOut = async () => {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('daily_journal_entries')
        .update({ workday_end_time: now } as any)
        .eq('date', today);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['journal-entry', today] });
      toast.success('Checked out! Good work today.');
      setShowCheckOutDialog(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to check out');
    }
  };

  const handleLogFirstCall = async () => {
    try {
      await ensureEntry();
      const [hours, minutes] = firstCallTime.split(':').map(Number);
      const callTime = new Date();
      callTime.setHours(hours, minutes, 0, 0);

      const { error } = await supabase
        .from('daily_journal_entries')
        .update({
          first_call_time: callTime.toISOString(),
          first_call_logged: true,
        } as any)
        .eq('date', today);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['journal-entry', today] });
      toast.success(`First call logged at ${firstCallTime}`);
      setShowFirstCallDialog(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to log first call');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Check In / Check Out button */}
        {!isCheckedIn ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowCheckInDialog(true)}
          >
            <LogIn className="h-3.5 w-3.5" />
            Check In
          </Button>
        ) : !isCheckedOut ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowCheckOutDialog(true)}
          >
            <LogOut className="h-3.5 w-3.5" />
            Check Out
          </Button>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Day complete
          </Badge>
        )}

        {/* First Call button */}
        {isCheckedIn && !hasFirstCall && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowFirstCallDialog(true)}
          >
            <Phone className="h-3.5 w-3.5" />
            Log First Call
          </Button>
        )}
        {hasFirstCall && (
          <Badge variant="outline" className="text-xs text-status-green bg-status-green/10">
            <Phone className="h-3 w-3 mr-1" />
            1st call ✓
          </Badge>
        )}
      </div>

      {/* Check In Dialog */}
      <Dialog open={showCheckInDialog} onOpenChange={setShowCheckInDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-primary" />
              Start Your Day
            </DialogTitle>
            <DialogDescription>
              Record your workday start time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">What's your focus today? (optional)</Label>
              <Input
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="e.g., Close 2 proposals, hit 50 dials"
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCheckInDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCheckIn}>
              <LogIn className="h-4 w-4 mr-1" />
              Check In
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check Out Dialog */}
      <Dialog open={showCheckOutDialog} onOpenChange={setShowCheckOutDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5 text-primary" />
              End Your Day
            </DialogTitle>
            <DialogDescription>
              Record your workday end time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCheckOutDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCheckOut}>
              <LogOut className="h-4 w-4 mr-1" />
              Check Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* First Call Dialog */}
      <Dialog open={showFirstCallDialog} onOpenChange={setShowFirstCallDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-primary" />
              Log First Call
            </DialogTitle>
            <DialogDescription>
              When did you make your first call today?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">First call time</Label>
              <Input
                type="time"
                value={firstCallTime}
                onChange={(e) => setFirstCallTime(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowFirstCallDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleLogFirstCall}>
              <Phone className="h-4 w-4 mr-1" />
              Log Call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
