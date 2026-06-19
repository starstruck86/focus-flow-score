import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Zap, Target, BookOpen, AlertTriangle, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
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

interface BriefingData {
  callType: string;
  company: string;
  topKIs: { title: string; tactic_summary: string; why_it_matters: string }[];
  weakestCategory: { label: string; score: number } | null;
  branchReadiness: { total: number; drilled: number } | null;
  focusCue: string;
}

export default function Brief() {
  const [company, setCompany] = useState('');
  const [selectedType, setSelectedType] = useState<typeof CALL_TYPES[0] | null>(null);
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);

  const generate = async () => {
    if (!selectedType) return;
    setLoading(true);

    const { data: { user, session } } = await supabase.auth.getSession().then(async r => {
      const u = await supabase.auth.getUser();
      return { data: { user: u.data.user, session: r.data.session } };
    });
    if (!user || !session) { setLoading(false); return; }

    // Fetch top KIs for this dimension
    const { data: kis } = await (supabase as any)
      .from('knowledge_items')
      .select('title, tactic_summary, why_it_matters')
      .eq('spider_dimension', selectedType.dimension)
      .eq('is_core_ae', true)
      .eq('active', true)
      .order('confidence_score', { ascending: false })
      .limit(5);

    // Fetch weakest coach category from dimension_scores
    const { data: dimScore } = await (supabase as any)
      .from('dimension_scores')
      .select('avg_score_100, call_count')
      .eq('user_id', user.id)
      .eq('spider_dimension', selectedType.dimension)
      .maybeSingle();

    // Fetch Branch.io readiness
    const { data: branch } = await (supabase as any)
      .from('branch_readiness')
      .select('total_branch_kis, drilled_branch_kis')
      .eq('user_id', user.id)
      .maybeSingle();

    // Build focus cue based on dimension score
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
      branchReadiness: branch ? { total: branch.total_branch_kis, drilled: branch.drilled_branch_kis } : null,
      focusCue,
    });
    setLoading(false);
  };

  return (
    <Layout>
      <div className="px-4 pt-4 pb-24 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <h1 className="font-display text-xl font-bold">Pre-Call Brief</h1>
        </div>

        {!briefing ? (
          <div className="space-y-4">
            {/* Company */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Account (optional)</p>
              <Input
                placeholder="Company or contact name…"
                value={company}
                onChange={e => setCompany(e.target.value)}
              />
            </div>

            {/* Call type */}
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
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{briefing.company}</p>
                <p className="text-xs text-muted-foreground">{briefing.callType} · Pre-call brief</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setBriefing(null)}>New brief</Button>
            </div>

            {/* Focus cue */}
            <Card className={cn('border', briefing.weakestCategory && briefing.weakestCategory.score < 50 ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">{briefing.focusCue}</p>
                </div>
              </CardContent>
            </Card>

            {/* Top KIs */}
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
                </CardContent>
              </Card>
            )}

            {/* Branch.io readiness */}
            {briefing.branchReadiness && (
              <Card className={cn('border', briefing.branchReadiness.total === 0 ? 'border-amber-500/30' : 'border-blue-500/20')}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="h-7 w-7 rounded-md bg-blue-600 flex items-center justify-center shrink-0 text-white text-xs font-bold">B</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Branch.io Intelligence</p>
                    <p className="text-xs text-muted-foreground">
                      {briefing.branchReadiness.total === 0
                        ? 'No Branch.io KIs ingested yet — add resources in PrepHub'
                        : `${briefing.branchReadiness.drilled} of ${briefing.branchReadiness.total} Branch.io KIs drilled`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
