/**
 * Control Plane Summary Bar — clickable metric cards with inspect popovers.
 */
import { cn } from '@/lib/utils';
import { Database, CheckCircle2, Zap, AlertTriangle, Loader2, Inbox, Info } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import type { ControlPlaneSummary, ControlPlaneFilter } from '@/lib/controlPlaneState';
import { METRIC_DEFINITIONS } from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';

interface Props {
  summary: ControlPlaneSummary;
  activeFilter: ControlPlaneFilter;
  onFilterChange: (filter: ControlPlaneFilter) => void;
  loading?: boolean;
  sampleResources?: Record<string, CanonicalResourceStatus[]>;
  processingCount?: number;
  processingLoading?: boolean;
  processingActive?: boolean;
  onProcessingClick?: () => void;
}

const METRIC_KEY_MAP: Record<string, string> = {
  all: 'total',
  ready: 'ready',
  needs_extraction: 'needsExtraction',
  needs_review: 'needsReview',
  processing: 'processing',
  ingested: 'ingested',
};

const CARDS: { key: ControlPlaneFilter; label: string; icon: React.ElementType; valueKey: keyof ControlPlaneSummary; color: string; activeBg: string }[] = [
  { key: 'all', label: 'Total', icon: Database, valueKey: 'total', color: 'text-foreground', activeBg: 'bg-accent' },
  { key: 'ready', label: 'Ready', icon: CheckCircle2, valueKey: 'ready', color: 'text-emerald-600', activeBg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  { key: 'needs_extraction', label: 'Needs Extraction', icon: Zap, valueKey: 'needsExtraction', color: 'text-amber-600', activeBg: 'bg-amber-50 dark:bg-amber-950/30' },
  { key: 'needs_review', label: 'Blocked', icon: AlertTriangle, valueKey: 'needsReview', color: 'text-destructive', activeBg: 'bg-destructive/10' },
  { key: 'processing', label: 'Processing', icon: Loader2, valueKey: 'processing', color: 'text-primary', activeBg: 'bg-primary/10' },
  { key: 'ingested', label: 'Ingested', icon: Inbox, valueKey: 'ingested', color: 'text-muted-foreground', activeBg: 'bg-muted/50' },
];

export function ControlPlaneSummaryBar({
  summary,
  activeFilter,
  onFilterChange,
  loading,
  sampleResources,
  processingCount,
  processingLoading,
  processingActive,
  onProcessingClick,
}: Props) {
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
      {CARDS.map(({ key, label, icon: Icon, valueKey, color, activeBg }) => {
        const isProcessing = key === 'processing';
        const isActive = isProcessing ? !!processingActive : activeFilter === key;
        const value = isProcessing ? (processingCount ?? summary.processing) : summary[valueKey];
        const metricKey = METRIC_KEY_MAP[key];
        const def = metricKey ? METRIC_DEFINITIONS[metricKey] : null;
        const samples = sampleResources?.[key] ?? [];
        const showSpinner = isProcessing ? (processingLoading || Number(value) > 0) : false;

        return (
          <div key={key} className="relative">
            <button
              onClick={() => {
                if (isProcessing && onProcessingClick) {
                  onProcessingClick();
                  return;
                }
                onFilterChange(isActive ? 'all' : key);
              }}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border p-3 transition-all w-full',
                'hover:border-primary/50 cursor-pointer',
                isActive
                  ? `${activeBg} border-primary/50 ring-1 ring-primary/20`
                  : 'border-border bg-card',
              )}
            >
              <Icon className={cn('h-4 w-4', color, showSpinner && 'animate-spin')} />
              <span className={cn('text-xl font-bold tabular-nums', color)}>
                {isProcessing ? (processingLoading ? '…' : value) : (loading ? '…' : value)}
              </span>
              <span className="text-[10px] text-muted-foreground font-medium leading-tight text-center">
                {label}
              </span>
            </button>

            {def && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="absolute top-1 right-1 p-0.5 rounded-full hover:bg-muted/80 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Info className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-xs space-y-2" side="bottom" align="center">
                  <div className="font-semibold text-foreground">{def.label}</div>
                  <div className="text-muted-foreground">{def.definition}</div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Formula</span>
                      <span className="font-mono text-[10px] text-right max-w-[180px]">{def.formula}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sources</span>
                      <span className="text-right">{def.dataSources.join(', ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last computed</span>
                      <span>{new Date(summary.lastUpdated).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  {samples.length > 0 && (
                    <div className="border-t pt-2 space-y-1">
                      <div className="text-muted-foreground font-medium">Sample resources:</div>
                      {samples.slice(0, 3).map(s => (
                        <div key={s.resource_id} className="truncate text-foreground">
                          • {s.title}
                        </div>
                      ))}
                      {samples.length > 3 && (
                        <div className="text-muted-foreground">+ {samples.length - 3} more</div>
                      )}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
        );
      })}
    </div>
  );
}
