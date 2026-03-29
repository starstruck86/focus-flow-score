/**
 * Clickable summary cards for enrichment buckets.
 * Uses mapVerifiedToBucket for consistent counts with the workbench.
 * Phase 2: includes platform breakdown reporting.
 */
import { useMemo } from 'react';
import { CheckCircle2, Zap, FileText, Clock, Ban, Wrench, ScanSearch, HandHelping } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BucketFilter } from './types';
import { mapVerifiedToBucket } from './types';
import type { EnrichmentHealthStats } from '@/lib/canonicalResourceState';
import type { VerifiedResource } from '@/lib/enrichmentVerification';

interface Props {
  health: EnrichmentHealthStats;
  activeBucket: BucketFilter;
  onBucketClick: (bucket: BucketFilter) => void;
  deltaComplete?: number | null;
  verifiedResources?: VerifiedResource[];
}

const CARD_DEFS: Array<{
  bucket: BucketFilter;
  icon: React.ReactNode;
  healthKey: keyof EnrichmentHealthStats;
  label: string;
  color: string;
  bg: string;
}> = [
  { bucket: 'complete', icon: <CheckCircle2 className="h-4 w-4" />, healthKey: 'trulyComplete', label: 'Complete', color: 'text-status-green', bg: 'bg-status-green/10 border-status-green/30' },
  { bucket: 'auto_fixable', icon: <Zap className="h-4 w-4" />, healthKey: 'machinFixable', label: 'Auto-fixable', color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  { bucket: 'advanced_extraction', icon: <ScanSearch className="h-4 w-4" />, healthKey: 'advancedExtractionPending', label: 'Deep Extract', color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  { bucket: 'assisted_resolution', icon: <HandHelping className="h-4 w-4" />, healthKey: 'awaitingAssistedResolution', label: 'Assisted', color: 'text-status-yellow', bg: 'bg-status-yellow/10 border-status-yellow/30' },
  { bucket: 'needs_input', icon: <FileText className="h-4 w-4" />, healthKey: 'needsInput', label: 'Needs Input', color: 'text-status-yellow', bg: 'bg-status-yellow/10 border-status-yellow/30' },
  { bucket: 'processing', icon: <Clock className="h-4 w-4" />, healthKey: 'enriching', label: 'Processing', color: 'text-muted-foreground', bg: 'bg-muted border-border' },
  { bucket: 'quarantined', icon: <Ban className="h-4 w-4" />, healthKey: 'quarantined', label: 'Quarantined', color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' },
  { bucket: 'system_gap', icon: <Wrench className="h-4 w-4" />, healthKey: 'systemGap', label: 'System Gap', color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' },
];

/** Compute platform-level breakdown from verified resources */
function computePlatformBreakdown(resources: VerifiedResource[]) {
  const platforms: Record<string, { total: number; resolved: number; failureCategories: Record<string, number> }> = {};

  for (const r of resources) {
    const platform = r.platform || 'Unknown';
    if (!platforms[platform]) platforms[platform] = { total: 0, resolved: 0, failureCategories: {} };
    platforms[platform].total++;
    if (r.fixabilityBucket === 'truly_complete') {
      platforms[platform].resolved++;
    } else if (r.failureCategory) {
      platforms[platform].failureCategories[r.failureCategory] =
        (platforms[platform].failureCategories[r.failureCategory] || 0) + 1;
    }
  }

  return Object.entries(platforms)
    .filter(([_, v]) => v.total > 1 || v.total - v.resolved > 0)
    .sort((a, b) => (b[1].total - b[1].resolved) - (a[1].total - a[1].resolved))
    .slice(0, 6);
}

export function SummaryCards({ health, activeBucket, onBucketClick, deltaComplete, verifiedResources }: Props) {
  // Compute bucket counts from verified resources (same logic as workbench filter)
  const bucketCounts = useMemo(() => {
    if (!verifiedResources?.length) return null;
    const counts: Record<BucketFilter, number> = { all: verifiedResources.length, complete: 0, auto_fixable: 0, advanced_extraction: 0, assisted_resolution: 0, needs_input: 0, processing: 0, quarantined: 0, system_gap: 0 };
    for (const r of verifiedResources) {
      const b = mapVerifiedToBucket(r);
      counts[b]++;
    }
    return counts;
  }, [verifiedResources]);

  const platformBreakdown = useMemo(() => {
    if (!verifiedResources?.length) return [];
    return computePlatformBreakdown(verifiedResources);
  }, [verifiedResources]);

  const getCount = (card: typeof CARD_DEFS[number]) => {
    if (bucketCounts) return bucketCounts[card.bucket];
    return health[card.healthKey] as number;
  };

  const total = bucketCounts ? bucketCounts.all : health.total;
  const complete = bucketCounts ? bucketCounts.complete : health.trulyComplete;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;

  return (
    <div className="space-y-2 sticky top-0 z-20 bg-background pb-2">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-foreground">
              {pct}% Complete
              {deltaComplete != null && deltaComplete !== 0 && (
                <span className={cn('ml-1.5 text-[10px]', deltaComplete > 0 ? 'text-status-green' : 'text-destructive')}>
                  ({deltaComplete > 0 ? '+' : ''}{deltaComplete} since last run)
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">{complete}/{total}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-status-green rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {CARD_DEFS.map(card => {
          const count = getCount(card);
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

      {/* Platform breakdown — Phase 2 reporting */}
      {platformBreakdown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {platformBreakdown.map(([platform, stats]) => {
            const remaining = stats.total - stats.resolved;
            if (remaining === 0) return null;
            const topFailure = Object.entries(stats.failureCategories).sort((a, b) => b[1] - a[1])[0];
            return (
              <div key={platform} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
                <span className="text-[9px] font-medium text-foreground">{platform}</span>
                <span className="text-[9px] text-muted-foreground">{stats.resolved}/{stats.total}</span>
                {topFailure && (
                  <span className="text-[8px] text-destructive/70 truncate max-w-[80px]" title={topFailure[0]}>
                    {topFailure[0].replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Active filter indicator */}
      {activeBucket !== 'all' && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            Showing: {CARD_DEFS.find(c => c.bucket === activeBucket)?.label}
          </Badge>
          <button onClick={() => onBucketClick('all')} className="text-[10px] text-primary hover:underline">
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}
