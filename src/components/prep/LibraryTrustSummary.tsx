/**
 * LibraryTrustSummary — compact library-level trust indicator
 * derived exclusively from deriveLibraryReadiness().
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, Loader2, Shield, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveResourceTruth, deriveLibraryReadiness, type LibraryReadiness } from '@/lib/resourceTruthState';
import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  audioJobsMap?: Map<string, AudioJobRecord>;
}

export function LibraryTrustSummary({ resources, lifecycleMap, audioJobsMap }: Props) {
  const readiness = useMemo<LibraryReadiness>(() => {
    const truths = resources.map(r => {
      const lc = lifecycleMap.get(r.id);
      return deriveResourceTruth(r, lc, audioJobsMap?.get(r.id));
    });
    return deriveLibraryReadiness(truths);
  }, [resources, lifecycleMap, audioJobsMap]);

  if (readiness.total_resources === 0) return null;

  const statusLabel = readiness.system_ready
    ? 'System Ready'
    : readiness.contradiction_count > 0
    ? 'Blocked by Contradictions'
    : readiness.stalled_resources > 0
    ? 'Blocked by Stalled Jobs'
    : readiness.auto_fixable_blocker_count > 0
    ? 'System Not Ready'
    : readiness.manual_only_blocker_count > 0
    ? 'Ready except manual-only blockers'
    : 'System Not Ready';

  const StatusIcon = readiness.system_ready ? CheckCircle2 : AlertTriangle;

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs',
      readiness.system_ready
        ? 'bg-emerald-500/5 border-emerald-500/20'
        : 'bg-amber-500/5 border-amber-500/20',
    )}>
      <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="font-semibold text-foreground shrink-0">Library Trust</span>
      <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
        <Badge className={cn(
          'text-[9px] h-4 gap-0.5',
          readiness.system_ready ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700',
        )}>
          <StatusIcon className="h-2.5 w-2.5" />
          {statusLabel}
        </Badge>
        <span className="text-emerald-600 font-medium">{readiness.ready_resources} ready</span>
        {readiness.processing_resources > 0 && (
          <span className="text-primary">{readiness.processing_resources} processing</span>
        )}
        {readiness.blocked_resources > 0 && (
          <span className="text-destructive">{readiness.blocked_resources} blocked</span>
        )}
        {readiness.stalled_resources > 0 && (
          <span className="text-destructive">{readiness.stalled_resources} stalled</span>
        )}
        {readiness.contradiction_count > 0 && (
          <span className="text-destructive font-medium">{readiness.contradiction_count} contradictions</span>
        )}
        {readiness.auto_fixable_blocker_count > 0 && (
          <span className="text-amber-600">{readiness.auto_fixable_blocker_count} auto-fixable</span>
        )}
        {readiness.manual_only_blocker_count > 0 && (
          <span className="text-muted-foreground">{readiness.manual_only_blocker_count} manual</span>
        )}
      </div>
    </div>
  );
}
