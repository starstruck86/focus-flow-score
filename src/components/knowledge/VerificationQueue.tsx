/**
 * Verification Queue — auto-populated list of resources most likely to benefit
 * from deeper extraction or human review.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Crosshair, Zap } from 'lucide-react';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';

interface Props {
  resources: ResourceAuditRow[];
  onFlagForReExtraction: (resources: ResourceAuditRow[], reason: string) => void;
  onSelectResource: (resourceId: string) => void;
}

interface QueueEntry {
  resource: ResourceAuditRow;
  reason: string;
  priority: number;
}

// Resource type priority: higher = more valuable for extraction
const TYPE_PRIORITY: Record<string, number> = {
  document: 4,   // frameworks, playbooks
  article: 3,    // structured content
  lesson: 2,     // training content
  transcript: 2, // call/podcast transcripts
  podcast: 2,
  reference_only: 0, // excluded
};

function isExcluded(r: ResourceAuditRow): boolean {
  return r.resource_type === 'reference_only';
}

function isResumable(r: ResourceAuditRow): boolean {
  return r.extraction_is_resumable
    || (r.extraction_batches_completed > 0 && r.extraction_batches_completed < r.extraction_batch_total)
    || r.last_extraction_run_status === 'partial_complete_resumable';
}

function isAlreadyStrong(r: ResourceAuditRow): boolean {
  // Resumable resources are NEVER considered "already strong" — they have unfinished work
  if (isResumable(r)) return false;
  return r.extraction_depth_bucket === 'strong' && r.kis_per_1k_chars >= 1.5;
}

function buildQueue(resources: ResourceAuditRow[]): QueueEntry[] {
  const seen = new Set<string>();
  const entries: QueueEntry[] = [];
  // Guardrail: exclude reference_only and already-strong resources
  const eligible = resources.filter(r => !isExcluded(r) && !isAlreadyStrong(r));

  const add = (r: ResourceAuditRow, reason: string, priority: number) => {
    if (seen.has(r.resource_id)) return;
    seen.add(r.resource_id);
    // Boost priority by resource type value
    const typeBoost = TYPE_PRIORITY[r.resource_type] ?? 1;
    entries.push({ resource: r, reason, priority: priority - (typeBoost * 0.1) });
  };

  // Bucket 0 — Resumable extractions always get top priority
  eligible
    .filter(r => isResumable(r))
    .sort((a, b) => b.content_length - a.content_length)
    .forEach(r => add(r, `Resumable — batch ${r.extraction_batches_completed + 1} of ${r.extraction_batch_total}`, 0));

  // Bucket A — High value + under-extracted (content_length ≥ 1500)
  eligible
    .filter(r => r.under_extracted_flag && r.content_length >= 1500)
    .sort((a, b) => b.content_length - a.content_length)
    .slice(0, 10)
    .forEach(r => add(r, 'Under-extracted, high content value', 1));

  // Bucket B — Rich content, weak density (content_length ≥ 3000, kis_per_1k < 1.0)
  eligible
    .filter(r => r.content_length >= 3000 && r.kis_per_1k_chars < 1.0)
    .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
    .slice(0, 10)
    .forEach(r => add(r, 'Rich content, weak KI density', 2));

  // Bucket C — Large framework assets (document, content_length ≥ 5000)
  eligible
    .filter(r => (r.resource_type === 'document' || r.resource_type === 'article') && r.content_length >= 5000)
    .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
    .slice(0, 5)
    .forEach(r => add(r, 'Large framework asset — high extraction potential', 3));

  // Bucket D — Weak transcripts (kis_per_1k < 0.8)
  eligible
    .filter(r => (r.resource_type === 'transcript' || r.resource_type === 'podcast') && r.kis_per_1k_chars < 0.8)
    .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
    .slice(0, 5)
    .forEach(r => add(r, 'Transcript — weak density', 4));

  return entries.sort((a, b) => a.priority - b.priority);
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
                <TableHead className="text-[10px]">Reason</TableHead>
                <TableHead className="text-[10px]">Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map(({ resource: r, reason }) => (
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
                  <TableCell className="text-[10px] text-muted-foreground max-w-[120px] truncate">{reason}</TableCell>
                  <TableCell className="text-[10px] text-muted-foreground max-w-[150px] truncate">
                    {r.last_extraction_summary || '—'}
                  </TableCell>
                </TableRow>
              ))}
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
