// Weekly Battle Plan Widget — AI-ranked top moves for the week
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useWeeklyBattlePlan, useGenerateBattlePlan, useCompleteBattleMove } from '@/hooks/useCoachingEngine';
import { Swords, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const categoryColors: Record<string, string> = {
  deal_progression: 'bg-primary/10 text-primary',
  prospecting: 'bg-recovery/10 text-recovery',
  renewal_protection: 'bg-strain/10 text-strain',
  pipeline_creation: 'bg-blue-500/10 text-blue-500',
  relationship_building: 'bg-purple-500/10 text-purple-500',
};

const categoryLabels: Record<string, string> = {
  deal_progression: 'Deal',
  prospecting: 'Prospect',
  renewal_protection: 'Renewal',
  pipeline_creation: 'Pipeline',
  relationship_building: 'Relationship',
};

function formatCurrency(n: number) {
  if (n < 0) return `-${formatCurrency(Math.abs(n))}`;
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function WeeklyBattlePlanCard() {
  const { data: plan, isLoading } = useWeeklyBattlePlan();
  const generate = useGenerateBattlePlan();
  const completeMove = useCompleteBattleMove();

  if (isLoading) {
    return (
      <Card className="metric-card">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const moves = (plan?.moves as BattlePlanMove[]) || [];
  const completed = (plan?.moves_completed as number[]) || [];
  const completedCount = completed.length;

  // FIX: Warn before regenerating if there are completed moves
  const handleGenerate = () => {
    if (completedCount > 0) {
      toast(`Regenerating will reset ${completedCount} completed move(s)`, {
        action: {
          label: 'Regenerate',
          onClick: () => generate.mutate(),
        },
      });
    } else {
      generate.mutate();
    }
  };

  return (
    <Card className="metric-card border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            Weekly Battle Plan
          </CardTitle>
          <div className="flex items-center gap-2">
            {moves.length > 0 && (
              <span className="text-xs text-muted-foreground">{completedCount}/{moves.length} done</span>
            )}
            <Button
              variant={moves.length === 0 ? "default" : "ghost"}
              size="sm"
              onClick={handleGenerate}
              disabled={generate.isPending}
              className={cn(moves.length === 0 && "gap-1.5")}
            >
              {generate.isPending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : moves.length === 0 ? (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Plan
                </>
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan?.strategy_summary && (
          <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
            {plan.strategy_summary}
          </p>
        )}

        {plan?.quota_gap != null && (
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>Quota gap: <strong className="text-foreground">{formatCurrency(plan.quota_gap)}</strong></span>
            <span>{plan.days_remaining}d remaining</span>
          </div>
        )}

        {moves.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <Swords className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No battle plan yet this week.</p>
            <p className="text-xs">Generate one to get AI-ranked moves.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {moves.map((move, idx: number) => {
              const isDone = completed.includes(idx);
              return (
                <div
                  key={idx}
                  className={cn(
                    "p-3 rounded-lg transition-all",
                    isDone ? "bg-muted/20 opacity-60" : "bg-muted/30 hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={isDone}
                      onCheckedChange={() => plan && completeMove.mutate({ planId: plan.id, moveIndex: idx })}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="text-xs font-bold text-muted-foreground">#{move.rank || idx + 1}</span>
                        <span className={cn("text-sm font-medium", isDone && "line-through")}>{move.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1.5">{move.description}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", categoryColors[move.category])}>
                          {categoryLabels[move.category] || move.category}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{move.target_day}</Badge>
                        {move.account_name && (
                          <span className="text-[10px] text-muted-foreground">{move.account_name}</span>
                        )}
                        {move.estimated_arr_impact > 0 && (
                          <span className="text-[10px] font-mono text-primary">{formatCurrency(move.estimated_arr_impact)}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 italic">{move.why}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
