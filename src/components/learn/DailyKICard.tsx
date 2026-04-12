/**
 * DailyKICard
 *
 * Renders today's KI from the DailyAssignment as a focused lesson card on the Learn page.
 * This is the Learn → Dojo bridge: same KI drives both teaching and practice.
 */

import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, ArrowRight, Lightbulb, Target, AlertTriangle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DailyKIContext } from '@/hooks/useDailyKI';
import { ANCHOR_LABELS } from '@/lib/dojo/v3/dayAnchors';

interface DailyKICardProps {
  context: DailyKIContext;
}

export function DailyKICard({ context }: DailyKICardProps) {
  const navigate = useNavigate();
  const ki = context.items[0];

  if (!ki) return null;

  const anchorLabel = ANCHOR_LABELS[context.anchor as keyof typeof ANCHOR_LABELS] ?? context.anchor;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Today's Focus
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">{anchorLabel}</Badge>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">{ki.title}</p>

          {ki.tactic_summary && (
            <div className="flex gap-2">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">{ki.tactic_summary}</p>
            </div>
          )}

          {ki.when_to_use && (
            <div className="flex gap-2">
              <Target className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">When to use: </span>
                {ki.when_to_use}
              </p>
            </div>
          )}

          {ki.when_not_to_use && (
            <div className="flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">When not to use: </span>
                {ki.when_not_to_use}
              </p>
            </div>
          )}

          {ki.how_to_execute && (
            <div className="bg-background/60 rounded-md p-3 mt-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">How to execute</p>
              <p className="text-xs text-foreground leading-relaxed">{ki.how_to_execute}</p>
            </div>
          )}

          {ki.example_usage && (
            <div className="bg-background/60 rounded-md p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Example</p>
              <p className="text-xs text-foreground leading-relaxed italic">"{ki.example_usage}"</p>
            </div>
          )}

          <button
            onClick={() => navigate('/dojo')}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/85 transition-colors mt-1"
          >
            <BookOpen className="h-4 w-4" />
            Practice This in Dojo
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground text-center italic">{context.reason}</p>
    </div>
  );
}
