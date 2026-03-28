/**
 * Before/after proof-of-impact dashboard after a run.
 */
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RunSnapshot, RunResult } from './types';

interface Props {
  pre: RunSnapshot;
  post: RunSnapshot;
  result: RunResult;
}

export function ProofOfImpact({ pre, post, result }: Props) {
  const improved = post.complete > pre.complete;
  const newlyResolved = post.complete - pre.complete;
  const scoreDelta = post.avgScore - pre.avgScore;

  return (
    <Card className={improved ? 'border-status-green/30' : 'border-border'}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start gap-2">
          {improved ? <TrendingUp className="h-4 w-4 text-status-green shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-status-yellow shrink-0 mt-0.5" />}
          <div className="flex-1 space-y-1.5">
            <p className="text-xs font-semibold text-foreground">
              {improved ? `System Improved — ${newlyResolved} newly resolved` : 'Verification Complete — Blockers Remain'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-[10px]">
              <Stat label="Scanned" value={pre.total} />
              <Stat label="Broken before" value={pre.broken} />
              <Stat label="Broken after" value={post.broken} color={post.broken < pre.broken ? 'text-status-green' : undefined} />
              <Stat label="Newly resolved" value={newlyResolved} color={newlyResolved > 0 ? 'text-status-green' : undefined} />
              <Stat label="Auto-resolved" value={result.autoResolved} color="text-status-green" />
              <Stat label="Awaiting input" value={result.needsManual} color="text-status-yellow" />
              <Stat label="Quarantined" value={result.quarantined} color="text-destructive" />
              <Stat label="System gaps" value={result.systemGaps} color="text-destructive" />
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span>Before: {pre.complete}/{pre.total} ({Math.round(pre.complete / pre.total * 100)}%)</span>
              <ArrowRight className="h-3 w-3" />
              <span>After: {post.complete}/{post.total} ({Math.round(post.complete / post.total * 100)}%)</span>
              <span className={cn('font-medium', scoreDelta > 0 ? 'text-status-green' : 'text-muted-foreground')}>
                {scoreDelta > 0 ? '+' : ''}{scoreDelta} avg score
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className={cn('font-bold', color || 'text-foreground')}>{value}</p>
    </div>
  );
}
