/**
 * "What Actually Works" evidence panel.
 * Shows ranked tactics with confidence levels, improved scoring.
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Lightbulb } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StageTactic } from './stageConfig';

interface ComputedTactic {
  statement: string;
  confidence: 'HIGH' | 'MED' | 'LOW';
  reason: string;
}

interface Props {
  stageId: string;
  defaultTactics: StageTactic[];
  persona?: string;
  competitor?: string;
}

export function WhatActuallyWorks({ stageId, defaultTactics, persona, competitor }: Props) {
  const { user } = useAuth();
  const [tactics, setTactics] = useState<ComputedTactic[]>([]);

  useEffect(() => {
    if (!user) return;
    computeTactics();
  }, [user, stageId, persona, competitor]);

  async function computeTactics() {
    if (!user) return;

    // Fetch knowledge items + templates + examples in parallel
    const [kiRes, tplRes, exRes] = await Promise.all([
      supabase
        .from('knowledge_items')
        .select('title, tactic_summary, tags, confidence_score, chapter')
        .eq('user_id', user.id)
        .eq('active', true)
        .limit(50),
      supabase
        .from('execution_templates' as any)
        .select('title, output_type, stage, times_used, is_pinned, tags')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(20),
      supabase
        .from('execution_outputs')
        .select('title, output_type, stage, is_strong_example, times_reused')
        .eq('user_id', user.id)
        .eq('is_strong_example', true)
        .limit(15),
    ]);

    const items = kiRes.data || [];
    const templates = (tplRes.data || []) as any[];
    const examples = (exRes.data || []) as any[];

    const computed: ComputedTactic[] = defaultTactics.map(dt => {
      // Count matching knowledge items
      const matchingKI = items.filter(item => {
        const text = `${item.title} ${item.tactic_summary || ''} ${(item.tags || []).join(' ')} ${item.chapter}`.toLowerCase();
        return dt.keywords.some(kw => text.includes(kw));
      });

      // Count matching templates by usage
      const matchingTpl = templates.filter(t => {
        const text = `${t.title} ${t.output_type} ${t.stage || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
        return dt.keywords.some(kw => text.includes(kw));
      });
      const templateUsage = matchingTpl.reduce((sum: number, t: any) => sum + (t.times_used || 0), 0);

      // Count matching strong examples
      const matchingEx = examples.filter(e => {
        const text = `${e.title} ${e.output_type} ${e.stage || ''}`.toLowerCase();
        return dt.keywords.some(kw => text.includes(kw));
      });
      const exampleReuse = matchingEx.reduce((sum: number, e: any) => sum + (e.times_reused || 0), 0);

      const sourceCount = matchingKI.length;
      const avgConfidence = matchingKI.length > 0
        ? matchingKI.reduce((s, k) => s + k.confidence_score, 0) / matchingKI.length
        : 0;

      // Combined scoring
      let confidence: 'HIGH' | 'MED' | 'LOW' = 'LOW';
      const parts: string[] = [];

      if (sourceCount > 0) parts.push(`${sourceCount} source${sourceCount > 1 ? 's' : ''}`);
      if (templateUsage > 0) parts.push(`${templateUsage} template use${templateUsage > 1 ? 's' : ''}`);
      if (matchingEx.length > 0) parts.push(`${matchingEx.length} strong example${matchingEx.length > 1 ? 's' : ''}`);

      const totalSignal = sourceCount + templateUsage + matchingEx.length * 2;

      if (totalSignal >= 5 || (sourceCount >= 3 && avgConfidence >= 0.7)) {
        confidence = 'HIGH';
      } else if (totalSignal >= 2 || sourceCount >= 1) {
        confidence = 'MED';
      }

      const reason = parts.length > 0 ? parts.join(' + ') : 'Best practice — build evidence';

      return { statement: dt.statement, confidence, reason };
    });

    // Surface high-confidence knowledge items for this stage
    const stageKI = items.filter(item => {
      const text = `${item.chapter} ${(item.tags || []).join(' ')}`.toLowerCase();
      return text.includes(stageId) && item.confidence_score >= 0.7;
    });

    stageKI.slice(0, 3).forEach(item => {
      if (!computed.some(c => c.statement === item.tactic_summary)) {
        computed.push({
          statement: item.tactic_summary || item.title,
          confidence: item.confidence_score >= 0.8 ? 'HIGH' : 'MED',
          reason: `From: ${item.chapter} (confidence ${Math.round(item.confidence_score * 100)}%)`,
        });
      }
    });

    setTactics(computed.slice(0, 6));
  }

  if (tactics.length === 0) return null;

  const confidenceColor = (c: 'HIGH' | 'MED' | 'LOW') => {
    if (c === 'HIGH') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
    if (c === 'MED') return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    return 'bg-muted text-muted-foreground border-border';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What Actually Works</h3>
      </div>
      <div className="space-y-1.5">
        {tactics.map((t, i) => (
          <div key={i} className="flex items-start gap-2 py-1.5 px-2.5 rounded-md bg-muted/30 border border-border">
            <Badge variant="outline" className={`text-[9px] font-semibold shrink-0 mt-0.5 ${confidenceColor(t.confidence)}`}>
              {t.confidence}
            </Badge>
            <div className="min-w-0">
              <p className="text-xs font-medium leading-snug">{t.statement}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
