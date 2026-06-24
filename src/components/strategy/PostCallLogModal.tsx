/**
 * PostCallLogModal — O2 Post-Call Log
 * 45-second entry form. Saves to call_logs table.
 * ST9 analysis (NBA generation) is triggered server-side after save.
 */
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Phone, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill account when opened from an account-linked Strategy thread */
  prefillAccountId?: string | null;
  prefillAccountName?: string | null;
}

export function PostCallLogModal({ open, onClose, prefillAccountId, prefillAccountName }: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  // Form state
  const [accountName, setAccountName] = useState('');
  const [contactName, setContactName] = useState('');
  const [callDate, setCallDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState('');
  const [expansionSignal, setExpansionSignal] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextStepDate, setNextStepDate] = useState('');
  const [branchPlayUsed, setBranchPlayUsed] = useState(false);
  const [branchKiTitle, setBranchKiTitle] = useState('');

  // Reset + pre-fill when modal opens
  useEffect(() => {
    if (open) {
      setAccountName(prefillAccountName ?? '');
      setContactName('');
      setCallDate(new Date().toISOString().slice(0, 10));
      setSummary('');
      setExpansionSignal('');
      setNextStep('');
      setNextStepDate('');
      setBranchPlayUsed(false);
      setBranchKiTitle('');
    }
  }, [open, prefillAccountName]);

  const handleSave = async () => {
    if (!user?.id || !accountName.trim() || !summary.trim()) {
      toast.error('Account name and summary are required');
      return;
    }
    setSaving(true);
    try {
      const { data: row, error } = await supabase.from('call_logs').insert({
        user_id: user.id,
        account_id: prefillAccountId ?? null,
        account_name: accountName.trim(),
        contact_name: contactName.trim() || null,
        call_date: callDate,
        summary: summary.trim(),
        expansion_signal_text: expansionSignal.trim() || null,
        expansion_signal_captured: !!expansionSignal.trim(),
        next_step: nextStep.trim() || null,
        next_step_date: nextStepDate || null,
        branch_play_used: branchPlayUsed,
        branch_ki_title: branchKiTitle.trim() || null,
      }).select('id').single();

      if (error) throw error;

      toast.success(`Call logged for ${accountName.trim()}`);

      // Trigger ST9 analysis in the background (fire-and-forget).
      // The analyze-call edge function will populate nba_situation, nba_text, nba_ki_titles.
      if (row?.id && prefillAccountId) {
        const { data: { session } } = await supabase.auth.getSession();
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-call`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token ?? ''}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              call_log_id: row.id,
              account_id: prefillAccountId,
              summary: summary.trim(),
              expansion_signal_text: expansionSignal.trim() || null,
            }),
          },
        ).catch(() => { /* silent — ST9 is additive, never blocks save */ });
      }

      onClose();
    } catch (e) {
      console.error('[PostCallLogModal] save failed', e);
      toast.error('Failed to save call log');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Phone className="h-4 w-4" style={{ color: 'hsl(var(--sv-clay))' }} />
            Log Call
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Row 1: Account + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[12px]">Account *</Label>
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Account name"
                className="h-8 text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Date</Label>
              <Input
                type="date"
                value={callDate}
                onChange={(e) => setCallDate(e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
          </div>

          {/* Row 2: Contact name */}
          <div className="space-y-1">
            <Label className="text-[12px]">Contact</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Who did you speak with?"
              className="h-8 text-[13px]"
            />
          </div>

          {/* Row 3: Summary */}
          <div className="space-y-1">
            <Label className="text-[12px]">Call summary *</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What happened? 2–4 sentences on what was discussed, where the deal stands, what you learned."
              className="text-[13px] min-h-[72px] resize-none"
            />
          </div>

          {/* Row 4: Expansion signal */}
          <div className="space-y-1">
            <Label className="text-[12px]">Branch expansion signal <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              value={expansionSignal}
              onChange={(e) => setExpansionSignal(e.target.value)}
              placeholder="Any signal about Branch expansion opportunity?"
              className="h-8 text-[13px]"
            />
          </div>

          {/* Row 5: Next step + date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[12px]">Next step</Label>
              <Input
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                placeholder="What's the next action?"
                className="h-8 text-[13px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Due date</Label>
              <Input
                type="date"
                value={nextStepDate}
                onChange={(e) => setNextStepDate(e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
          </div>

          {/* Row 6: Branch KI/play */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={branchPlayUsed}
                onChange={(e) => setBranchPlayUsed(e.target.checked)}
                className="rounded"
              />
              <span className="text-[12px]">Used a Branch KI / play in this call</span>
            </label>
            {branchPlayUsed && (
              <Input
                value={branchKiTitle}
                onChange={(e) => setBranchKiTitle(e.target.value)}
                placeholder="Which KI or play? (optional)"
                className="h-8 text-[13px]"
              />
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !accountName.trim() || !summary.trim()}
            style={{ background: 'hsl(var(--sv-clay))', color: 'white' }}
          >
            {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving…</> : 'Save call'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
