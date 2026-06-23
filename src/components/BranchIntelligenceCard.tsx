import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';

interface BranchIntel {
  expansion_whitespace: string;
  discovery_questions: string[];
  expansion_angle: string;
  first_outreach: string;
  branch_products_to_focus: string[];
}

interface Props {
  account: Account;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function BranchIntelligenceCard({ account }: Props) {
  const cacheKey = `branch_intel_${account.id}`;
  const [intel, setIntel] = useState<BranchIntel | null>(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);

  const generate = async (force = false) => {
    if (loading) return;
    if (intel && !force) { setExpanded(true); return; }
    setLoading(true);
    setExpanded(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/branch-intelligence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          accountName: account.name,
          industry: (account as any).industry,
          notes: (account as any).notes,
          tags: (account as any).tags,
          vertical: (account as any).industry,
        }),
      });
      const data: BranchIntel = await res.json();
      setIntel(data);
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (err) {
      console.error('[BranchIntel] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => intel ? setExpanded(e => !e) : generate()}
          className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400 hover:text-green-600"
        >
          <span className="text-base">🌿</span>
          Branch Intelligence
          {intel && (expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)}
        </button>
        <div className="flex items-center gap-2">
          {intel && (
            <button
              onClick={() => generate(true)}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              disabled={loading}
            >
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              Refresh
            </button>
          )}
          {!intel && !loading && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-green-500/30 text-green-700 dark:text-green-400" onClick={() => generate()}>
              <Sparkles className="h-3 w-3" />
              Generate
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-green-500 shrink-0" />
            <p className="text-sm text-muted-foreground">Analyzing {account.name} against Branch.io KI library…</p>
          </CardContent>
        </Card>
      )}

      {intel && expanded && !loading && (
        <div className="space-y-3">
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="p-3 space-y-1">
              <p className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">Expansion Angle</p>
              <p className="text-sm leading-relaxed">{intel.expansion_angle}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Whitespace Hypothesis</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{intel.expansion_whitespace}</p>
              {intel.branch_products_to_focus?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {intel.branch_products_to_focus.map((p, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-3 space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">First Outreach Line</p>
              <p className="text-sm italic text-foreground">"{intel.first_outreach}"</p>
            </CardContent>
          </Card>

          <div>
            <button
              onClick={() => setShowQuestions(q => !q)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showQuestions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showQuestions ? 'Hide' : 'Show'} discovery questions ({intel.discovery_questions?.length || 0})
            </button>
            {showQuestions && intel.discovery_questions?.length > 0 && (
              <Card className="mt-2 border-border/50">
                <CardContent className="p-3">
                  <ol className="space-y-2">
                    {intel.discovery_questions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">{i + 1}.</span>
                        <span className="text-muted-foreground leading-relaxed">{q}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
