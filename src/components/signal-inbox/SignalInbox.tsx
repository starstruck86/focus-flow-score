import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Radio, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fromActiveAccounts } from '@/data/accounts';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type SignalType = 'account' | 'competitive' | 'product' | 'market' | 'strategic';
type IntelligenceHead = 'sales' | 'product' | 'competitive' | 'market';

interface SignalRow {
  id: string;
  raw_text: string;
  signal_type: SignalType;
  intelligence_head: IntelligenceHead;
  linked_account_id: string | null;
  linked_account_name: string | null;
  source_label: string | null;
  source_url: string | null;
  created_at: string;
}

const TYPE_META: Record<SignalType, { label: string; head: IntelligenceHead; color: string }> = {
  account:     { label: 'Account Signal',  head: 'sales',       color: 'bg-blue-500/15 text-blue-600' },
  competitive: { label: 'Competitive',     head: 'competitive', color: 'bg-red-500/15 text-red-600' },
  product:     { label: 'Branch Product',  head: 'product',     color: 'bg-green-500/15 text-green-600' },
  market:      { label: 'Market Trend',    head: 'market',      color: 'bg-purple-500/15 text-purple-600' },
  strategic:   { label: 'Strategic',       head: 'sales',       color: 'bg-orange-500/15 text-orange-600' },
};

const HEAD_LABEL: Record<IntelligenceHead, string> = {
  sales: 'Sales Intel',
  product: 'Product Intel',
  competitive: 'Competitive Intel',
  market: 'Market Intel',
};

function classifySignal(text: string): { signal_type: SignalType; intelligence_head: IntelligenceHead } {
  const t = text.toLowerCase();
  if (/adjust|appsflyer|kochava|singular|airbridge|skadnetwork|skan|mmp\s+switch|vs\s+branch|alternative\s+to\s+branch|competitor|evaluate.*branch|considering.*adjust/.test(t)) {
    return { signal_type: 'competitive', intelligence_head: 'competitive' };
  }
  if (/branch\s+(sdk|product|feature|update|release|launches|adds|new|deep.?link|attribution|universal.?ads|aio|email.?to.?app|sms|web.?to.?app|qr|advanced.?privacy)|privacy.?sdk|fingerprint|probabilistic/.test(t)) {
    return { signal_type: 'product', intelligence_head: 'product' };
  }
  if (/ios.?(18|17)|android|att|privacy|cookie|gdpr|ccpa|cpra|app.?store|regulation|market.?trend|industry|mobile.?measurement|user.?acquisition|retargeting|re-engagement/.test(t)) {
    return { signal_type: 'market', intelligence_head: 'market' };
  }
  if (/cmo|cto|ceo|svp|vp|director|hires|joins|leaves|launches|announces|acquisition|acquires|merger|partners|partnership|funding|ipo|quarterly|earnings|loyal|app.?launch|rebrand/.test(t)) {
    return { signal_type: 'account', intelligence_head: 'sales' };
  }
  return { signal_type: 'strategic', intelligence_head: 'sales' };
}

interface SignalInboxProps {
  accountId?: string;
  compact?: boolean;
}

export function SignalInbox({ accountId, compact = false }: SignalInboxProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [type, setType] = useState<SignalType>('strategic');
  const [linkedAccount, setLinkedAccount] = useState<string>(accountId ?? 'none');
  const [sourceLabel, setSourceLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { if (accountId) setLinkedAccount(accountId); }, [accountId]);

  // Auto-classify as user types (debounced by React's render cadence)
  useEffect(() => {
    if (!text.trim()) return;
    const { signal_type } = classifySignal(text);
    setType(signal_type);
  }, [text]);

  const { data: accounts = [] } = useQuery({
    queryKey: ['signal-inbox-accounts', user?.id],
    enabled: !!user && !accountId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await fromActiveAccounts().select('id, name').order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const queryKey = ['account_signals', user?.id, accountId ?? 'all'];

  const { data: signals = [] } = useQuery<SignalRow[]>({
    queryKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase.from('account_signals').select('*').order('created_at', { ascending: false }).limit(100);
      if (accountId) q = q.eq('linked_account_id', accountId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SignalRow[];
    },
  });

  const accountName = useMemo(() => {
    if (!linkedAccount || linkedAccount === 'none') return null;
    return accounts.find(a => a.id === linkedAccount)?.name ?? null;
  }, [linkedAccount, accounts]);

  async function handleSubmit() {
    if (!user || !text.trim() || submitting) return;
    setSubmitting(true);
    const meta = TYPE_META[type];
    const payload = {
      user_id: user.id,
      raw_text: text.trim(),
      signal_type: type,
      intelligence_head: meta.head,
      linked_account_id: linkedAccount && linkedAccount !== 'none' ? linkedAccount : null,
      linked_account_name: accountName,
      source_label: sourceLabel.trim() || null,
    };

    const optimistic: SignalRow = {
      id: `tmp-${Date.now()}`,
      raw_text: payload.raw_text,
      signal_type: payload.signal_type,
      intelligence_head: payload.intelligence_head,
      linked_account_id: payload.linked_account_id,
      linked_account_name: payload.linked_account_name,
      source_label: payload.source_label,
      source_url: null,
      created_at: new Date().toISOString(),
    };
    qc.setQueryData<SignalRow[]>(queryKey, (prev = []) => [optimistic, ...prev]);

    const { data, error } = await supabase.from('account_signals').insert(payload).select().single();
    setSubmitting(false);
    if (error) {
      qc.setQueryData<SignalRow[]>(queryKey, (prev = []) => prev.filter(s => s.id !== optimistic.id));
      toast.error('Could not save signal');
      return;
    }
    qc.setQueryData<SignalRow[]>(queryKey, (prev = []) =>
      [data as SignalRow, ...prev.filter(s => s.id !== optimistic.id)]
    );
    setText('');
    setSourceLabel('');
    toast.success('Signal logged');
  }

  async function handleDelete(id: string) {
    qc.setQueryData<SignalRow[]>(queryKey, (prev = []) => prev.filter(s => s.id !== id));
    const { error } = await supabase.from('account_signals').delete().eq('id', id);
    if (error) {
      toast.error('Could not delete');
      qc.invalidateQueries({ queryKey });
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Signal Inbox</h3>
          <span className="text-xs text-muted-foreground">📡 paste anything</span>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste anything — article excerpt, LinkedIn post, competitive mention, customer quote, earnings call snippet..."
          className={cn(compact ? 'min-h-[80px]' : 'min-h-[120px]', 'text-sm')}
        />

        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TYPE_META) as SignalType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-full border transition-all',
                type === t
                  ? `${TYPE_META[t].color} border-transparent`
                  : 'border-border/60 text-muted-foreground hover:border-primary/40'
              )}
            >
              {TYPE_META[t].label}
            </button>
          ))}
        </div>

        {text.trim().length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Routes to:</span>
            <span className={cn(
              'px-2 py-0.5 rounded-full font-medium text-[10px]',
              type === 'competitive' ? 'bg-red-500/15 text-red-600' :
              type === 'product' ? 'bg-green-500/15 text-green-600' :
              type === 'market' ? 'bg-purple-500/15 text-purple-600' :
              'bg-blue-500/15 text-blue-600'
            )}>
              {HEAD_LABEL[TYPE_META[type].head]} →
            </span>
            <span className="text-muted-foreground/60">auto-classified</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          {!accountId && (
            <Select value={linkedAccount} onValueChange={setLinkedAccount}>
              <SelectTrigger className="h-9 text-xs flex-1">
                <SelectValue placeholder="Link to account (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No account —</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder="Source (e.g. LinkedIn, TechCrunch, Earnings call)"
            className="h-9 text-xs flex-1"
          />
          <Button
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            size="sm"
            className="h-9"
          >
            {submitting ? 'Saving…' : 'Log Signal'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {signals.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No signals yet — paste your first one above
          </div>
        ) : (
          signals.map((s) => {
            const meta = TYPE_META[s.signal_type];
            const isExpanded = expanded.has(s.id);
            const isLong = s.raw_text.length > 240;
            const displayText = isLong && !isExpanded ? s.raw_text.slice(0, 240) + '…' : s.raw_text;
            return (
              <div
                key={s.id}
                className="group rounded-lg border border-border bg-card p-3 space-y-2 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className={cn('px-2 py-0.5 rounded-full font-medium', meta.color)}>
                    {meta.label}
                  </span>
                  <span className="text-muted-foreground">{HEAD_LABEL[s.intelligence_head]}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                  </span>
                  {s.linked_account_name && !accountId && (
                    <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80 text-[11px]">
                      {s.linked_account_name}
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    aria-label="Delete signal"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p
                  className={cn('text-sm whitespace-pre-wrap cursor-pointer', compact && 'text-xs')}
                  onClick={() => {
                    if (!isLong) return;
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                      return next;
                    });
                  }}
                >
                  {displayText}
                </p>
                {s.source_label && (
                  <p className="text-[11px] text-muted-foreground">Source: {s.source_label}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default SignalInbox;
