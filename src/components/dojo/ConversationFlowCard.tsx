/**
 * ConversationFlowCard
 *
 * Post-session feedback card for V5 multi-turn simulation arcs.
 * Shows turn-by-turn scores, arc-level verdict, flow control analysis,
 * and KI → turn breakdown linkage.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Shield, Target, AlertTriangle, Layers, XCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArcScore, ArcTurnResult } from '@/lib/dojo/v5/arcScoring';
import type { SimulationArc } from '@/lib/dojo/v5/simulationArcs';
import { SKILL_LABELS, MISTAKE_LABELS } from '@/lib/dojo/scenarios';
import { FOCUS_PATTERN_LABELS } from '@/lib/dojo/focusPatterns';

interface ConversationFlowCardProps {
  arc: SimulationArc;
  turnResults: ArcTurnResult[];
  arcScore: ArcScore;
  /** The daily assignment's focus pattern — used to show where KI held / broke */
  assignmentFocusPattern?: string | null;
}

export function ConversationFlowCard({ arc, turnResults, arcScore, assignmentFocusPattern }: ConversationFlowCardProps) {
  // Determine where the KI focus held or broke across turns
  const focusBreakdown = assignmentFocusPattern ? turnResults.map((turn, i) => {
    const broke = turn.topMistake === assignmentFocusPattern;
    return { turnIndex: i, broke };
  }) : null;

  const focusHeldTurns = focusBreakdown?.filter(t => !t.broke).length ?? 0;
  const focusBrokeTurn = focusBreakdown?.find(t => t.broke);
  const focusBrokeOnTurnLabel = focusBrokeTurn != null
    ? `Turn ${focusBrokeTurn.turnIndex + 1}`
    : null;

  // Build KI summary line
  let kiSummary: string | null = null;
  if (assignmentFocusPattern && focusBreakdown) {
    const patternLabel = FOCUS_PATTERN_LABELS?.[assignmentFocusPattern] ?? assignmentFocusPattern.replace(/_/g, ' ');
    if (focusBrokeTurn == null) {
      kiSummary = `Focus held across all ${turnResults.length} turns.`;
    } else if (focusBrokeTurn.turnIndex === 0) {
      kiSummary = `Focus on "${patternLabel}" broke immediately on Turn 1.`;
    } else {
      const buyerMove = arc.turns[focusBrokeTurn.turnIndex]?.buyerMoveType?.replace(/_/g, ' ') ?? 'pressure';
      const heldTurnNums = focusBreakdown
        .filter(t => !t.broke && t.turnIndex < focusBrokeTurn.turnIndex)
        .map(t => t.turnIndex + 1);
      kiSummary = `Focus held on Turn${heldTurnNums.length > 1 ? 's' : ''} ${heldTurnNums.join(', ') || '1'}, broke on ${focusBrokeOnTurnLabel} under ${buyerMove}.`;
    }
  }

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
              Conversation Flow
            </p>
          </div>
          <div className={cn(
            'text-2xl font-bold',
            arcScore.overallScore >= 75 ? 'text-green-500' :
            arcScore.overallScore >= 60 ? 'text-amber-500' : 'text-red-500'
          )}>
            {arcScore.overallScore}
          </div>
        </div>

        {/* Arc title + skills */}
        <div>
          <p className="text-sm font-semibold text-foreground">{arc.title}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {arc.skillChain.map(skill => (
              <Badge key={skill} variant="outline" className="text-[9px]">
                {SKILL_LABELS[skill]}
              </Badge>
            ))}
          </div>
        </div>

        {/* Turn-by-turn breakdown */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Turn-by-Turn
          </p>
          {turnResults.map((turn, i) => {
            const isStrongest = i === arcScore.strongestTurn;
            const isWeakest = i === arcScore.weakestTurn && turnResults.length > 1;
            const prevScore = i > 0 ? turnResults[i - 1].score : null;
            const delta = prevScore !== null ? turn.score - prevScore : null;
            const focusBroke = focusBreakdown?.[i]?.broke;

            return (
              <div key={i} className="space-y-0.5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 w-12 shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground">T{i + 1}</span>
                    {isStrongest && <TrendingUp className="h-3 w-3 text-green-500" />}
                    {isWeakest && <TrendingDown className="h-3 w-3 text-red-500" />}
                  </div>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        turn.score >= 75 ? 'bg-green-500' :
                        turn.score >= 60 ? 'bg-amber-500' : 'bg-red-500'
                      )}
                      style={{ width: `${Math.min(100, turn.score)}%` }}
                    />
                  </div>
                  <span className={cn(
                    'text-xs font-bold w-8 text-right',
                    turn.score >= 75 ? 'text-green-600 dark:text-green-400' :
                    turn.score >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                  )}>
                    {turn.score}
                  </span>
                  {delta !== null && (
                    <span className={cn(
                      'text-[10px] w-8',
                      delta > 0 ? 'text-green-500' : delta < -5 ? 'text-red-500' : 'text-muted-foreground'
                    )}>
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  )}
                </div>
                {/* KI focus breakdown per turn */}
                {focusBroke && assignmentFocusPattern && (
                  <div className="flex items-center gap-1.5 ml-12 text-[10px]">
                    <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0" />
                    <span className="text-red-600 dark:text-red-400 font-medium">
                      Focus broke: {FOCUS_PATTERN_LABELS?.[assignmentFocusPattern] ?? assignmentFocusPattern.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* KI summary */}
        {kiSummary && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-background/60 border border-border/40">
            {focusBrokeTurn ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
            )}
            <p className="text-xs text-muted-foreground leading-relaxed">{kiSummary}</p>
          </div>
        )}

        {/* Sub-scores */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 bg-background/50 rounded-md">
            <p className="text-[9px] text-muted-foreground uppercase">Flow</p>
            <p className="text-sm font-bold">{arcScore.flowControlScore}</p>
          </div>
          <div className="text-center p-2 bg-background/50 rounded-md">
            <p className="text-[9px] text-muted-foreground uppercase">Consistency</p>
            <p className="text-sm font-bold">{arcScore.consistencyScore}</p>
          </div>
          <div className="text-center p-2 bg-background/50 rounded-md">
            <p className="text-[9px] text-muted-foreground uppercase">Close</p>
            <p className="text-sm font-bold">{arcScore.closingScore}</p>
          </div>
        </div>

        {/* Control verdict */}
        <div className="flex items-center gap-2">
          {arcScore.controlHeld ? (
            <>
              <Shield className="h-4 w-4 text-green-500" />
              <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                Control Held
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                Control Lost
              </span>
            </>
          )}
        </div>

        {/* Arc-level mistake */}
        {arcScore.arcTopMistake && (
          <div className="flex items-center gap-2 text-xs">
            <Target className="h-3.5 w-3.5 text-orange-500 shrink-0" />
            <span className="text-muted-foreground">Main break:</span>
            <span className="font-medium">
              {MISTAKE_LABELS[arcScore.arcTopMistake] || arcScore.arcTopMistake.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* Summary */}
        <p className="text-xs text-muted-foreground leading-relaxed italic">
          {arcScore.summary}
        </p>
      </CardContent>
    </Card>
  );
}
