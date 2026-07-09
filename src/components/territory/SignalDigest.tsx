/**
 * SignalDigest — Digest tab card list (W1.5 v2).
 *
 * Card contract:
 *  - Implications / so-what render as the PRIMARY (headline) content — never truncated.
 *  - raw_text renders below as supporting evidence (line-clamped).
 *  - Visible date = observed_at (fallback created_at).
 *  - signal_class badge: window (amber) / specimen (yellow) / evergreen (muted).
 *  - Source chip: source_label → source_url.
 *  - Actions: Prep (Account Strategy), View account, Archive (session-local).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { format, subDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loader2, ExternalLink, Archive as ArchiveIcon, ArrowRight, Building2 } from 'lucide-react';

const SIGNAL_COLORS: Record<string, string> = {
  competitive: 'bg-red-500/15 text-red-600',
  product: 'bg-blue-500/15 text-blue-600',
  market: 'bg-purple-500/15 text-purple-600',
  account: 'bg-green-500/15 text-green-600',
  strategic: 'bg-amber-500/15 text-amber-600',
};

// Same tone system as the Account Room cards.
const CLASS_STYLES: Record<string, { label: string; className: string }> = {
  window: { label: 'Window', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  specimen: { label: 'Specimen', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30' },
  evergreen: { label: 'Evergreen', className: 'bg-muted text-muted-foreground border-border' },
};

const ARCHIVE_KEY = 'signal-digest.archived.v1';

function loadArchived(): Set<string> {
  try {
    const raw = sessionStorage.getItem(ARCHIVE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistArchived(set: Set<string>) {
  try {
    sessionStorage.setItem(ARCHIVE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* noop */
  }
}

// Strip leftover bracket artifacts like [FYI], [source], [1] from display copy.
function stripBrackets(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\[[^\]]{0,40}\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function SignalDigest() {
  const navigate = useNavigate();
  const [signalSynthesis, setSignalSynthesis] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [archived, setArchived] = useState<Set<string>>(() => loadArchived());

  useEffect(() => { persistArchived(archived); }, [archived]);

  const { data: signals } = useQuery({
    queryKey: ['signal-digest'],
    queryFn: async () => {
      const since = subDays(new Date(), 7).toISOString();
      const { data } = await (supabase as any)
        .from('account_signals')
        .select('id, signal_type, signal_class, raw_text, implications, observed_at, created_at, source_label, source_url, linked_account_id, accounts(name, tier)')
        .gte('created_at', since)
        .order('observed_at', { ascending: false, nullsFirst: false });
      return (data ?? []) as any[];
    },
    staleTime: 60_000,
  });

  const visibleSignals = useMemo(
    () => (signals ?? []).filter((s) => !archived.has(s.id)),
    [signals, archived],
  );

  const synthesizeSignals = async () => {
    if (!visibleSignals || visibleSignals.length === 0) return;
    setSynthesizing(true);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `You are analyzing territory signals for a Branch.io expansion AE.\n\nSignals: ${JSON.stringify(visibleSignals)}\n\nIn 2-3 sentences, tell the AE what these signals mean for their territory this week and what they should do about them. Be specific about account names and actions. Plain text only, no markdown.`,
          }],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text ?? '';
      setSignalSynthesis(text.trim());
    } catch (e) {
      console.error('[SignalDigest] synthesize failed', e);
    } finally {
      setSynthesizing(false);
    }
  };

  if (!signals) return <div className="text-center py-8 text-sm text-muted-foreground">Loading digest…</div>;
  if (visibleSignals.length === 0)
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-sm text-muted-foreground">
          {signals.length === 0 ? 'No signals logged in the last 7 days.' : 'All signals archived for this session.'}
        </p>
        <p className="text-xs text-muted-foreground">Paste signals in Signal Inbox to build intelligence.</p>
      </div>
    );

  const grouped: Record<string, { accountName: string; tier: string | null; accountId: string | null; signals: any[] }> = {};
  visibleSignals.forEach((s) => {
    const id = s.linked_account_id ?? '__unlinked__';
    const acct = s.accounts;
    if (!grouped[id]) {
      grouped[id] = {
        accountName: acct?.name ?? 'Unlinked Signal',
        tier: acct?.tier ?? null,
        accountId: s.linked_account_id,
        signals: [],
      };
    }
    grouped[id].signals.push(s);
  });

  const entries = Object.values(grouped).sort((a, b) => b.signals.length - a.signals.length);
  const typeCount: Record<string, number> = {};
  visibleSignals.forEach((s) => { typeCount[s.signal_type] = (typeCount[s.signal_type] ?? 0) + 1; });

  const handleArchive = (id: string) => {
    setArchived((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {signalSynthesis ? (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">
            🔔 Signal Intelligence
          </p>
          <p className="text-xs leading-relaxed text-foreground">{signalSynthesis}</p>
        </div>
      ) : visibleSignals.length > 0 && !synthesizing ? (
        <button onClick={synthesizeSignals} className="text-xs text-primary">Synthesize signals →</button>
      ) : synthesizing ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Interpreting signals...
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 items-center text-[11px]">
        <span className="font-semibold text-muted-foreground">
          Last 7 days: {visibleSignals.length} signal{visibleSignals.length !== 1 ? 's' : ''} across {entries.length} account{entries.length !== 1 ? 's' : ''}
        </span>
        {Object.entries(typeCount).map(([type, count]) => (
          <span
            key={type}
            className={cn('px-2 py-0.5 rounded-full font-medium', SIGNAL_COLORS[type] ?? 'bg-muted text-muted-foreground')}
          >
            {type}: {count}
          </span>
        ))}
      </div>

      {entries.map((group) => (
        <div key={group.accountId ?? 'unlinked'} className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            className={cn(
              'flex items-center justify-between px-4 py-2.5 border-b border-border/40',
              group.accountId && 'cursor-pointer hover:bg-muted/20 transition-colors',
            )}
            onClick={() => group.accountId && navigate(`/accounts/${group.accountId}`)}
          >
            <div className="flex items-center gap-2">
              {group.tier && (
                <span
                  className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0',
                    group.tier === 'A' ? 'bg-green-500/15 text-green-600' :
                    group.tier === 'B' ? 'bg-amber-500/15 text-amber-600' :
                    'bg-muted text-muted-foreground',
                  )}
                >{group.tier}</span>
              )}
              <h3 className="text-sm font-semibold">{group.accountName}</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {group.signals.length} signal{group.signals.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {group.signals.map((signal) => {
              const cls = CLASS_STYLES[signal.signal_class as string] ?? null;
              const dateSrc = signal.observed_at ?? signal.created_at;
              const soWhat = stripBrackets(signal.implications);
              const raw = stripBrackets(signal.raw_text);
              return (
                <div key={signal.id} className="px-4 py-3 space-y-2">
                  {/* Meta row: type + class + date */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', SIGNAL_COLORS[signal.signal_type] ?? 'bg-muted text-muted-foreground')}>
                      {signal.signal_type}
                    </span>
                    {cls && (
                      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', cls.className)}>
                        {cls.label}
                      </span>
                    )}
                    {dateSrc && (
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(dateSrc), 'MMM d')}
                      </span>
                    )}
                  </div>

                  {/* Primary content: the so-what — full text, never truncated */}
                  {soWhat ? (
                    <p className="text-sm font-medium text-foreground leading-snug">{soWhat}</p>
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground italic leading-snug">
                      No implications captured — add a so-what to make this signal actionable.
                    </p>
                  )}

                  {/* Supporting raw text (truncatable) */}
                  {raw && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">{raw}</p>
                  )}

                  {/* Source chip */}
                  {signal.source_label && (
                    signal.source_url ? (
                      <a
                        href={signal.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        {signal.source_label}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        {signal.source_label}
                      </span>
                    )
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-1">
                    {group.accountId && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/strategy?account=${group.accountId}`); }}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                        >
                          <ArrowRight className="h-3 w-3" /> Prep
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/accounts/${group.accountId}`); }}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-muted text-foreground hover:bg-muted/70 transition-colors"
                        >
                          <Building2 className="h-3 w-3" /> View account
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleArchive(signal.id); }}
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors ml-auto"
                      title="Archive for this session"
                    >
                      <ArchiveIcon className="h-3 w-3" /> Archive
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
