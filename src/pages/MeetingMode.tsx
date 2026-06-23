import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTerritoryProfile } from '@/hooks/useTerritoryProfile';
import { selectNextBranchKI } from '@/lib/dojo/selectNextBranchKI';
import { fromActiveAccounts } from '@/data/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { SafePage } from '@/components/SafePage';
import { ChevronLeft, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

type Phase = 'context' | 'kis' | 'warmup' | 'done';

interface Account {
  id: string;
  name: string;
  industry: string | null;
  account_status: string | null;
  tier: string | null;
  last_touch_date: string | null;
  next_step: string | null;
}

function inferDimensions(industry: string | null, goal: string): [string, string] {
  const i = (industry || '').toLowerCase();
  const g = goal.toLowerCase();

  if (/champion|stakeholder|exec|cmo|cfo|vp|c-suite|multi.?thread/.test(g)) {
    return ['stakeholder_navigation', 'expansion_strategy'];
  }
  if (/compet|adjust|appsflyer|kochava|singular|switch|alternative/.test(g)) {
    return ['competitive', 'deal_control'];
  }
  if (/product|feature|sdk|deep link|technical|integration|how does/.test(g)) {
    return ['product_knowledge', 'expansion_strategy'];
  }
  if (/budget|discount|price|pricing|renewal|close|contract|negotiat/.test(g)) {
    return ['deal_control', 'expansion_strategy'];
  }
  if (/discover|understand|learn|pain|challenge|problem|goal|objective/.test(g)) {
    return ['discovery', 'expansion_strategy'];
  }
  if (/expand|new product|new use case|whitespace|grow|upsell|cross.?sell/.test(g)) {
    return ['expansion_strategy', 'product_knowledge'];
  }

  if (/media|entertain|stream|content/.test(i)) return ['expansion_strategy', 'deal_control'];
  if (/retail|hospitality|travel|food|consumer/.test(i)) return ['expansion_strategy', 'product_knowledge'];
  if (/financ|bank|health|insur|pharma/.test(i)) return ['deal_control', 'discovery'];
  return ['expansion_strategy', 'deal_control'];
}

function statusRank(s: string | null): number {
  const v = (s || '').toLowerCase();
  if (v.includes('active')) return 0;
  if (v.includes('prospect')) return 1;
  return 2;
}

export default function MeetingMode() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile: territory } = useTerritoryProfile();

  const [phase, setPhase] = useState<Phase>('context');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [params] = useSearchParams();
  const urlAccountId = params.get('accountId');
  const [accountId, setAccountId] = useState<string>(urlAccountId ?? '');
  const [goal, setGoal] = useState('');
  const [kis, setKis] = useState<any[]>([]);
  const [loadingKis, setLoadingKis] = useState(false);
  const [warmupKi, setWarmupKi] = useState<any>(null);
  const [response, setResponse] = useState('');
  const [scoring, setScoring] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [coaching, setCoaching] = useState('');

  const account = useMemo(() => accounts.find(a => a.id === accountId) || null, [accounts, accountId]);

  // Fetch Branch accounts on mount (non-blocking)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await fromActiveAccounts()
        .select('id, name, industry, account_status, tier, last_touch_date, next_step')
        .eq('user_id', user.id)
        .limit(50);
      const list = ((data ?? []) as Account[]).sort((a, b) => {
        const r = statusRank(a.account_status) - statusRank(b.account_status);
        return r !== 0 ? r : a.name.localeCompare(b.name);
      });
      setAccounts(list);
    })();
  }, [user]);

  const loadKIs = async () => {
    if (!user || !account) return;
    setLoadingKis(true);
    setPhase('kis');
    const [d1, d2] = inferDimensions(account.industry, goal);
    const [k1, k2] = await Promise.all([
      selectNextBranchKI(user.id, d1).catch(() => null),
      selectNextBranchKI(user.id, d2).catch(() => null),
    ]);
    const picks = [k1, k2].filter(Boolean);
    setKis(picks);
    setLoadingKis(false);
  };

  const startWarmup = () => {
    if (!kis.length) return;
    setWarmupKi(kis[Math.floor(Math.random() * kis.length)]);
    setPhase('warmup');
  };

  const submitWarmup = async () => {
    if (!response.trim() || !warmupKi) return;
    setScoring(true);
    let s = 65;
    let c = '';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          scenario: {
            skillFocus: warmupKi.spider_dimension || 'deal_control',
            context: warmupKi.when_to_use || 'Pre-call warm-up',
            objection: warmupKi.example_usage || warmupKi.tactic_summary || 'Respond.',
          },
          userResponse: response,
          ki: {
            title: warmupKi.title ?? '',
            tactic_summary: warmupKi.tactic_summary ?? '',
            example_usage: warmupKi.example_usage ?? '',
            when_to_use: warmupKi.when_to_use ?? '',
            when_not_to_use: warmupKi.when_not_to_use ?? '',
            why_it_matters: warmupKi.why_it_matters ?? '',
          },
        }),
      });
      const data = await res.json();
      s = data.score ?? 65;
      c = data.feedback || '';
    } catch (err: any) {
      if (!navigator.onLine || err?.message?.includes('fetch')) {
        s = 65; c = '📶 Offline — good enough. You\'re ready.';
      } else {
        c = 'Rep logged.';
      }
    }
    setScore(s);
    setCoaching(c);
    setScoring(false);

    // Persist to localStorage
    try {
      const key = 'meeting_prep_history';
      const prev = JSON.parse(localStorage.getItem(key) || '[]');
      const entry = {
        accountId,
        accountName: account?.name,
        goal,
        kiId: warmupKi.id,
        warmupScore: s,
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem(key, JSON.stringify([entry, ...prev].slice(0, 20)));
    } catch {}

    setPhase('done');
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <SafePage className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Meeting Mode</p>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 max-w-lg w-full mx-auto">
        {/* Progress dots */}
        <div className="flex items-center gap-2 justify-center">
          {(['context', 'kis', 'warmup'] as Phase[]).map((p, i) => {
            const idx = ['context', 'kis', 'warmup', 'done'].indexOf(phase);
            return (
              <div key={p} className={cn(
                'h-1.5 rounded-full transition-all',
                i < idx ? 'w-6 bg-primary' : i === idx ? 'w-8 bg-primary' : 'w-6 bg-muted'
              )} />
            );
          })}
        </div>

        {/* PHASE 1: Context */}
        {phase === 'context' && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold">Pre-call ritual</h1>
              <p className="text-sm text-muted-foreground mt-1">90 seconds. Get sharp before you dial.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder={accounts.length ? 'Select an account' : 'Loading accounts…'} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} {a.account_status && <span className="text-muted-foreground text-xs ml-1">· {a.account_status}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {account && (
              <Card className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-base">{account.name}</p>
                  {account.tier && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {account.tier}
                    </span>
                  )}
                </div>
                {territory?.motion && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold">Motion:</span> {territory.motion}
                  </p>
                )}
                {account.last_touch_date && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold">Last touch:</span> {new Date(account.last_touch_date).toLocaleDateString()}
                  </p>
                )}
                {account.next_step && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-semibold">Next step:</span> {account.next_step}
                  </p>
                )}
              </Card>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What's your goal for this call?
              </label>
              <Input
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder="e.g. Confirm expansion budget, identify Peacock champion, get intro to CMO"
                className="h-12 text-base"
              />
            </div>

            <Button
              onClick={loadKIs}
              disabled={!accountId || !goal.trim()}
              className="w-full h-12 text-base"
            >
              Get My KIs →
            </Button>
          </div>
        )}

        {/* PHASE 2: KIs */}
        {phase === 'kis' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">Your 2 plays</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Hand-picked for {account?.name}.
              </p>
            </div>

            {loadingKis && (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Picking plays…</span>
              </div>
            )}

            {!loadingKis && kis.length === 0 && (
              <Card className="p-4 text-sm text-muted-foreground">
                No KIs available right now. You can skip straight to your call.
              </Card>
            )}

            {!loadingKis && kis.map((ki, i) => (
              <Card key={ki.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm leading-snug line-clamp-2 flex-1">{ki.title}</p>
                  <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">#{i + 1}</span>
                </div>
                {ki.tactic_summary && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{ki.tactic_summary}</p>
                )}
              </Card>
            ))}

            {!loadingKis && (
              <Button onClick={startWarmup} disabled={kis.length === 0} className="w-full h-12 text-base">
                Start Warm-Up Rep →
              </Button>
            )}
          </div>
        )}

        {/* PHASE 3: Warm-up */}
        {phase === 'warmup' && warmupKi && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">60-second warm-up</h2>
              <p className="text-sm text-muted-foreground mt-1">Write how you'd say this.</p>
            </div>

            <Card className="p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">The play</p>
              <p className="text-sm font-semibold leading-snug">{warmupKi.title}</p>
              {warmupKi.tactic_summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">{warmupKi.tactic_summary}</p>
              )}
            </Card>

            <Textarea
              value={response}
              onChange={e => setResponse(e.target.value)}
              placeholder="Write exactly what you'd say…"
              className="min-h-32 text-base"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitWarmup();
                }
              }}
            />

            <Button onClick={submitWarmup} disabled={!response.trim() || scoring} className="w-full h-12 text-base">
              {scoring ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Scoring…</> : 'Submit (Enter)'}
            </Button>
          </div>
        )}

        {/* PHASE 4: Done */}
        {phase === 'done' && (
          <div className="space-y-5 pt-4">
            <div className="flex flex-col items-center gap-3">
              <div className="h-16 w-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <Check className="h-8 w-8 text-green-500" />
              </div>
              <p className={cn(
                'text-5xl font-bold font-mono leading-none',
                (score ?? 0) >= 70 ? 'text-green-500' : (score ?? 0) >= 50 ? 'text-amber-500' : 'text-red-500'
              )}>{score}</p>
              <p className="text-base text-muted-foreground">You're ready. Good luck.</p>
            </div>

            {coaching && (
              <Card className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Coach note</p>
                <p className="text-sm leading-relaxed">{coaching}</p>
              </Card>
            )}

            <Button onClick={() => navigate('/outreach')} className="w-full h-12 text-base">
              Done — back to territory
            </Button>
          </div>
        )}
      </div>
    </SafePage>
  );
}
