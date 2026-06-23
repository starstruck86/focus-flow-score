import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fromActiveAccounts } from '@/data/accounts';
import { cn } from '@/lib/utils';

type Message = { role: 'user' | 'assistant'; content: string };
type AccountInfo = { id: string; name: string; industry: string | null; tier?: string | null };

type AccountContext = {
  account: { id: string; name: string; tier: string | null; industry: string | null; description: string | null; hq_city: string | null } | null;
  footprint: { deep_linking_status: string | null; universal_ads_status: string | null; email_to_app_status: string | null; sms_to_app_status: string | null } | null;
  lastCall: { summary: string | null; next_step: string | null; created_at: string | null; contact_name: string | null } | null;
};

const GENERIC_ACCOUNT: AccountInfo = { id: '', name: 'a target enterprise prospect', industry: null, tier: null };

const SCENARIOS = [
  { value: 'discovery', label: 'First call — discovery with Head of Growth' },
  { value: 'qbr', label: 'QBR — usage is flat, champion seems disengaged' },
  { value: 'build_internally', label: 'Expansion blocker — engineering says they can build it' },
  { value: 'adjust', label: 'Competitive threat — Adjust gave them a 20% lower quote' },
  { value: 'quiet_champion', label: 'Champion went quiet — re-engagement call' },
  { value: 'consolidate', label: 'Parent wants to consolidate vendors — cut Branch budget' },
  { value: 'economic_buyer', label: 'Economic buyer wants 30% discount or no renewal' },
];

const SCENARIO_LABELS: Record<string, string> = Object.fromEntries(SCENARIOS.map((s) => [s.value, s.label]));

const PRESSURES = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'skeptical', label: 'Skeptical' },
  { value: 'hostile', label: 'Hostile' },
];

const DIM_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  expansion_strategy: 'Expansion',
  deal_control: 'Deal Control',
  product_knowledge: 'Product',
  competitive: 'Competitive',
  stakeholder_navigation: 'Stakeholder',
};

const SCENARIO_DRILLS: Record<string, string[]> = {
  discovery: ['discovery', 'expansion_strategy'],
  qbr: ['deal_control', 'expansion_strategy'],
  build_internally: ['deal_control', 'product_knowledge'],
  adjust: ['competitive', 'deal_control'],
  quiet_champion: ['stakeholder_navigation', 'deal_control'],
  consolidate: ['deal_control', 'expansion_strategy'],
  economic_buyer: ['deal_control', 'competitive'],
};

const SCENARIO_OPENERS: Record<string, string> = {
  discovery: "Thanks for reaching out. I've got about 20 minutes — what's this about?",
  qbr: "Hey, ready for the QBR. I'll be honest, I'm not sure we're getting the value we expected. What've you got?",
  build_internally: "Look, I appreciate the pitch, but my team thinks we can build this in-house in a quarter. Why should I pay you instead?",
  adjust: "I'll cut to it — Adjust came in 20% under your number. Why shouldn't I switch?",
  quiet_champion: "Hey. Yeah, sorry I've been quiet. Things have shifted internally. What do you need?",
  consolidate: "Look, I'll be direct. Corporate has mandated a 20% vendor reduction across the company. Branch is on the list. What do we actually get from you that justifies the spend?",
  economic_buyer: "I've been looking at your renewal proposal. We're asking for a 30% reduction. That's not negotiable. What can you actually do for us?",
};

function buildSystemPrompt(account: AccountInfo, scenario: string, pressure: string): string {
  const pressureDesc =
    {
      neutral: 'You are politely skeptical but genuinely interested.',
      skeptical: 'You are quite skeptical. You push back on claims and ask hard questions.',
      hostile: 'You are openly resistant. You doubt Branch adds value over your current setup.',
    }[pressure] ?? 'You are skeptical.';

  const scenarioContext: Record<string, string> = {
    discovery: `You are the Head of Growth at ${account.name}. This is a first call. You have not heard of Branch before. You have 20 minutes. You are busy. ${pressureDesc}`,
    qbr: `You are the Head of Digital at ${account.name}. You are in a QBR with Branch. Your usage has been flat for 2 quarters. Your team doesn't use all the features. ${pressureDesc} You might be considering whether to renew.`,
    build_internally: `You are the VP Engineering at ${account.name}. The AE wants to expand to a new Branch product. You think your team can build this internally. ${pressureDesc}`,
    adjust: `You are the CMO at ${account.name}. Adjust has offered you 20% less than Branch costs. ${pressureDesc} You're seriously considering switching.`,
    quiet_champion: `You are the Head of Mobile at ${account.name}, a former Branch champion who has gone quiet for 6 weeks. ${pressureDesc} Something has changed internally but you haven't shared it.`,
    consolidate: `You are the CFO or a Senior VP overseeing vendor budgets at ${account.name}. Corporate mandated vendor consolidation. Branch is on the cut list. ${pressureDesc} You need clear ROI justification or you'll cut it.`,
    economic_buyer: `You are the Head of Procurement at ${account.name} handling contract renewals. You want a 30% reduction in Branch's price and will not renew without it. ${pressureDesc} You have alternatives.`,
  };

  return `${scenarioContext[scenario] ?? scenarioContext.discovery}

You stay in character throughout. You NEVER break character to explain you are an AI.
You respond as a real executive would — brief, pointed, no excessive helpfulness.
Your responses are 2-4 sentences max. You ask hard questions. You raise real objections.
Do not be a pushover. Make the AE earn each step forward.
After turn 8-10, start wrapping toward a natural end of call.`;
}

const MAX_TURNS = 10;

export default function Simulate() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [phase, setPhase] = useState<'setup' | 'active' | 'complete'>('setup');
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [scenario, setScenario] = useState('discovery');
  const [pressure, setPressure] = useState('skeptical');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gradeResult, setGradeResult] = useState<any>(null);
  const [grading, setGrading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runGradeCall = async (finalMessages: Message[]) => {
    setGrading(true);
    try {
      const { data } = await supabase.functions.invoke('simulate-chat', {
        body: { messages: finalMessages, isGradeMode: true, system: '' },
      });
      if (data?.gradeResult) setGradeResult(data.gradeResult);
    } catch (e) {
      console.warn('[Simulate] grade error', e);
    } finally {
      setGrading(false);
    }
  };

  const completeAndGrade = (finalMessages: Message[]) => {
    setPhase('complete');
    runGradeCall(finalMessages);
  };

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? GENERIC_ACCOUNT, [accounts, accountId]);
  const accountContextRef = useRef<AccountContext | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await fromActiveAccounts()
        .select('id, name, industry, tier')
        .eq('user_id', user.id)
        .limit(50);
      const list = ((data ?? []) as AccountInfo[]).sort((a, b) => a.name.localeCompare(b.name));
      setAccounts(list);
    })();
  }, [user]);

  // Reset cached context whenever the selected account changes
  useEffect(() => {
    accountContextRef.current = null;
  }, [accountId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (phase === 'active') textareaRef.current?.focus();
  }, [phase, loading]);

  const loadAccountContext = async (id: string): Promise<AccountContext> => {
    if (accountContextRef.current) return accountContextRef.current;
    const [accountRes, footprintRes, lastCallRes] = await Promise.all([
      (supabase as any).from('accounts')
        .select('id, name, tier, industry, description, hq_city')
        .eq('id', id).single(),
      (supabase as any).from('branch_footprint')
        .select('deep_linking_status, universal_ads_status, email_to_app_status, sms_to_app_status')
        .eq('account_id', id).maybeSingle(),
      (supabase as any).from('call_logs')
        .select('summary, next_step, created_at, contact_name')
        .eq('account_id', id)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle(),
    ]);
    const ctx: AccountContext = {
      account: accountRes?.data ?? null,
      footprint: footprintRes?.data ?? null,
      lastCall: lastCallRes?.data ?? null,
    };
    accountContextRef.current = ctx;
    return ctx;
  };

  const startSimulation = () => {
    if (!account) return;
    const opener = SCENARIO_OPENERS[scenario] ?? SCENARIO_OPENERS.discovery;
    setMessages([{ role: 'assistant', content: opener }]);
    setTurnCount(0);
    setError(null);
    setPhase('active');
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || !account) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    const newTurn = turnCount + 1;
    setTurnCount(newTurn);
    setLoading(true);
    setError(null);

    try {
      const system = buildSystemPrompt(account, scenario, pressure);
      const accountContext = accountId ? await loadAccountContext(accountId) : null;
      const { data, error: fnError } = await supabase.functions.invoke('simulate-chat', {
        body: { messages: next, system, accountContext },
      });
      if (fnError) throw fnError;
      const text = (data?.text as string) ?? '';
      if (!text) throw new Error('Empty response');
      setMessages((prev) => [...prev, { role: 'assistant', content: text }]);
      if (newTurn >= MAX_TURNS) {
        const finalMsgs = [...next, { role: 'assistant', content: text } as Message];
        setTimeout(() => completeAndGrade(finalMsgs), 600);
      }
    } catch (e: any) {
      console.error('[Simulate] error', e);
      setError(e?.message ?? 'Failed to reach Claude. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Debrief heuristics
  const debrief = useMemo(() => {
    const userMsgs = messages.filter((m) => m.role === 'user');
    const all = userMsgs.map((m) => m.content.toLowerCase()).join(' ');
    const askedQuestions = userMsgs.filter((m) => m.content.includes('?')).length;
    const showedEmpathy = /\b(understand|make sense|hear you|appreciate|i get)\b/.test(all);
    const lastTwo = userMsgs.slice(-2).map((m) => m.content.toLowerCase()).join(' ');
    const gotNextStep = /\b(next step|follow up|follow-up|schedule|book|calendar|send over|next week)\b/.test(lastTwo);

    const score = (askedQuestions >= 3 ? 1 : 0) + (showedEmpathy ? 1 : 0) + (gotNextStep ? 1 : 0);
    const note =
      score === 3 ? 'Strong rep — discovery, empathy, and a next step.'
      : score === 2 ? 'Solid showing. One gap to close next time.'
      : score === 1 ? 'Mixed. Focus on the basics.'
      : 'Tough one. Drill the fundamentals before the next live call.';
    const gaps: string[] = [];
    if (askedQuestions < 3) gaps.push('only ' + askedQuestions + ' discovery question(s)');
    if (!showedEmpathy) gaps.push('no empathy language');
    if (!gotNextStep) gaps.push('no clear next step locked');
    const detail = gaps.length ? `Gaps: ${gaps.join(' · ')}` : 'All core moves executed.';
    return { note, detail };
  }, [messages]);

  const recommendedDims = SCENARIO_DRILLS[scenario] ?? ['discovery'];

  if (phase === 'setup') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col z-40">
        <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3 shrink-0">
          <button onClick={() => navigate('/dojo')} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Dojo
          </button>
          <h1 className="text-base font-bold ml-2">Conversation Simulator</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl w-full mx-auto">
          <p className="text-sm text-muted-foreground">
            Claude plays a skeptical executive at one of your Branch accounts. Practice 6–10 turns. End with a debrief.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-background"
            >
              <option value="">Generic prospect</option>
              {accounts.length === 0 && <option disabled>Loading…</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.tier ? ` (Tier ${a.tier})` : ''}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scenario</label>
            <div className="space-y-1.5">
              {SCENARIOS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScenario(s.value)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg border text-sm transition-all',
                    scenario === s.value
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pressure</label>
            <div className="flex gap-2">
              {PRESSURES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPressure(p.value)}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg border text-sm transition-all',
                    pressure === p.value
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startSimulation}
            disabled={!account}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
          >
            Start Simulation →
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col z-40 overflow-y-auto">
        <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3 shrink-0">
          <h1 className="text-base font-bold">Debrief</h1>
        </div>
        <div className="space-y-4 p-6 max-w-xl w-full mx-auto">
          <p className="text-sm text-muted-foreground">
            {turnCount} turns · {account?.name} · {SCENARIO_LABELS[scenario]}
          </p>

          {grading && (
            <div className="rounded-xl border bg-card p-6 flex items-center justify-center gap-3">
              <div className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Analyzing your call…</p>
            </div>
          )}

          {!grading && gradeResult && (
            <>
              <div className="rounded-xl border bg-card p-4 flex items-center gap-4">
                <div className="text-5xl font-bold font-mono leading-none">{gradeResult.grade}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-2xl font-bold leading-none">{gradeResult.score}<span className="text-sm text-muted-foreground font-normal">/100</span></p>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{gradeResult.summary}</p>
                </div>
              </div>
              {Array.isArray(gradeResult.strengths) && gradeResult.strengths.length > 0 && (
                <div className="rounded-xl border bg-card p-4 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600">Strengths</p>
                  {gradeResult.strengths.map((s: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-green-500">✓</span>{s}</p>
                  ))}
                </div>
              )}
              {Array.isArray(gradeResult.improvements) && gradeResult.improvements.length > 0 && (
                <div className="rounded-xl border bg-card p-4 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Improvements</p>
                  {gradeResult.improvements.map((s: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-amber-500">△</span>{s}</p>
                  ))}
                </div>
              )}
              {gradeResult.coachingNote && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1">Coach note</p>
                  <p className="text-sm leading-relaxed">{gradeResult.coachingNote}</p>
                </div>
              )}
            </>
          )}

          {!grading && !gradeResult && (
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <p className="text-sm font-semibold">{debrief.note}</p>
              <p className="text-xs text-muted-foreground">{debrief.detail}</p>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Drill these plays</p>
            <button
              onClick={() => navigate(`/ki-library?dimension=${recommendedDims[0]}`)}
              className="w-full text-left p-3 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all text-sm font-medium"
            >
              {DIM_LABELS[recommendedDims[0]] ?? recommendedDims[0]} plays →
            </button>
            {recommendedDims[1] && (
              <button
                onClick={() => navigate(`/ki-library?dimension=${recommendedDims[1]}`)}
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/30 transition-all text-sm text-muted-foreground"
              >
                {DIM_LABELS[recommendedDims[1]] ?? recommendedDims[1]} plays →
              </button>
            )}
          </div>
          <button
            onClick={() => { setPhase('setup'); setMessages([]); setTurnCount(0); setGradeResult(null); }}
            className="w-full py-3 rounded-xl border border-border text-sm"
          >
            Run another simulation
          </button>
          <button
            onClick={() => navigate('/dojo')}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // active
  return (
    <div className="fixed inset-0 bg-background flex flex-col z-40">
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{account?.name} · {SCENARIO_LABELS[scenario]?.split('—')[0].trim()}</p>
          <p className="text-[11px] text-muted-foreground">Turn {turnCount}/{MAX_TURNS}</p>
          {accountId && account && account.id && (
            <div className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 bg-primary/10 border border-primary/20 rounded-md">
              <span className="text-[10px] font-semibold text-primary">
                Simulating: {account.name}
              </span>
              {account.tier && (
                <span className="text-[10px] text-muted-foreground">Tier {account.tier}</span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => completeAndGrade(messages)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted/40 shrink-0"
        >
          End call
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm',
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted text-muted-foreground rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm italic">
              {account?.name?.split(' ')[0] ?? 'They'} is thinking…
            </div>
          </div>
        )}
        {error && (
          <div className="text-xs text-destructive px-2">{error}</div>
        )}
      </div>

      <div className="border-t border-border bg-card/50 p-3 shrink-0">
        <div className="flex gap-2 items-end max-w-2xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Your response… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 resize-none px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-1"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
