/**
 * "What Actually Works" evidence panel.
 * Shows ranked tactics with confidence levels.
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

    // Fetch knowledge items matching this stage's keywords
    const { data: ki } = await supabase
      .from('knowledge_items')
      .select('title, tactic_summary, tags, confidence_score, chapter')
      .eq('user_id', user.id)
      .eq('active', true)
      .limit(50);

    const items = ki || [];

    const computed: ComputedTactic[] = defaultTactics.map(dt => {
      // Count how many knowledge items match this tactic's keywords
      const matching = items.filter(item => {
        const text = `${item.title} ${item.tactic_summary || ''} ${(item.tags || []).join(' ')} ${item.chapter}`.toLowerCase();
        return dt.keywords.some(kw => text.includes(kw));
      });

      const sourceCount = matching.length;
      // Estimate usage from template data (simplified)
      let confidence: 'HIGH' | 'MED' | 'LOW' = 'LOW';
      let reason = '';

      if (sourceCount >= 3) {
        confidence = 'HIGH';
        reason = `${sourceCount} sources support this`;
      } else if (sourceCount >= 1) {
        confidence = 'MED';
        reason = `${sourceCount} source${sourceCount > 1 ? 's' : ''}`;
      } else {
        reason = 'Best practice — build evidence';
      }

      return { statement: dt.statement, confidence, reason };
    });

    // Also surface any high-confidence knowledge items for this stage
    const stageKI = items.filter(item => {
      const text = `${item.chapter} ${(item.tags || []).join(' ')}`.toLowerCase();
      return text.includes(stageId) && item.confidence_score >= 0.7;
    });

    stageKI.slice(0, 3).forEach(item => {
      if (!computed.some(c => c.statement === item.tactic_summary)) {
        computed.push({
          statement: item.tactic_summary || item.title,
          confidence: item.confidence_score >= 0.8 ? 'HIGH' : 'MED',
          reason: `From: ${item.chapter}`,
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
