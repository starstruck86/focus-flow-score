/**
 * EnrichmentJobIndicator — floating chip that shows enrichment progress globally.
 * Allows reopening the DeepEnrichModal when a job is active or just finished.
 */
import { useEnrichmentJobStore } from '@/store/useEnrichmentJobStore';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Zap, RefreshCw, Loader2, CheckCircle2, XCircle, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EnrichmentJobIndicatorProps {
  onOpenModal: () => void;
}

export function EnrichmentJobIndicator({ onOpenModal }: EnrichmentJobIndicatorProps) {
  const { state } = useEnrichmentJobStore();

  // Only show when there's an active or recently finished job
  if (state.status === 'idle') return null;

  const isActive = state.status === 'running' || state.status === 'paused';
  const isDone = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
  const progressPct = state.totalItems > 0 ? Math.round((state.processedCount / state.totalItems) * 100) : 0;
  const modeLabel = state.mode === 'deep_enrich' ? 'Deep Enrich' : 'Re-enrich';

  const StatusIcon = state.status === 'running' ? Loader2
    : state.status === 'paused' ? Pause
    : state.status === 'completed' ? CheckCircle2
    : state.status === 'failed' ? XCircle
    : state.mode === 'deep_enrich' ? Zap : RefreshCw;

  return (
    <button
      onClick={onOpenModal}
      className={cn(
        'fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full px-3 py-2 shadow-lg border',
        'bg-card text-card-foreground border-border',
        'hover:shadow-xl transition-shadow cursor-pointer',
        'md:bottom-6',
      )}
    >
      <StatusIcon className={cn(
        'h-4 w-4 shrink-0',
        state.status === 'running' && 'animate-spin text-primary',
        state.status === 'paused' && 'text-status-yellow',
        state.status === 'completed' && 'text-status-green',
        state.status === 'failed' && 'text-status-red',
      )} />

      <div className="flex flex-col items-start gap-0.5 min-w-0">
        <span className="text-xs font-medium leading-none">
          {isActive ? `${modeLabel}… ${state.processedCount}/${state.totalItems}` :
           isDone ? `${modeLabel} done` : modeLabel}
        </span>
        {isActive && (
          <Progress value={progressPct} className="h-1 w-24" />
        )}
        {isDone && (
          <span className="text-[10px] text-muted-foreground leading-none">
            {state.successCount} done
            {state.failedCount > 0 && ` · ${state.failedCount} failed`}
          </span>
        )}
      </div>
    </button>
  );
}
