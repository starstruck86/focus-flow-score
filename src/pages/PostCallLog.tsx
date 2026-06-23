import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fromActiveAccounts } from '@/data/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [contactName, setContactName] = useState('');
  const [summary, setSummary] = useState('');
  const [expansionOn, setExpansionOn] = useState(false);
  const [expansionText, setExpansionText] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextStepDate, setNextStepDate] = useState(plusDays(7));
  const [suggestingNextStep, setSuggestingNextStep] = useState(false);
  const [playOn, setPlayOn] = useState(false);
  const [playTitle, setPlayTitle] = useState('');
  const [playOther, setPlayOther] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const account = useMemo(() => accounts.find(a => a.id === accountId) || null, [accounts, accountId]);

  const { data: playbookOptions } = useQuery({
    queryKey: ['playbook-titles'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('playbooks')
        .select('id, title')
        .order('title');
      return (data ?? []) as { id: string; title: string }[];
    },
  });

  const selectedPlaybookId = useMemo(() => {
    if (!playOn || playTitle === '__other__') return null;
    return (playbookOptions ?? []).find(p => p.title === playTitle)?.id ?? null;
  }, [playOn, playTitle, playbookOptions]);

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

  const suggestNextStep = async () => {
    if (!summary.trim()) return;
    setSuggestingNextStep(true);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: `Based on this sales call summary, suggest ONE specific next step (10-15 words max, action + deadline):

Call summary: "${summary}"
Account: ${account?.name ?? 'unknown'}

Respond with ONLY the next step text, nothing else.`,
          }],
        }),
      });
      const data = await res.json();
      const suggestion = data.content?.[0]?.text?.trim();
      if (suggestion) setNextStep(suggestion);
    } catch (e) {
      console.error('Next step suggestion failed', e);
    } finally {
      setSuggestingNextStep(false);
    }
  };

  const handleSubmit = async () => {
    if (!user || !canSubmit || !account) return;
    setSubmitting(true);

    const finalPlayTitle = playOn
      ? (playTitle === '__other__' ? playOther.trim() : playTitle).trim() || null
      : null;

    const payload = {
      user_id: user.id,
      account_id: accountId,
      account_name: account.name,
      contact_name: contactName.trim() || null,
      call_date: new Date().toISOString().split('T')[0],
      summary: summary.trim(),
      expansion_signal_captured: expansionOn,
      expansion_signal_text: expansionOn ? expansionText.trim() || null : null,
      next_step: nextStep.trim() || null,
      next_step_date: nextStep.trim() ? nextStepDate : null,
      branch_play_used: playOn,
      branch_ki_title: finalPlayTitle,
    };

    try {
      const { data: inserted, error } = await (supabase as any)
        .from('call_logs')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;

      // Update account last_touch_date + next_step + next_touch_due
      const accountUpdate: any = { last_touch_date: payload.call_date };
      if (payload.next_step) accountUpdate.next_step = payload.next_step;
      if (payload.next_step_date && payload.next_step) {
        accountUpdate.next_touch_due = payload.next_step_date;
      }
      await supabase.from('accounts').update(accountUpdate).eq('id', accountId);

      // Fire-and-forget: log playbook usage event
      if (selectedPlaybookId && finalPlayTitle) {
        try {
          await (supabase as any).from('playbook_usage_events').insert({
            user_id: user.id,
            playbook_id: selectedPlaybookId,
            playbook_title: finalPlayTitle,
            event_type: 'used_on_call',
            context_account_id: accountId,
            metadata: { call_log_id: inserted?.id ?? null },
          });
        } catch (e) {
          console.warn('playbook_usage_events insert failed (ignored)', e);
        }
      }

      toast.success('Logged ✓');
      setSubmitted(true);
      setDone(true);
    } catch (err: any) {
      // Offline / failure → queue locally
      try {
        const key = 'call_log_queue';
        const prev = JSON.parse(localStorage.getItem(key) || '[]');
        localStorage.setItem(key, JSON.stringify([{ ...payload, queued_at: new Date().toISOString() }, ...prev]));
        toast.success('Saved locally — will sync when online');
        setSubmitted(true);
        setDone(true);
      } catch {
        toast.error('Could not save. Try again.');
        setSubmitting(false);
      }
    }
  };

  if (done) {
    return (
      <SafePage className="flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
              <Check className="h-8 w-8 text-green-500" />
            </div>
            <p className="text-base font-semibold">Logged ✓</p>
          </div>
        </div>
        {submitted && (
          <div className="fixed inset-x-0 bottom-0 bg-background border-t border-border px-4 py-4 space-y-2 z-40">
            <p className="text-sm font-semibold text-center">Call logged ✓</p>
            <div className="grid grid-cols-2 gap-2 max-w-lg mx-auto w-full">
              <Button
                variant="outline"
                onClick={() => navigate('/outreach')}
                className="h-11"
              >
                Back to Territory
              </Button>
              <Button
                onClick={() => navigate('/coach')}
                className="h-11 bg-green-600 hover:bg-green-700 text-white"
              >
                🌿 Grade It in Coach
              </Button>
            </div>
          </div>
        )}
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

        {/* Contact name */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact Name</Label>
          <Input
            placeholder="e.g. Sarah Chen, VP Marketing"
            value={contactName}
            onChange={e => setContactName(e.target.value)}
            className="h-10"
          />
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
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next Step</Label>
            <button
              onClick={suggestNextStep}
              disabled={!summary.trim() || suggestingNextStep}
              className="text-[11px] text-primary hover:text-primary/80 disabled:opacity-40 flex items-center gap-1"
            >
              {suggestingNextStep ? <Loader2 className="h-3 w-3 animate-spin" /> : '✨'} Suggest
            </button>
          </div>
          <Input
            placeholder="e.g. Send pricing deck by Friday"
            value={nextStep}
            onChange={e => setNextStep(e.target.value)}
            className="h-10"
          />
          <Input
            type="date"
            value={nextStepDate}
            onChange={e => setNextStepDate(e.target.value)}
            className="h-10"
          />
        </div>

        {/* Branch play */}
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold">Used a Branch play?</label>
            <Switch checked={playOn} onCheckedChange={setPlayOn} />
          </div>
          {playOn && (
            <>
              <Select value={playTitle} onValueChange={setPlayTitle}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="Select a Branch play..." />
                </SelectTrigger>
                <SelectContent>
                  {(playbookOptions ?? []).map(p => (
                    <SelectItem key={p.id} value={p.title}>{p.title}</SelectItem>
                  ))}
                  <SelectItem value="__other__">Other (not in playbooks)</SelectItem>
                </SelectContent>
              </Select>
              {playTitle === '__other__' && (
                <Input
                  value={playOther}
                  onChange={e => setPlayOther(e.target.value)}
                  placeholder="Describe the play"
                  className="h-12 text-base"
                />
              )}
            </>
          )}
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
