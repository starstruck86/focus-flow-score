import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Radio } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fromActiveAccounts } from '@/data/accounts';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Head = 'sales' | 'competitive' | 'product' | 'market';

interface SignalRow {
  id: string;
  raw_text: string;
  signal_type: string;
  intelligence_head: Head;
  implications: string | null;
  linked_account_id: string | null;
  linked_account_name: string | null;
  source_label: string | null;
  source_url: string | null;
  created_at: string;
}

interface Classification {
  intelligence_head: Head;
  signal_type: string;
  implications: string;
  confidence: number;
}

const HEAD_META: Record<Head, { label: string; border: string; badge: string }> = {
  sales:       { label: 'SALES',       border: 'border-l-blue-500',   badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  competitive: { label: 'COMPETITIVE', border: 'border-l-rose-500',   badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  product:     { label: 'PRODUCT',     border: 'border-l-green-500',  badge: 'bg-green-500/15 text-green-700 dark:text-green-300' },
  market:      { label: 'MARKET',      border: 'border-l-amber-500',  badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};

export default function SignalInbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [rawText, setRawText] = useState('');
  const [linkedAccount, setLinkedAccount] = useState<string>('none');
  const [sourceLabel, setSourceLabel] = useState('');
  const [classifying, setClassifying] = useState(false);
  const [lastResult, setLastResult] = useState<{ signal: SignalRow; classification: Classification } | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['signal-inbox-accounts', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await fromActiveAccounts().select('id, name').order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const queryKey = ['account_signals_feed', user?.id];
  const { data: signals = [] } = useQuery<SignalRow[]>({
    queryKey,
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as SignalRow[];
    },
  });

  const accountName = useMemo(() => {
    if (linkedAccount === 'none') return null;
    return accounts.find(a => a.id === linkedAccount)?.name ?? null;
  }, [linkedAccount, accounts]);

  async function handleClassify() {
    if (!user || !rawText.trim() || classifying) return;
    setClassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('classify-signal', {
        body: {
          rawText: rawText.trim(),
          userId: user.id,
          accountId: linkedAccount === 'none' ? null : linkedAccount,
          accountName,
          sourceLabel: sourceLabel.trim() || null,
        },
      });
      if (error) throw error;
      if (!data?.signal) throw new Error('No signal returned');
      setLastResult(data as { signal: SignalRow; classification: Classification });
      qc.setQueryData<SignalRow[]>(queryKey, (prev = []) => [data.signal as SignalRow, ...prev].slice(0, 20));
      toast.success('Signal classified and saved');
    } catch (e) {
      console.error(e);
      toast.error('Could not classify signal');
    } finally {
      setClassifying(false);
    }
  }

  function resetForm() {
    setRawText('');
    setSourceLabel('');
    setLinkedAccount('none');
    setLastResult(null);
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">Signal Inbox</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Paste anything. Claude classifies and routes it.
          </p>
        </header>

        {!lastResult && (
          <Card className="p-4 space-y-3">
            <Textarea
              placeholder="Paste a news headline, LinkedIn post, earnings excerpt, contact change, competitor announcement…"
              rows={4}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="text-sm"
            />

            <Select value={linkedAccount} onValueChange={setLinkedAccount}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Link to account (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No account —</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              placeholder="Source (optional): LinkedIn, Earnings Call, TechCrunch…"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              className="h-9 text-sm"
            />

            <Button
              onClick={handleClassify}
              disabled={!rawText.trim() || classifying}
              className="w-full"
            >
              {classifying ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Classifying…</>
              ) : (
                'Classify & Save →'
              )}
            </Button>
          </Card>
        )}

        {lastResult && (
          <Card className={cn('p-4 space-y-3 border-l-4', HEAD_META[lastResult.classification.intelligence_head].border)}>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={HEAD_META[lastResult.classification.intelligence_head].badge}>
                {HEAD_META[lastResult.classification.intelligence_head].label}
              </Badge>
              <span className="text-xs text-muted-foreground">{lastResult.classification.signal_type}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {Math.round(lastResult.classification.confidence * 100)}% confidence
              </span>
            </div>
            {lastResult.classification.implications && (
              <p className="text-sm font-semibold">{lastResult.classification.implications}</p>
            )}
            {lastResult.signal.linked_account_name && (
              <p className="text-xs text-muted-foreground">→ {lastResult.signal.linked_account_name}</p>
            )}
            <p className="text-xs text-muted-foreground">Saved to Signal Inbox ✓</p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={resetForm}>Add Another Signal</Button>
              <Button size="sm" onClick={() => { setLastResult(null); }}>View Feed</Button>
            </div>
          </Card>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Recent Signals
          </h2>
          {signals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No signals yet — paste your first one above.
            </p>
          ) : (
            signals.map((s) => {
              const meta = HEAD_META[s.intelligence_head] ?? HEAD_META.sales;
              return (
                <Card key={s.id} className={cn('p-3 space-y-2 border-l-4', meta.border)}>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Badge className={meta.badge}>{meta.label}</Badge>
                    <span className="text-muted-foreground">{s.signal_type}</span>
                    {s.linked_account_name && (
                      <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">
                        {s.linked_account_name}
                      </span>
                    )}
                    <span className="text-muted-foreground ml-auto">
                      {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {s.implications && (
                    <p className="text-sm font-medium">{s.implications}</p>
                  )}
                  <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                    {s.raw_text}
                  </p>
                  {s.source_label && (
                    <p className="text-[11px] text-muted-foreground">Source: {s.source_label}</p>
                  )}
                </Card>
              );
            })
          )}
        </section>

        <div className="pt-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/outreach')}>
            ← Back to Territory
          </Button>
        </div>
      </div>
    </div>
  );
}
