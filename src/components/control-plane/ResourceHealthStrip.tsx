/**
 * Resource Health Strip — shows resource-level issues at a glance.
 * Blocked, needs extraction, conflicts, processing.
 */
import { AlertTriangle, Zap, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ControlPlaneSummary, ControlPlaneFilter } from '@/lib/controlPlaneState';

interface Props {
  summary: ControlPlaneSummary;
  conflictCount: number;
  onFilterChange: (filter: ControlPlaneFilter) => void;
}

export function ResourceHealthStrip({ summary, conflictCount, onFilterChange }: Props) {
  const issues: { icon: React.ElementType; label: string; value: number; color: string; filter: ControlPlaneFilter }[] = [];

  if (summary.needsReview > 0) {
    issues.push({ icon: AlertTriangle, label: 'Blocked', value: summary.needsReview, color: 'text-destructive', filter: 'needs_review' });
  }
  if (summary.needsExtraction > 0) {
    issues.push({ icon: Zap, label: 'Needs Extraction', value: summary.needsExtraction, color: 'text-amber-600', filter: 'needs_extraction' });
  }
  if (conflictCount > 0) {
    issues.push({ icon: ShieldAlert, label: 'Conflicts', value: conflictCount, color: 'text-destructive', filter: 'conflicts' });
  }
  if (summary.processing > 0) {
    issues.push({ icon: Loader2, label: 'Processing', value: summary.processing, color: 'text-primary', filter: 'processing' });
  }

  if (issues.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-card border-border text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">Resource Health</span>

      <div className="flex items-center gap-3 ml-auto">
        {issues.map(({ icon: Icon, label, value, color, filter }) => (
          <button
            key={label}
            onClick={() => onFilterChange(filter)}
            className={cn('flex items-center gap-1 hover:underline cursor-pointer', color)}
          >
            <Icon className="h-3 w-3" />
            <span className="tabular-nums font-medium">{value}</span>
            <span className="text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
