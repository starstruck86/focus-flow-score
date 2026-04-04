/**
 * NeedsAttentionQueue — Prioritized operational queue for resources needing intervention.
 * Groups by issue type, shows counts, reasons, quick actions, and bulk-fix opportunities.
 * Items sorted by severity within each group.
 */
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  XCircle, AlertTriangle, Zap, TrendingDown, Clock, Shield,
  HelpCircle, ChevronDown, ChevronRight, CheckCircle2, Layers, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveResourceTruth } from '@/lib/resourceTruthState';
import { detectDrift } from '@/lib/resourceLifecycle';
import { isJobStale } from '@/store/useResourceJobProgress';
import { deriveProcessingRoute, PIPELINE_LABELS, EXTRACTION_METHOD_LABELS } from '@/lib/processingRoute';
import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';

interface QueueItem {
  resource: Resource;
  issueType: string;
  reason: string;
  priority: number;       // group priority (1 = highest)
  severity: number;       // within-group severity (lower = more urgent)
  actionLabel: string;
  actionKey: string;
  bulkEligible: boolean;
}

interface QueueGroup {
  type: string;
  label: string;
  icon: React.ElementType;
  color: string;
  items: QueueItem[];
  bulkActionLabel?: string;
  bulkActionKey?: string;
}

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  audioJobsMap?: Map<string, AudioJobRecord>;
  onAction: (action: string, resource: Resource) => void;
  onInspect: (resource: Resource) => void;
}

/** Compute a severity score for within-group sorting (lower = more urgent) */
function computeSeverity(r: Resource, issueType: string): number {
  const age = Date.now() - new Date(r.updated_at || r.created_at).getTime();
  const ageHours = age / (1000 * 60 * 60);
  // Recent items are more urgent (lower score)
  let score = Math.min(ageHours, 720); // cap at 30 days
  // Failed items that have been failing longer are more urgent
  if (issueType === 'failed' && r.failure_reason) score -= 100;
  return score;
}

export function NeedsAttentionQueue({ resources, lifecycleMap, audioJobsMap, onAction, onInspect }: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['stuck', 'failed', 'missing_content', 'needs_extraction']));

  const groups = useMemo<QueueGroup[]>(() => {
    const failed: QueueItem[] = [];
    const stuck: QueueItem[] = [];
    const contradictions: QueueItem[] = [];
    const missingContent: QueueItem[] = [];
    const needsExtraction: QueueItem[] = [];
    const lowYield: QueueItem[] = [];
    const stale: QueueItem[] = [];
    const needsReview: QueueItem[] = [];

    for (const r of resources) {
      const lc = lifecycleMap.get(r.id);
      if (!lc) continue;
      const rAny = r as any;
      const truth = deriveResourceTruth(r, lc, audioJobsMap?.get(r.id));

      // Contradictory state (highest priority)
      if (truth.integrity_issues.length > 0) {
        contradictions.push({
          resource: r, issueType: 'contradiction', priority: 0,
          severity: -truth.integrity_issues.length,
          reason: truth.integrity_issues[0],
          actionLabel: 'Fix', actionKey: 'reset',
          bulkEligible: false,
        });
      }

      // Stuck / stalled jobs (highest priority after failed)
      if (rAny.active_job_status === 'running' && isJobStale(rAny.active_job_updated_at, 'running')) {
        const elapsed = Math.round((Date.now() - new Date(rAny.active_job_started_at || rAny.active_job_updated_at).getTime()) / 60000);
        stuck.push({
          resource: r, issueType: 'stuck', priority: 1,
          severity: -elapsed, // longer stuck = more urgent
          reason: `${rAny.active_job_type || 'Job'} stalled for ${elapsed}min — exceeds 10min timeout`,
          actionLabel: 'Inspect', actionKey: 'view',
          bulkEligible: false,
        });
      }

      // Failed extractions
      if (r.enrichment_status === 'failed') {
        failed.push({
          resource: r, issueType: 'failed', priority: 2,
          severity: computeSeverity(r, 'failed'),
          reason: r.failure_reason || 'Extraction failed',
          actionLabel: 'Retry', actionKey: 'deep_enrich',
          bulkEligible: true,
        });
      }

      // Missing content
      if (lc.blocked === 'empty_content') {
        missingContent.push({
          resource: r, issueType: 'missing_content', priority: 3,
          severity: computeSeverity(r, 'missing_content'),
          reason: 'No content available for processing',
          actionLabel: 'Re-enrich', actionKey: 're_enrich',
          bulkEligible: true,
        });
      }

      // Needs extraction
      if (lc.blocked === 'no_extraction' && r.enrichment_status !== 'failed') {
        needsExtraction.push({
          resource: r, issueType: 'needs_extraction', priority: 4,
          severity: computeSeverity(r, 'needs_extraction'),
          reason: 'Content available but no knowledge extracted',
          actionLabel: 'Extract', actionKey: 'extract',
          bulkEligible: true,
        });
      }

      // Low yield — include route context
      if (lc.kiCount > 0 && lc.kiCount <= 2 && lc.stage !== 'operationalized') {
        const route = deriveProcessingRoute(r);
        const routeCtx = `${PIPELINE_LABELS[route.pipeline]} · ${EXTRACTION_METHOD_LABELS[route.extraction_method]}`;
        const suffix = [
          route.has_override ? 'Override' : '',
          route.confidence === 'low' ? 'Low confidence' : '',
        ].filter(Boolean).join(' · ');
        lowYield.push({
          resource: r, issueType: 'low_yield', priority: 5,
          severity: computeSeverity(r, 'low_yield'),
          reason: `Only ${lc.kiCount} KI extracted (${routeCtx}${suffix ? ' · ' + suffix : ''})`,
          actionLabel: 'Inspect', actionKey: 'view',
          bulkEligible: false,
        });
      }

      // Stale / drifted
      const driftCheck = detectDrift(r);
      if (driftCheck.hasDrift) {
        const route = deriveProcessingRoute(r);
        const routeSuffix = route.confidence === 'low' ? ' · Low confidence' : '';
        stale.push({
          resource: r, issueType: 'stale', priority: 6,
          severity: computeSeverity(r, 'stale'),
          reason: `${driftCheck.issues[0] || 'Version drift detected'} (${PIPELINE_LABELS[route.pipeline]}${routeSuffix})`,
          actionLabel: 'Re-enrich', actionKey: 're_enrich',
          bulkEligible: true,
        });
      }

      // Needs review
      if (lc.blocked === 'stale_blocker_state') {
        needsReview.push({
          resource: r, issueType: 'needs_review', priority: 7,
          severity: computeSeverity(r, 'needs_review'),
          reason: 'Stale blocked state — needs manual review',
          actionLabel: 'Review', actionKey: 'view',
          bulkEligible: false,
        });
      }
    }

    // Sort each group by severity (most urgent first)
    const sortBySeverity = (items: QueueItem[]) => items.sort((a, b) => a.severity - b.severity);

    const groups: QueueGroup[] = [];
    if (contradictions.length > 0) groups.push({
      type: 'contradiction', label: 'Contradictory State', icon: AlertTriangle, color: 'text-destructive',
      items: sortBySeverity(contradictions),
    });
    if (stuck.length > 0) groups.push({
      type: 'stuck', label: 'Stuck / Stalled', icon: Loader2, color: 'text-destructive',
      items: sortBySeverity(stuck),
    });
    if (failed.length > 0) groups.push({
      type: 'failed', label: 'Failed Extractions', icon: XCircle, color: 'text-destructive',
      items: sortBySeverity(failed),
      bulkActionLabel: `Retry All ${failed.length}`, bulkActionKey: 'bulk_retry',
    });
    if (missingContent.length > 0) groups.push({
      type: 'missing_content', label: 'Missing Content', icon: AlertTriangle, color: 'text-destructive',
      items: sortBySeverity(missingContent),
      bulkActionLabel: `Re-enrich All ${missingContent.length}`, bulkActionKey: 'bulk_re_enrich',
    });
    if (needsExtraction.length > 0) groups.push({
      type: 'needs_extraction', label: 'Needs Extraction', icon: Zap, color: 'text-amber-600',
      items: sortBySeverity(needsExtraction),
      bulkActionLabel: `Extract All ${needsExtraction.length}`, bulkActionKey: 'bulk_extract',
    });
    if (lowYield.length > 0) groups.push({
      type: 'low_yield', label: 'Low Yield', icon: TrendingDown, color: 'text-amber-600',
      items: sortBySeverity(lowYield),
    });
    if (stale.length > 0) groups.push({
      type: 'stale', label: 'Stale / Drifted', icon: Clock, color: 'text-amber-600',
      items: sortBySeverity(stale),
      bulkActionLabel: `Re-enrich All ${stale.length}`, bulkActionKey: 'bulk_re_enrich',
    });
    if (needsReview.length > 0) groups.push({
      type: 'needs_review', label: 'Needs Review', icon: HelpCircle, color: 'text-amber-600',
      items: sortBySeverity(needsReview),
    });

    return groups;
  }, [resources, lifecycleMap]);

  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  const toggleGroup = (type: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  if (totalItems === 0) {
    return (
      <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <p className="text-xs font-medium text-emerald-600">All clear — no resources need attention</p>
      </div>
    );
  }

  // Top-level urgency summary
  const urgentCount = groups.filter(g => g.type === 'failed' || g.type === 'missing_content').reduce((s, g) => s + g.items.length, 0);
  const fixableCount = groups.reduce((s, g) => s + g.items.filter(i => i.bulkEligible).length, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-foreground" />
          <span className="text-xs font-semibold text-foreground">Needs Attention</span>
          <Badge variant="secondary" className="text-[9px] h-4">{totalItems}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {urgentCount > 0 && (
            <span className="text-destructive font-medium">{urgentCount} urgent</span>
          )}
          {fixableCount > 0 && (
            <span>· {fixableCount} bulk-fixable</span>
          )}
        </div>
      </div>
      <ScrollArea className="max-h-[400px]">
        <div className="divide-y divide-border">
          {groups.map(group => {
            const isExpanded = expandedGroups.has(group.type);
            const Icon = group.icon;
            return (
              <div key={group.type}>
                <button
                  onClick={() => toggleGroup(group.type)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <Icon className={cn('h-3.5 w-3.5', group.color)} />
                  <span className="text-xs font-medium text-foreground">{group.label}</span>
                  <Badge variant="outline" className="text-[9px] h-4 ml-auto">{group.items.length}</Badge>
                </button>
                {isExpanded && (
                  <div className="pb-1">
                    {/* Bulk action bar */}
                    {group.bulkActionLabel && group.items.length > 1 && (
                      <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/20 border-b border-border/50">
                        <Layers className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground flex-1">
                          {group.items.filter(i => i.bulkEligible).length} items can be fixed in bulk
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2"
                          onClick={() => onAction(group.bulkActionKey!, group.items[0].resource)}
                        >
                          {group.bulkActionLabel}
                        </Button>
                      </div>
                    )}
                    {group.items.slice(0, 10).map(item => (
                      <div key={item.resource.id} className="flex items-center gap-2 px-4 py-1.5 hover:bg-muted/20 transition-colors">
                        <button
                          onClick={() => onInspect(item.resource)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className="text-[11px] font-medium text-foreground truncate">{item.resource.title}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{item.reason}</p>
                        </button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 shrink-0"
                          onClick={(e) => { e.stopPropagation(); onAction(item.actionKey, item.resource); }}
                        >
                          {item.actionLabel}
                        </Button>
                      </div>
                    ))}
                    {group.items.length > 10 && (
                      <p className="text-[10px] text-muted-foreground px-4 py-1">
                        + {group.items.length - 10} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
