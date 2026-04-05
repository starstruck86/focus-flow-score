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

function buildQueue(resources: ResourceAuditRow[]): QueueEntry[] {
  const seen = new Set<string>();
  const entries: QueueEntry[] = [];

  const add = (r: ResourceAuditRow, reason: string, priority: number) => {
    if (seen.has(r.resource_id)) return;
    seen.add(r.resource_id);
    entries.push({ resource: r, reason, priority });
  };

  // Top 10 highest-value under-extracted
  const underExtracted = resources
    .filter(r => r.under_extracted_flag && r.content_length >= 1500)
    .sort((a, b) => b.content_length - a.content_length)
    .slice(0, 10);
  underExtracted.forEach(r => add(r, 'Under-extracted, high content value', 1));

  // Top 10 richest content with weakest KI density
  const richWeak = resources
    .filter(r => r.content_length >= 2000 && r.ki_count_total > 0)
    .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
    .slice(0, 10);
  richWeak.forEach(r => add(r, 'Rich content, weak KI density', 2));

  // Top 5 transcript resources
  const transcripts = resources
    .filter(r => r.resource_type === 'transcript' || r.resource_type === 'podcast')
    .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
    .slice(0, 5);
  transcripts.forEach(r => add(r, 'Transcript — density review', 3));

  // Top 5 structured framework/template resources
  const frameworks = resources
    .filter(r => r.resource_type === 'document' || r.resource_type === 'article')
    .filter(r => r.content_length >= 1500)
    .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
    .slice(0, 5);
  frameworks.forEach(r => add(r, 'Framework/template — density review', 4));

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
