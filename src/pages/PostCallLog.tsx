import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fromActiveAccounts } from '@/data/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { SafePage } from '@/components/SafePage';
import { ChevronLeft, Check, Loader2 } from 'lucide-react';

interface Account {
  id: string;
  name: string;
  account_status: string | null;
}

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export default function PostCallLog() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>(params.get('accountId') ?? '');
  const [summary, setSummary] = useState('');
  const [expansionOn, setExpansionOn] = useState(false);
  const [expansionText, setExpansionText] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextStepDate, setNextStepDate] = useState(plusDays(7));
  const [playOn, setPlayOn] = useState(false);
  const [playTitle, setPlayTitle] = useState('');
  const [queueTranscript, setQueueTranscript] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const account = useMemo(() => accounts.find(a => a.id === accountId) || null, [accounts, accountId]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await fromActiveAccounts()
        .select('id, name, account_status')
        .eq('user_id', user.id)
        .order('name')
        .limit(50);
      setAccounts((data ?? []) as Account[]);
    })();
  }, [user]);

  const canSubmit = accountId && summary.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!user || !canSubmit || !account) return;
    setSubmitting(true);

    const payload = {
      user_id: user.id,
      account_id: accountId,
      account_name: account.name,
      call_date: new Date().toISOString().split('T')[0],
      summary: summary.trim(),
      expansion_signal_captured: expansionOn,
      expansion_signal_text: expansionOn ? expansionText.trim() || null : null,
      next_step: nextStep.trim() || null,
      next_step_date: nextStep.trim() ? nextStepDate : null,
      branch_play_used: playOn,
      branch_ki_title: playOn ? playTitle.trim() || null : null,
      queue_transcript: queueTranscript,
    };

    try {
      const { error } = await (supabase as any).from('call_logs').insert(payload);
      if (error) throw error;

      // Update account last_touch_date + next_step
      const accountUpdate: any = { last_touch_date: payload.call_date };
      if (payload.next_step) accountUpdate.next_step = payload.next_step;
      await supabase.from('accounts').update(accountUpdate).eq('id', accountId);

      toast.success('Logged ✓');
      setDone(true);
      setTimeout(() => navigate('/outreach'), 1500);
    } catch (err: any) {
      // Offline / failure → queue locally
      try {
        const key = 'call_log_queue';
        const prev = JSON.parse(localStorage.getItem(key) || '[]');
        localStorage.setItem(key, JSON.stringify([{ ...payload, queued_at: new Date().toISOString() }, ...prev]));
        toast.success('Saved locally — will sync when online');
        setDone(true);
        setTimeout(() => navigate('/outreach'), 1500);
      } catch {
        toast.error('Could not save. Try again.');
        setSubmitting(false);
      }
    }
  };

  if (done) {
    return (
      <SafePage className="flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
            <Check className="h-8 w-8 text-green-500" />
          </div>
          <p className="text-base font-semibold">Logged ✓</p>
        </div>
      </SafePage>
    );
  }

  return (
    <SafePage className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Post-Call Log</p>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 max-w-lg w-full mx-auto pb-24">
        {/* Account */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account *</label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder={accounts.length ? 'Select an account' : 'Loading…'} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary *</label>
          <Textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="What happened on the call? (1-3 sentences)"
            rows={3}
            autoFocus
            className="text-base"
          />
        </div>

        {/* Expansion signal */}
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold">Expansion signal captured?</label>
            <Switch checked={expansionOn} onCheckedChange={setExpansionOn} />
          </div>
          {expansionOn && (
            <Input
              value={expansionText}
              onChange={e => setExpansionText(e.target.value)}
              placeholder="e.g. They're launching a new loyalty app in Q3"
              className="h-12 text-base"
            />
          )}
        </div>

        {/* Next step */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next step</label>
          <Input
            value={nextStep}
            onChange={e => setNextStep(e.target.value)}
            placeholder="e.g. Send Branch deep linking overview to Sarah"
            className="h-12 text-base"
          />
          <Input
            type="date"
            value={nextStepDate}
            onChange={e => setNextStepDate(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        {/* Branch play */}
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold">Used a Branch play?</label>
            <Switch checked={playOn} onCheckedChange={setPlayOn} />
          </div>
          {playOn && (
            <Input
              value={playTitle}
              onChange={e => setPlayTitle(e.target.value)}
              placeholder="e.g. Expansion hypothesis opener"
              className="h-12 text-base"
            />
          )}
        </div>

        {/* Queue transcript */}
        <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
          <div>
            <p className="text-sm font-semibold">Upload transcript for AI grading?</p>
            <p className="text-[11px] text-muted-foreground">Upload happens later in Coach</p>
          </div>
          <Switch checked={queueTranscript} onCheckedChange={setQueueTranscript} />
        </div>
      </div>

      {/* Sticky submit */}
      <div className="border-t border-border/40 bg-background px-4 py-3 pb-safe">
        <div className="max-w-lg mx-auto">
          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full h-12 text-base">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Logging…</> : 'Log Call'}
          </Button>
        </div>
      </div>
    </SafePage>
  );
}
