/**
 * Block Comparison View
 *
 * Shows benchmark vs retest comparison with per-anchor deltas,
 * mistake analysis, and overall block progress.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, CheckCircle2, AlertTriangle, XCircle, BarChart3, Layers } from 'lucide-react';
import type { SnapshotComparison } from '@/lib/dojo/v3/snapshotManager';
import { MISTAKE_LABELS } from '@/lib/dojo/scenarios';

interface BlockComparisonViewProps {
  comparison: SnapshotComparison;
  blockNumber: number;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) return <Badge variant="outline" className="text-green-600 border-green-300 text-[10px]">+{delta}</Badge>;
  if (delta < 0) return <Badge variant="outline" className="text-red-600 border-red-300 text-[10px]">{delta}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground text-[10px]">0</Badge>;
}

function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0) return <TrendingUp className="h-3.5 w-3.5 text-green-600" />;
  if (delta < 0) return <TrendingDown className="h-3.5 w-3.5 text-red-600" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function BlockComparisonView({ comparison, blockNumber }: BlockComparisonViewProps) {
  const { perAnchor, overallDelta, mistakesFixed, mistakesPersisting, mistakesNew, flowComparison } = comparison;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Block {blockNumber} — Your Progress
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          {overallDelta > 0
            ? `You improved ${overallDelta} pts on average across all anchors. This is where you started vs where you are now.`
            : overallDelta === 0
            ? 'Your scores held steady across the block. Consistency is a signal too.'
            : 'Some areas slipped — review the anchors below and keep drilling.'}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline" className="text-[10px]">Week 1</Badge>
          <span className="text-xs text-muted-foreground">→</span>
          <Badge variant="outline" className="text-[10px]">Week 8</Badge>
          <DeltaBadge delta={overallDelta} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Per-anchor comparison */}
        <div className="space-y-2">
          {perAnchor.map(a => (
            <div key={a.anchor} className="flex items-center gap-2 text-xs">
              <DeltaIcon delta={a.delta} />
              <span className="w-20 font-medium truncate">{a.label}</span>
              <span className="text-muted-foreground w-8 text-right">{a.benchmarkScore}</span>
              <span className="text-muted-foreground">→</span>
              <span className={`w-8 font-semibold ${a.retestScore >= 75 ? 'text-green-600' : a.retestScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                {a.retestScore}
              </span>
              <DeltaBadge delta={a.delta} />
              {a.mistakeFixed && (
                <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />
              )}
            </div>
          ))}
        </div>

        {/* V5 Flow metrics comparison */}
        {flowComparison && (flowComparison.benchmarkFlow != null || flowComparison.retestFlow != null) && (
          <div className="space-y-2 pt-2 border-t border-border/40">
            <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1 uppercase tracking-wider">
              <Layers className="h-3 w-3" /> Conversation Flow Progress
            </p>
            <p className="text-[10px] text-muted-foreground">
              This is where you started vs where you are now.
            </p>
            <div className="space-y-1">
              {flowComparison.benchmarkFlow != null && flowComparison.retestFlow != null && (
                <div className="flex items-center gap-2 text-xs">
                  <DeltaIcon delta={flowComparison.flowDelta ?? 0} />
                  <span className="w-20 font-medium">Flow</span>
                  <span className="text-muted-foreground w-8 text-right">{flowComparison.benchmarkFlow}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={`w-8 font-semibold ${flowComparison.retestFlow >= 75 ? 'text-green-600' : flowComparison.retestFlow >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {flowComparison.retestFlow}
                  </span>
                  <DeltaBadge delta={flowComparison.flowDelta ?? 0} />
                </div>
              )}
              {flowComparison.benchmarkClose != null && flowComparison.retestClose != null && (
                <div className="flex items-center gap-2 text-xs">
                  <DeltaIcon delta={flowComparison.closeDelta ?? 0} />
                  <span className="w-20 font-medium">Close</span>
                  <span className="text-muted-foreground w-8 text-right">{flowComparison.benchmarkClose}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={`w-8 font-semibold ${flowComparison.retestClose >= 75 ? 'text-green-600' : flowComparison.retestClose >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {flowComparison.retestClose}
                  </span>
                  <DeltaBadge delta={flowComparison.closeDelta ?? 0} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mistake analysis */}
        {(mistakesFixed.length > 0 || mistakesPersisting.length > 0 || mistakesNew.length > 0) && (
          <div className="space-y-2 pt-2 border-t border-border/40">
            {mistakesFixed.length > 0 && (
              <div className="flex items-start gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <span className="text-[10px] font-semibold text-green-700 dark:text-green-400">Fixed</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {mistakesFixed.map(m => (
                      <Badge key={m} variant="outline" className="text-[9px] h-4 bg-green-50 dark:bg-green-950/20">
                        {MISTAKE_LABELS[m] || m.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {mistakesPersisting.length > 0 && (
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Still active</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {mistakesPersisting.map(m => (
                      <Badge key={m} variant="outline" className="text-[9px] h-4 bg-amber-50 dark:bg-amber-950/20">
                        {MISTAKE_LABELS[m] || m.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {mistakesNew.length > 0 && (
              <div className="flex items-start gap-1.5">
                <XCircle className="h-3.5 w-3.5 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <span className="text-[10px] font-semibold text-red-700 dark:text-red-400">New</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {mistakesNew.map(m => (
                      <Badge key={m} variant="outline" className="text-[9px] h-4 bg-red-50 dark:bg-red-950/20">
                        {MISTAKE_LABELS[m] || m.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
