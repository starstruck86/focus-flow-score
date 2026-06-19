import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Zap, BookOpen, AlertTriangle, ChevronRight, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { selectNextKI } from '@/lib/dojo/selectNextKI';
import { cn } from '@/lib/utils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const CALL_TYPES = [
  { id: 'discovery', label: 'Discovery', dimension: 'discovery', icon: '🔍' },
  { id: 'demo', label: 'Demo / Presentation', dimension: 'messaging', icon: '📊' },
  { id: 'champion', label: 'Champion Build', dimension: 'stakeholder_navigation', icon: '🤝' },
  { id: 'executive', label: 'Executive / C-Suite', dimension: 'c_suite_engagement', icon: '🎯' },
  { id: 'expansion', label: 'Expansion / Cross-sell', dimension: 'expansion_strategy', icon: '📈' },
  { id: 'negotiation', label: 'Negotiation / Close', dimension: 'deal_control', icon: '🔒' },
  { id: 'competitive', label: 'Competitive Evaluation', dimension: 'competitive', icon: '⚔️' },
  { id: 'qbr', label: 'QBR / Check-in', dimension: 'expansion_strategy', icon: '📋' },
];

const CALL_TYPE_TO_DIMENSION: Record<string, string> = {
  discovery: 'discovery',
  expansion: 'expansion_strategy',
  executive: 'c_suite_engagement',
  negotiation: 'deal_control',
  qbr: 'deal_control',
  competitive: 'competitive',
  renewal: 'expansion_strategy',
  demo: 'messaging',
  champion: 'stakeholder_navigation',
};

interface BriefingData {
  callType: string;
  company: string;
  topKIs: { title: string; tactic_summary: string; why_it_matters: string }[];
  weakestCategory: { label: string; score: number } | null;
  focusCue: string;
}

export default function Brief() {
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [selectedType, setSelectedType] = useState<typeof CALL_TYPES[0] | null>(null);
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);

  const [warmupPhase, setWarmupPhase] = useState<'idle' | 'loading' | 'input' | 'scoring' | 'done'>('idle');
  const [warmupKI, setWarmupKI] = useState<any>(null);
  const [warmupResponse, setWarmupResponse] = useState('');
  const [warmupScore, setWarmupScore] = useState<number | null>(null);
  const [warmupCoaching, setWarmupCoaching] = useState('');

  const generate = async () => {
    if (!selectedType) return;
    setLoading(true);

    const { data: { user, session } } = await supabase.auth.getSession().then(async r => {
      const u = await supabase.auth.getUser();
      return { data: { user: u.data.user, session: r.data.session } };
    });
    if (!user || !session) { setLoading(false); return; }

    const { data: kis } = await (supabase as any)
      .from('knowledge_items')
      .select('title, tactic_summary, why_it_matters')
      .eq('spider_dimension', selectedType.dimension)
      .eq('is_core_ae', true)
      .eq('active', true)
      .order('confidence_score', { ascending: false })
      .limit(5);

    const { data: dimScore } = await (supabase as any)
      .from('dimension_scores')
      .select('avg_score_100, call_count')
      .eq('user_id', user.id)
      .eq('spider_dimension', selectedType.dimension)
      .maybeSingle();

    const score = dimScore?.avg_score_100 ?? null;
    const focusCue = score !== null
      ? score < 50
        ? `Your ${selectedType.label.toLowerCase()} scores average ${Math.round(score)}/100 on real calls. Lead with questions before statements.`
        : score < 70
        ? `${selectedType.label} is improving (${Math.round(score)}/100). Watch for talk-time ratio — you may be over-presenting.`
        : `${selectedType.label} is a strength (${Math.round(score)}/100). Focus on deepening, not covering basics.`
      : `No call data yet for ${selectedType.label.toLowerCase()}. Apply the KIs below deliberately.`;

    setBriefing({
      callType: selectedType.label,
      company: company || 'this account',
      topKIs: kis ?? [],
      weakestCategory: score !== null ? { label: selectedType.label, score: Math.round(score) } : null,
      focusCue,
    });
    setLoading(false);
  };

  const handleStartWarmup = async () => {
    setWarmupPhase('loading');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setWarmupPhase('idle'); return; }

    const dimension = CALL_TYPE_TO_DIMENSION[selectedType?.id ?? 'discovery'] ?? 'discovery';
    const ki = await selectNextKI(user.id, dimension);
    if (ki) {
      setWarmupKI(ki);
      setWarmupResponse('');
      setWarmupPhase('input');
    } else {
      setWarmupPhase('idle');
    }
  };

  const handleSubmitWarmup = async () => {
    if (!warmupResponse.trim() || !warmupKI) return;
    setWarmupPhase('scoring');
    const { data: { session } } = await supabase.auth.getSession();

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          scenario: {
            skillFocus: CALL_TYPE_TO_DIMENSION[selectedType?.id ?? 'discovery'] ?? 'discovery',
            context: warmupKI.when_to_use || 'Pre-call scenario',
            objection: warmupKI.example_usage || warmupKI.tactic_summary || 'Apply this play.',
          },
          userResponse: warmupResponse,
          ki: {
            title: warmupKI.title ?? '',
            tactic_summary: warmupKI.tactic_summary ?? '',
            example_usage: warmupKI.example_usage ?? '',
            when_to_use: warmupKI.when_to_use ?? '',
            when_not_to_use: warmupKI.when_not_to_use ?? '',
            why_it_matters: warmupKI.why_it_matters ?? '',
          },
        }),
      });
      const data = await res.json();
      setWarmupScore(data.score ?? 50);
      setWarmupCoaching(((data.feedback || '').split(/[.!?]/)[0].trim() + '.') || 'Rep recorded.');
    } catch {
      setWarmupScore(50);
      setWarmupCoaching("Rep recorded. You're ready.");
    }
    setWarmupPhase('done');
  };

  return (
    <Layout>
      <div className="px-4 pt-4 pb-24 space-y-4 max-w-lg mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h1 className="font-display text-xl font-bold">Scout</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 ml-7">Pre-call preparation</p>
        </div>

        {!briefing ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Account (optional)</p>
              <Input
                placeholder="Company or contact name…"
                value={company}
                onChange={e => setCompany(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Call Type</p>
              <div className="grid grid-cols-2 gap-2">
                {CALL_TYPES.map(ct => (
                  <button
                    key={ct.id}
                    onClick={() => setSelectedType(ct)}
                    className={cn(
                      'text-left p-2.5 rounded-lg border text-sm transition-all',
                      selectedType?.id === ct.id
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border hover:border-primary/40'
                    )}
                  >
                    <span className="mr-1.5">{ct.icon}</span>{ct.label}
                  </button>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!selectedType || loading}
              onClick={generate}
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Building brief…</>
              ) : (
                <>Generate Brief <ChevronRight className="h-4 w-4 ml-1" /></>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{briefing.company}</p>
                <p className="text-xs text-muted-foreground">{briefing.callType} · Scout brief</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setBriefing(null)}>New brief</Button>
            </div>

            <Card className={cn('border', briefing.weakestCategory && briefing.weakestCategory.score < 50 ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">{briefing.focusCue}</p>
                </div>
              </CardContent>
            </Card>

            {briefing.topKIs.length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary shrink-0" />
                    <p className="text-sm font-semibold">Top {briefing.callType} Plays</p>
                  </div>
                  <div className="space-y-3">
                    {briefing.topKIs.map((ki, i) => (
                      <div key={i} className="space-y-1 pb-3 border-b border-border/40 last:border-0 last:pb-0">
                        <p className="text-xs font-semibold text-foreground">{ki.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{ki.tactic_summary}</p>
                        {ki.why_it_matters && (
                          <p className="text-[11px] text-primary/80">Why it matters: {ki.why_it_matters.substring(0, 100)}{ki.why_it_matters.length > 100 ? '…' : ''}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    className="w-full mt-4"
                    onClick={handleStartWarmup}
                    disabled={warmupPhase === 'loading'}
                  >
                    {warmupPhase === 'loading' ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading rep…</>
                    ) : (
                      <><Zap className="h-4 w-4 mr-2" />Do 1 Warm-Up Rep</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {warmupPhase === 'input' && warmupKI && (
          <div className="fixed inset-0 bg-background z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/40" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
              <div>
                <p className="text-sm font-semibold">Warm-Up Rep</p>
                <p className="text-xs text-muted-foreground">1 rep before you walk in</p>
              </div>
              <button onClick={() => setWarmupPhase('idle')} className="text-muted-foreground p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <Card>
                <CardContent className="p-4 space-y-2">
                  <p className="text-xs font-semibold text-foreground">{warmupKI.title}</p>
                  <p className="text-xs text-muted-foreground">Apply this play — respond to the scenario:</p>
                  <p className="text-sm leading-relaxed">{warmupKI.when_to_use || warmupKI.tactic_summary}</p>
                </CardContent>
              </Card>
            </div>
            <div className="border-t border-border px-4 py-3 bg-background space-y-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
              <Textarea
                placeholder="Your response…"
                value={warmupResponse}
                onChange={e => setWarmupResponse(e.target.value)}
                className="text-sm min-h-[72px] resize-none"
                rows={3}
              />
              <Button className="w-full" disabled={!warmupResponse.trim()} onClick={handleSubmitWarmup}>
                Submit
              </Button>
            </div>
          </div>
        )}

        {warmupPhase === 'scoring' && (
          <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Scoring your rep…</p>
          </div>
        )}

        {warmupPhase === 'done' && (
          <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center px-6 gap-5">
            <div className="text-center">
              <p className={cn(
                'text-5xl font-bold font-mono',
                (warmupScore ?? 0) >= 70 ? 'text-green-500' :
                (warmupScore ?? 0) >= 50 ? 'text-amber-500' : 'text-red-500'
              )}>{warmupScore}</p>
              <p className="text-sm text-muted-foreground mt-1">warm-up score</p>
            </div>
            {warmupCoaching && (
              <Card className="w-full max-w-sm">
                <CardContent className="p-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">{warmupCoaching}</p>
                </CardContent>
              </Card>
            )}
            <div className="w-full max-w-sm space-y-2">
              <Button className="w-full" onClick={() => { setWarmupPhase('idle'); }}>
                ← Back to Brief
              </Button>
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { setWarmupPhase('idle'); navigate('/dojo'); }}>
                Done — back to home
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
