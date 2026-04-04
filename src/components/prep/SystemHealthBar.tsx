/**
 * SystemHealthBar — top-level overview showing total/ready/blocked/stalled
 * plus a "Needs Attention" summary with quick actions.
 * Now powered by canonical truth model.
 */
import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, TrendingUp, XCircle, Zap, RefreshCw, Eye, Loader2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import { deriveResourceTruth, type ResourceTruth, type LifecycleInfo } from '@/lib/resourceTruthState';

interface HealthCounts {
  total: number;
  ready: number;
  processing: number;
  blocked: number;
  stalled: number;
  qa_required: number;
}

interface AttentionItem {
  label: string;
  count: number;
  icon: React.ElementType;
  color: string;
  actionLabel: string;
  filterKey: string;
}

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  audioJobsMap?: Map<string, AudioJobRecord>;
  onFilterChange: (filter: string) => void;
  activeFilter: string;
}

export function SystemHealthBar({ resources, lifecycleMap, audioJobsMap, onFilterChange, activeFilter }: Props) {
  const counts = useMemo<HealthCounts>(() => {
    const c: HealthCounts = { total: resources.length, ready: 0, processing: 0, blocked: 0, stalled: 0, qa_required: 0 };
    for (const r of resources) {
      const lc = lifecycleMap.get(r.id);
      const truth = deriveResourceTruth(r, lc, audioJobsMap?.get(r.id));
      switch (truth.truth_state) {
        case 'ready': c.ready++; break;
        case 'processing': c.processing++; break;
        case 'stalled': c.stalled++; break;
        case 'qa_required': c.qa_required++; break;
        case 'quarantined':
        case 'reference_only': break; // reference-only not counted as blocked
        case 'blocked':
        default: c.blocked++; break;
      }
    }
    return c;
  }, [resources, lifecycleMap, audioJobsMap]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    let failedCount = 0;
    let needsExtractionCount = 0;
    let emptyContentCount = 0;
    let needsReviewCount = 0;

    let stalledCount = 0;
    let contradictionCount = 0;

    for (const r of resources) {
      const lc = lifecycleMap.get(r.id);
      if (!lc) continue;
      const truth = deriveResourceTruth(r, lc, audioJobsMap?.get(r.id));
      for (const b of truth.all_blockers) {
        switch (b.type) {
          case 'missing_content': emptyContentCount++; break;
          case 'needs_extraction': needsExtractionCount++; break;
          case 'stalled_enrichment':
          case 'stalled_extraction': stalledCount++; break;
          case 'contradictory_state': contradictionCount++; break;
          case 'stale_version': needsReviewCount++; break;
        }
      }
      if (r.enrichment_status === 'failed' && !truth.all_blockers.some(b => b.type === 'stalled_enrichment')) failedCount++;
    }

    if (stalledCount > 0) items.push({
      label: 'Stalled', count: stalledCount, icon: Clock,
      color: 'text-destructive', actionLabel: 'Fix', filterKey: 'stalled',
    });
    if (failedCount > 0) items.push({
      label: 'Failed', count: failedCount, icon: XCircle,
      color: 'text-destructive', actionLabel: 'View', filterKey: 'failed',
    });
    if (emptyContentCount > 0) items.push({
      label: 'Missing content', count: emptyContentCount, icon: AlertTriangle,
      color: 'text-destructive', actionLabel: 'Fix', filterKey: 'missing_content',
    });
    if (needsExtractionCount > 0) items.push({
      label: 'Need extraction', count: needsExtractionCount, icon: Zap,
      color: 'text-amber-600', actionLabel: 'Extract', filterKey: 'needs_extraction',
    });
    if (contradictionCount > 0) items.push({
      label: 'Contradictions', count: contradictionCount, icon: AlertTriangle,
      color: 'text-destructive', actionLabel: 'Fix', filterKey: 'contradictions',
    });
    if (needsReviewCount > 0) items.push({
      label: 'Need review', count: needsReviewCount, icon: Eye,
      color: 'text-amber-600', actionLabel: 'Review', filterKey: 'needs_review',
    });

    return items;
  }, [resources, lifecycleMap, audioJobsMap]);

  const totalAttention = attentionItems.reduce((s, i) => s + i.count, 0);

  return (
    <div className="space-y-2">
      {/* Health counters */}
      <div className="flex items-center gap-2 flex-wrap">
        <HealthPill
          label="Total"
          count={counts.total}
          colorClass="text-foreground"
          bgClass="bg-muted"
          active={activeFilter === 'all'}
          onClick={() => onFilterChange('all')}
        />
        <HealthPill
          label="Ready"
          count={counts.ready}
          colorClass="text-emerald-600"
          bgClass="bg-emerald-500/10"
          icon={<CheckCircle2 className="h-3 w-3" />}
          active={activeFilter === 'ready'}
          onClick={() => onFilterChange('ready')}
        />
        <HealthPill
          label="Processing"
          count={counts.processing}
          colorClass="text-primary"
          bgClass="bg-primary/10"
          icon={<Loader2 className="h-3 w-3" />}
          active={activeFilter === 'processing'}
          onClick={() => onFilterChange('processing')}
        />
        {counts.stalled > 0 && (
          <HealthPill
            label="Stalled"
            count={counts.stalled}
            colorClass="text-destructive"
            bgClass="bg-destructive/10"
            icon={<Clock className="h-3 w-3" />}
            active={activeFilter === 'stalled'}
            onClick={() => onFilterChange('stalled')}
          />
        )}
        {counts.qa_required > 0 && (
          <HealthPill
            label="QA Required"
            count={counts.qa_required}
            colorClass="text-amber-600"
            bgClass="bg-amber-500/10"
            icon={<Eye className="h-3 w-3" />}
            active={activeFilter === 'qa_required'}
            onClick={() => onFilterChange('qa_required')}
          />
        )}
        <HealthPill
          label="Blocked"
          count={counts.blocked}
          colorClass="text-destructive"
          bgClass="bg-destructive/10"
          icon={<AlertTriangle className="h-3 w-3" />}
          active={activeFilter === 'blocked'}
          onClick={() => onFilterChange('blocked')}
        />
      </div>

      {/* Needs attention */}
      {totalAttention > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          <span className="text-[10px] text-muted-foreground font-medium shrink-0">Needs attention:</span>
          {attentionItems.map(item => (
            <button
              key={item.filterKey}
              onClick={() => onFilterChange(item.filterKey)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0',
                activeFilter === item.filterKey
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-accent',
                item.color,
              )}
            >
              <item.icon className="h-3 w-3" />
              <span>{item.count}</span>
              <span className="opacity-70">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthPill({
  label, count, colorClass, bgClass, icon, active, onClick,
}: {
  label: string; count: number; colorClass: string; bgClass: string;
  icon?: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
        active ? 'ring-2 ring-primary shadow-sm' : 'hover:ring-1 hover:ring-border',
        bgClass,
      )}
    >
      {icon}
      <span className={cn('text-base font-bold tabular-nums', colorClass)}>{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </button>
  );
}
