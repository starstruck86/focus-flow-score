/**
 * Control Plane Summary Bar — clickable metric cards that filter the central table.
 */
import { cn } from '@/lib/utils';
import { Database, CheckCircle2, Zap, AlertTriangle, Loader2, Inbox } from 'lucide-react';
import type { ControlPlaneSummary, ControlPlaneFilter } from '@/lib/controlPlaneState';

interface Props {
  summary: ControlPlaneSummary;
  activeFilter: ControlPlaneFilter;
  onFilterChange: (filter: ControlPlaneFilter) => void;
  loading?: boolean;
}

const CARDS: { key: ControlPlaneFilter; label: string; icon: React.ElementType; valueKey: keyof ControlPlaneSummary; color: string; activeBg: string }[] = [
  { key: 'all', label: 'Total', icon: Database, valueKey: 'total', color: 'text-foreground', activeBg: 'bg-accent' },
  { key: 'ready', label: 'Ready', icon: CheckCircle2, valueKey: 'ready', color: 'text-emerald-600', activeBg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  { key: 'needs_extraction', label: 'Needs Extraction', icon: Zap, valueKey: 'needsExtraction', color: 'text-amber-600', activeBg: 'bg-amber-50 dark:bg-amber-950/30' },
  { key: 'needs_review', label: 'Needs Review', icon: AlertTriangle, valueKey: 'needsReview', color: 'text-destructive', activeBg: 'bg-destructive/10' },
  { key: 'processing', label: 'Processing', icon: Loader2, valueKey: 'processing', color: 'text-primary', activeBg: 'bg-primary/10' },
  { key: 'ingested', label: 'Ingested', icon: Inbox, valueKey: 'ingested', color: 'text-muted-foreground', activeBg: 'bg-muted/50' },
];

export function ControlPlaneSummaryBar({ summary, activeFilter, onFilterChange, loading }: Props) {
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
      {CARDS.map(({ key, label, icon: Icon, valueKey, color, activeBg }) => {
        const isActive = activeFilter === key;
        const value = summary[valueKey];
        return (
          <button
            key={key}
            onClick={() => onFilterChange(isActive ? 'all' : key)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg border p-3 transition-all',
              'hover:border-primary/50 cursor-pointer',
              isActive
                ? `${activeBg} border-primary/50 ring-1 ring-primary/20`
                : 'border-border bg-card',
            )}
          >
            <Icon className={cn('h-4 w-4', color, key === 'processing' && loading && 'animate-spin')} />
            <span className={cn('text-xl font-bold tabular-nums', color)}>
              {loading ? '…' : value}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium leading-tight text-center">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
