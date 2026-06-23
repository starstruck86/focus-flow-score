import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Briefing {
  headline?: string;
  must_touch?: { account: string; reason: string; action: string }[];
  signals_to_act_on?: { account: string; signal: string; recommended_play: string }[];
  watch_list?: string[];
}

const CACHE_KEY = `territory_briefing_${new Date().toISOString().split('T')[0]}`;

export function ThisWeekPanel() {
  const [expanded, setExpanded] = useState(true);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);

  const generateBriefing = useCallback(async () => {
    setLoading(true);
    try {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      const nowIso = new Date().toISOString();
      const [accountsRes, signalsRes, overdueRes] = await Promise.all([
        (supabase as any)
          .from('active_accounts')
          .select('id, name, tier, next_touch_due, next_step, icp_fit_score, last_touch_date')
          .order('tier')
          .limit(10),
        (supabase as any)
          .from('account_signals')
          .select('id, linked_account_id, signal_type, created_at, raw_text, implications, accounts(name)')
          .gte('created_at', fourteenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(10),
        (supabase as any)
          .from('active_accounts')
          .select('id, name, tier, next_touch_due, next_step')
          .lt('next_touch_due', nowIso)
          .not('next_touch_due', 'is', null)
          .order('next_touch_due')
          .limit(5),
      ]);

      const accounts = accountsRes.data ?? [];
      const signals = signalsRes.data ?? [];
      const overdue = overdueRes.data ?? [];

      const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `You are a sales territory intelligence assistant for a Branch.io expansion AE with a $1.4M quota.

Territory data:
- Accounts: ${JSON.stringify(accounts.slice(0, 10))}
- Recent signals (last 14 days): ${JSON.stringify(signals)}
- Overdue touches: ${JSON.stringify(overdue)}
- Today: ${today}

Generate a concise "This Week" territory briefing. Return ONLY valid JSON, no markdown:
{
  "headline": "one sentence summary of the week's territory state",
  "must_touch": [
    { "account": "account name", "reason": "specific reason why this week", "action": "concrete next action" }
  ],
  "signals_to_act_on": [
    { "account": "name", "signal": "what happened", "recommended_play": "what to do" }
  ],
  "watch_list": ["account name — why it needs attention"]
}

must_touch: max 3 accounts. signals_to_act_on: max 2. watch_list: max 2. Be specific and tactical.`,
          }],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text ?? '{}';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as Briefing;
      setBriefing(parsed);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(parsed)); } catch {}
    } catch (e) {
      console.error('[ThisWeekPanel] generate failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        setBriefing(JSON.parse(cached));
        return;
      }
    } catch {}
    generateBriefing();
  }, [generateBriefing]);

  return (
    <div className="px-0 pt-3 pb-3">
      <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-bold shrink-0">🗓 This Week</span>
            {briefing?.headline && (
              <span className="text-[11px] text-muted-foreground line-clamp-1 max-w-[260px]">
                {briefing.headline}
              </span>
            )}
          </div>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-border/40">
            {loading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Synthesizing territory...
              </div>
            ) : briefing ? (
              <>
                {briefing.must_touch && briefing.must_touch.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Must Touch</p>
                    {briefing.must_touch.map((item, i) => (
                      <div key={i} className="rounded-lg bg-primary/5 border border-primary/15 p-2.5">
                        <p className="text-xs font-semibold">{item.account}</p>
                        <p className="text-[11px] text-muted-foreground">{item.reason}</p>
                        <p className="text-[11px] text-primary mt-0.5">→ {item.action}</p>
                      </div>
                    ))}
                  </div>
                )}
                {briefing.signals_to_act_on && briefing.signals_to_act_on.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Act On Signals</p>
                    {briefing.signals_to_act_on.map((item, i) => (
                      <div key={i} className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-2.5">
                        <p className="text-xs font-semibold">{item.account} — {item.signal}</p>
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">→ {item.recommended_play}</p>
                      </div>
                    ))}
                  </div>
                )}
                {briefing.watch_list && briefing.watch_list.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Watch List</p>
                    {briefing.watch_list.map((item, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground">• {item}</p>
                    ))}
                  </div>
                )}
                <button
                  onClick={generateBriefing}
                  className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground mt-1"
                >
                  ↻ Refresh
                </button>
              </>
            ) : (
              <button onClick={generateBriefing} className="text-xs text-primary py-2">
                Generate territory briefing →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
