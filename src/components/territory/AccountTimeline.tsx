/**
 * AccountTimeline — unified reverse-chronological feed of calls + signals for one account.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface AccountTimelineProps {
  accountId: string;
}

type SignalType = 'account' | 'competitive' | 'product' | 'market' | 'strategic';

const TYPE_COLORS: Record<SignalType, string> = {
  account: 'bg-blue-500/15 text-blue-600',
  competitive: 'bg-red-500/15 text-red-600',
  product: 'bg-green-500/15 text-green-600',
  market: 'bg-purple-500/15 text-purple-600',
  strategic: 'bg-orange-500/15 text-orange-600',
};

const TYPE_LABELS: Record<SignalType, string> = {
  account: 'Account Signal',
  competitive: 'Competitive',
  product: 'Branch Product',
  market: 'Market Trend',
  strategic: 'Strategic',
};

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function absoluteDate(dateStr: string): string {
  try { return format(new Date(dateStr), 'PPpp'); } catch { return dateStr; }
}

interface CallLog {
  id: string;
  call_date: string;
  summary: string | null;
  expansion_signal_captured: boolean | null;
  expansion_signal_text: string | null;
  next_step: string | null;
  next_step_date: string | null;
  branch_play_used: boolean | null;
  branch_ki_title: string | null;
}

interface Signal {
  id: string;
  created_at: string;
  raw_text: string;
  signal_type: SignalType;
  source_label: string | null;
}

type Entry =
  | { type: 'call'; date: string; data: CallLog }
  | { type: 'signal'; date: string; data: Signal };

export function AccountTimeline({ accountId }: AccountTimelineProps) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const callsKey = ['call-logs', accountId];
  const signalsKey = ['account_signals', user?.id, accountId];

  const { data: callLogs, isLoading: callsLoading } = useQuery<CallLog[]>({
    queryKey: callsKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('call_logs')
        .select('id, call_date, summary, expansion_signal_captured, expansion_signal_text, next_step, next_step_date, branch_play_used, branch_ki_title')
        .eq('account_id', accountId)
        .order('call_date', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data ?? []) as CallLog[];
    },
  });

  const { data: signals, isLoading: signalsLoading } = useQuery<Signal[]>({
    queryKey: signalsKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_signals')
        .select('id, created_at, raw_text, signal_type, source_label')
        .eq('linked_account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data ?? []) as Signal[];
    },
  });

  const entries: Entry[] = useMemo(() => {
    const callEntries: Entry[] = (callLogs ?? []).map((log) => ({
      type: 'call' as const,
      date: log.call_date ? `${log.call_date}T00:00:00Z` : new Date().toISOString(),
      data: log,
    }));
    const signalEntries: Entry[] = (signals ?? []).map((sig) => ({
      type: 'signal' as const,
      date: sig.created_at,
      data: sig,
    }));
    return [...callEntries, ...signalEntries].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [callLogs, signals]);

  const isLoading = callsLoading || signalsLoading;

  async function deleteCall(id: string) {
    qc.setQueryData<CallLog[]>(callsKey, (prev = []) => prev.filter((c) => c.id !== id));
    const { error } = await supabase.from('call_logs').delete().eq('id', id);
    if (error) qc.invalidateQueries({ queryKey: callsKey });
  }

  async function deleteSignal(id: string) {
    qc.setQueryData<Signal[]>(signalsKey, (prev = []) => prev.filter((s) => s.id !== id));
    const { error } = await supabase.from('account_signals').delete().eq('id', id);
    if (error) qc.invalidateQueries({ queryKey: signalsKey });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Timeline</h3>
          {entries.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {entries.length}
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="h-8 w-8 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 bg-muted rounded" />
                <div className="h-3 w-full bg-muted/60 rounded" />
                <div className="h-3 w-2/3 bg-muted/40 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          No activity logged yet. Use Log Call or Signal Inbox after each customer interaction.
        </div>
      ) : (
        <div className="space-y-0">
          {entries.map((entry, idx) => {
            const isLast = idx === entries.length - 1;
            return entry.type === 'call' ? (
              <CallEntry
                key={`c-${entry.data.id}`}
                entry={entry}
                isLast={isLast}
                onDelete={() => deleteCall(entry.data.id)}
              />
            ) : (
              <SignalEntry
                key={`s-${entry.data.id}`}
                entry={entry}
                isLast={isLast}
                onDelete={() => deleteSignal(entry.data.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CallEntry({
  entry,
  isLast,
  onDelete,
}: {
  entry: Extract<Entry, { type: 'call' }>;
  isLast: boolean;
  onDelete: () => void;
}) {
  const log = entry.data;
  return (
    <div className="group flex gap-3">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm shrink-0">
          📞
        </div>
        {!isLast && <div className="flex-1 w-px bg-border/40 mt-1" />}
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Call logged</span>
          <span
            className="text-[11px] text-muted-foreground"
            title={absoluteDate(entry.date)}
          >
            {formatTimeAgo(entry.date)}
          </span>
          <button
            onClick={onDelete}
            className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
            aria-label="Delete call log"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {log.summary && (
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-3">
            {log.summary}
          </p>
        )}
        {log.expansion_signal_captured && log.expansion_signal_text && (
          <div className="mt-2 flex items-start gap-1.5 text-xs">
            <span className="text-green-600 font-semibold shrink-0">⚡ Signal:</span>
            <span className="text-muted-foreground">{log.expansion_signal_text}</span>
          </div>
        )}
        {log.next_step && (
          <div className="mt-1 flex items-start gap-1.5 text-xs">
            <span className="text-primary font-semibold shrink-0">→</span>
            <span className="text-muted-foreground">
              {log.next_step}
              {log.next_step_date ? ` · by ${log.next_step_date}` : ''}
            </span>
          </div>
        )}
        {log.branch_play_used && log.branch_ki_title && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
              🌿 {log.branch_ki_title}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SignalEntry({
  entry,
  isLast,
  onDelete,
}: {
  entry: Extract<Entry, { type: 'signal' }>;
  isLast: boolean;
  onDelete: () => void;
}) {
  const sig = entry.data;
  return (
    <div className="group flex gap-3">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm shrink-0">
          📡
        </div>
        {!isLast && <div className="flex-1 w-px bg-border/40 mt-1" />}
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              'text-[10px] font-bold px-2 py-0.5 rounded-full',
              TYPE_COLORS[sig.signal_type] ?? TYPE_COLORS.strategic
            )}
          >
            {TYPE_LABELS[sig.signal_type] ?? 'Signal'}
          </span>
          <span
            className="text-[11px] text-muted-foreground"
            title={absoluteDate(entry.date)}
          >
            {formatTimeAgo(entry.date)}
          </span>
          {sig.source_label && (
            <span className="text-[11px] text-muted-foreground">· {sig.source_label}</span>
          )}
          <button
            onClick={onDelete}
            className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
            aria-label="Delete signal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-3 whitespace-pre-wrap">
          {sig.raw_text}
        </p>
      </div>
    </div>
  );
}

export default AccountTimeline;
