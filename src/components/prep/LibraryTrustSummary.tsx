/**
 * LibraryTrustSummary — compact library-level trust indicator
 * derived exclusively from deriveLibraryReadiness().
 *
 * Shows: system state label, explicit reason string, and blocker counts.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveResourceTruth, deriveLibraryReadiness, type LibraryReadiness } from '@/lib/resourceTruthState';
import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  audioJobsMap?: Map<string, AudioJobRecord>;
}

function getStatusInfo(r: LibraryReadiness): { label: string; reason: string } {
  if (r.system_ready) {
    return { label: 'System Ready', reason: 'All auto-fixable blockers resolved. Library is trustworthy.' };
  }
  if (r.contradiction_count > 0) {
    return {
      label: 'Blocked by Contradictions',
      reason: `${r.contradiction_count} contradiction${r.contradiction_count > 1 ? 's' : ''} detected — resources claim readiness that truth denies.`,
    };
  }
  if (r.stalled_resources > 0) {
    return {
      label: 'Blocked by Stalled Jobs',
      reason: `${r.stalled_resources} job${r.stalled_resources > 1 ? 's' : ''} stalled — processing timed out and needs retry or manual intervention.`,
    };
  }
  if (r.auto_fixable_blocker_count > 0) {
    return {
      label: 'System Not Ready',
      reason: `${r.auto_fixable_blocker_count} auto-fixable blocker${r.auto_fixable_blocker_count > 1 ? 's' : ''} remain — run enrichment/extraction to resolve.`,
    };
  }
  if (r.manual_only_blocker_count > 0) {
    return {
      label: 'Ready except manual blockers',
      reason: `${r.manual_only_blocker_count} manual-only blocker${r.manual_only_blocker_count > 1 ? 's' : ''} remain — these require human review.`,
    };
  }
  return { label: 'System Not Ready', reason: 'Unknown blockers remain.' };
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

  const { label: statusLabel, reason } = getStatusInfo(readiness);
  const StatusIcon = readiness.system_ready ? CheckCircle2 : AlertTriangle;

  return (
    <div className={cn(
      'rounded-lg border text-xs',
      readiness.system_ready
        ? 'bg-emerald-500/5 border-emerald-500/20'
        : 'bg-amber-500/5 border-amber-500/20',
    )}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-semibold text-foreground shrink-0">Library Trust</span>
        <Badge className={cn(
          'text-[9px] h-4 gap-0.5',
          readiness.system_ready ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700',
        )}>
          <StatusIcon className="h-2.5 w-2.5" />
          {statusLabel}
        </Badge>
      </div>

      {/* Reason string */}
      <div className="px-3 pb-1.5">
        <p className="text-[10px] text-muted-foreground">{reason}</p>
      </div>

      {/* Metric pills */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2">
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
        {readiness.qa_required_resources > 0 && (
          <span className="text-amber-600">{readiness.qa_required_resources} QA required</span>
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
