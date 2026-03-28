/**
 * Clickable summary cards for enrichment buckets.
 * Part 1 + Part 10C — KPI clarity with drilldown.
 */
import { CheckCircle2, Zap, FileText, Clock, Ban, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BucketFilter } from './types';
import type { EnrichmentHealthStats } from '@/lib/canonicalResourceState';

interface Props {
  health: EnrichmentHealthStats;
  activeBucket: BucketFilter;
  onBucketClick: (bucket: BucketFilter) => void;
  deltaComplete?: number | null;
}

const CARDS: Array<{
  bucket: BucketFilter;
  icon: React.ReactNode;
  getCount: (h: EnrichmentHealthStats) => number;
  label: string;
  color: string;
  bg: string;
}> = [
  { bucket: 'complete', icon: <CheckCircle2 className="h-4 w-4" />, getCount: h => h.trulyComplete, label: 'Complete', color: 'text-status-green', bg: 'bg-status-green/10 border-status-green/30' },
  { bucket: 'auto_fixable', icon: <Zap className="h-4 w-4" />, getCount: h => h.machinFixable, label: 'Auto-fixable', color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  { bucket: 'needs_input', icon: <FileText className="h-4 w-4" />, getCount: h => h.needsInput, label: 'Needs Input', color: 'text-status-yellow', bg: 'bg-status-yellow/10 border-status-yellow/30' },
  { bucket: 'processing', icon: <Clock className="h-4 w-4" />, getCount: h => h.enriching, label: 'Processing', color: 'text-muted-foreground', bg: 'bg-muted border-border' },
  { bucket: 'quarantined', icon: <Ban className="h-4 w-4" />, getCount: h => h.quarantined, label: 'Quarantined', color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' },
  { bucket: 'system_gap', icon: <Wrench className="h-4 w-4" />, getCount: h => h.systemGap, label: 'System Gap', color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' },
];

export function SummaryCards({ health, activeBucket, onBucketClick, deltaComplete }: Props) {
  return (
    <div className="space-y-2 sticky top-0 z-20 bg-background pb-2">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-foreground">
              {health.completionPct}% Complete
              {deltaComplete != null && deltaComplete !== 0 && (
                <span className={cn('ml-1.5 text-[10px]', deltaComplete > 0 ? 'text-status-green' : 'text-destructive')}>
                  ({deltaComplete > 0 ? '+' : ''}{deltaComplete} since last run)
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">{health.trulyComplete}/{health.total}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-status-green rounded-full transition-all duration-500" style={{ width: `${health.completionPct}%` }} />
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {CARDS.map(card => {
          const count = card.getCount(health);
          const isActive = activeBucket === card.bucket;
          return (
            <button
              key={card.bucket}
              onClick={() => onBucketClick(isActive ? 'all' : card.bucket)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-all cursor-pointer text-left',
                isActive ? cn(card.bg, 'ring-2 ring-ring') : 'border-border hover:border-foreground/20',
              )}
            >
              <div className={card.color}>{card.icon}</div>
              <div>
                <p className={cn('text-sm font-bold leading-none', card.color)}>{count}</p>
                <p className="text-[9px] text-muted-foreground leading-tight">{card.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Active filter indicator */}
      {activeBucket !== 'all' && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            Showing: {CARDS.find(c => c.bucket === activeBucket)?.label}
          </Badge>
          <button onClick={() => onBucketClick('all')} className="text-[10px] text-primary hover:underline">
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}
