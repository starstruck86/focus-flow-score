/**
 * Per-bucket execution summary panel — shown after a run.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BucketExecutionSummary } from './types';

interface Props {
  summaries: BucketExecutionSummary[];
}

export function BucketSummaryPanel({ summaries }: Props) {
  if (summaries.length === 0) return null;

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <p className="text-xs font-semibold text-foreground">Per-Bucket Execution Summary</p>
        <div className="space-y-1.5">
          {summaries.map(s => (
            <div key={s.bucket} className="rounded-md border border-border p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-foreground">{s.bucketLabel}</span>
                <Badge variant="outline" className="text-[9px] h-4">{s.inputCount} total</Badge>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[10px]">
                <MiniStat label="Attempted" value={s.attemptedCount} />
                <MiniStat label="Resolved" value={s.resolvedCount} color={s.resolvedCount > 0 ? 'text-status-green' : undefined} />
                <MiniStat label="Improved" value={s.improvedNotComplete} color={s.improvedNotComplete > 0 ? 'text-primary' : undefined} />
                <MiniStat label="Skipped" value={s.skippedCount} color={s.skippedCount > 0 ? 'text-status-yellow' : undefined} />
                <MiniStat label="Unchanged" value={s.unchangedCount} />
                <MiniStat label="Failed" value={s.failedCount} color={s.failedCount > 0 ? 'text-destructive' : undefined} />
                {s.autoReleasedFromQuarantine > 0 && (
                  <MiniStat label="Auto-released" value={s.autoReleasedFromQuarantine} color="text-primary" />
                )}
              </div>
              {Object.keys(s.skipReasons).length > 0 && (
                <div className="pt-0.5">
                  <p className="text-[9px] text-muted-foreground font-medium mb-0.5">Skip reasons:</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(s.skipReasons).map(([reason, count]) => (
                      <Badge key={reason} variant="secondary" className="text-[8px] h-3.5 px-1">
                        {reason} ({count})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className={cn('font-bold', color || 'text-foreground')}>{value}</p>
    </div>
  );
}
