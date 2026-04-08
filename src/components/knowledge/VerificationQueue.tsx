/**
 * Verification Queue — a DERIVED prioritized review queue.
 *
 * This is NOT a primary routing panel. Resources here still belong to their
 * canonical primary panel (under_extracted, bottleneck_review, etc.).
 *
 * The queue is built from a deterministic subset of canonical states
 * (VERIFICATION_QUEUE_STATES), sorted by priority. It exists as a
 * convenience view for manual review triage.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Crosshair, Zap, Info } from 'lucide-react';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';
import { ResourceOperationProgress } from './ResourceOperationProgress';
import { derivePostExtractionState, VERIFICATION_QUEUE_STATES, type PostExtractionStateResult } from '@/lib/postExtractionState';

interface Props {
  resources: ResourceAuditRow[];
  onFlagForReExtraction: (resources: ResourceAuditRow[], reason: string) => void;
  onSelectResource: (resourceId: string) => void;
}

interface QueueEntry {
  resource: ResourceAuditRow;
  canonical: PostExtractionStateResult;
  priority: number;
}

// Resource type priority: higher = more valuable for extraction
const TYPE_PRIORITY: Record<string, number> = {
  document: 4,
  article: 3,
  lesson: 2,
  transcript: 2,
  podcast: 2,
  reference_only: 0,
};

function buildQueue(resources: ResourceAuditRow[]): QueueEntry[] {
  // Derived queue: filter to resources whose canonical state is in VERIFICATION_QUEUE_STATES
  const eligible = resources.filter(r =>
    VERIFICATION_QUEUE_STATES.includes(derivePostExtractionState(r).state)
  );

  return eligible
    .map(r => {
      const canonical = derivePostExtractionState(r);
      const typeBoost = TYPE_PRIORITY[r.resource_type] ?? 1;
      // Higher content = higher priority, boosted by type value
      const priority = (r.content_length / 1000) + (typeBoost * 2);
      return { resource: r, canonical, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 25);
}

export function VerificationQueue({ resources, onFlagForReExtraction, onSelectResource }: Props) {
  const queue = useMemo(() => buildQueue(resources), [resources]);

  if (queue.length === 0) return null;

  const allResources = queue.map(e => e.resource);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            Verification Queue ({queue.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => onFlagForReExtraction(allResources, 'Verification queue — auto-selected')}
          >
            <Zap className="h-3 w-3" />
            Flag All for Deep Re-Extraction
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Auto-populated: under-extracted, weak density, transcripts, and frameworks needing review.
        </p>
      </CardHeader>
      <CardContent>
        <div className="max-h-[400px] overflow-auto border border-border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px]">Resource</TableHead>
                <TableHead className="text-[10px] text-right">Content</TableHead>
                <TableHead className="text-[10px] text-right">KIs</TableHead>
                <TableHead className="text-[10px] text-right">KIs/1k</TableHead>
                <TableHead className="text-[10px]">Depth</TableHead>
                <TableHead className="text-[10px]">Progress</TableHead>
                <TableHead className="text-[10px]">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map(({ resource: r, canonical }) => {
                const hasActiveOp = r.active_job_status === 'running' || r.active_job_status === 'queued' || r.active_job_status === 'partial';
                return (
                <TableRow
                  key={r.resource_id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => onSelectResource(r.resource_id)}
                >
                  <TableCell className="text-[11px] max-w-[140px] truncate font-medium">{r.title}</TableCell>
                  <TableCell className="text-[11px] text-right font-mono">{(r.content_length / 1000).toFixed(1)}k</TableCell>
                  <TableCell className="text-[11px] text-right font-mono">{r.ki_count_total}</TableCell>
                  <TableCell className="text-[11px] text-right font-mono">{r.kis_per_1k_chars}</TableCell>
                  <TableCell><DepthBadge bucket={r.extraction_depth_bucket} /></TableCell>
                  <TableCell className="min-w-[130px]">
                    {hasActiveOp ? (
                      <ResourceOperationProgress
                        status={r.active_job_status}
                        jobType={r.active_job_type}
                        stepLabel={r.active_job_step_label}
                        progressPct={r.active_job_progress_pct}
                        progressCurrent={r.active_job_progress_current}
                        progressTotal={r.active_job_progress_total}
                        updatedAt={r.active_job_updated_at}
                        compact
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[140px]">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-[9px] cursor-help gap-1">
                            {canonical.label}
                            <Info className="h-2.5 w-2.5" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[250px] text-[11px]">
                          {canonical.explanation}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function DepthBadge({ bucket }: { bucket: string }) {
  const variant = bucket === 'strong' ? 'default'
    : bucket === 'moderate' ? 'secondary'
    : bucket === 'shallow' ? 'outline'
    : 'destructive';
  return <Badge variant={variant} className="text-[9px]">{bucket}</Badge>;
}
