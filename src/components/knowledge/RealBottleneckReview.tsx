/**
 * Real Bottleneck Review — shows resources whose canonical post-extraction state
 * maps to the 'bottleneck_review' panel.
 *
 * Canonical states routed here: api_failure_review, legacy_pipeline_rejection,
 * extractor_weak_review, validator_review, dedup_review, reextract_completed_no_lift.
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
import { Microscope, Zap, Info, CheckCircle2, AlertTriangle, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';
import type { ReExtractQueueItem, DominantBottleneck } from '@/hooks/useDeepReExtraction';
import { filterByPanel, derivePostExtractionState } from '@/lib/postExtractionState';

interface Props {
  resources: ResourceAuditRow[];
  queueResults: ReExtractQueueItem[];
  onFlagForReExtraction: (resources: ResourceAuditRow[], reason: string) => void;
  onSelectResource: (resourceId: string) => void;
}

export type Recommendation =
  | 're-extract again'
  | 'relax validation for this content type'
  | 'dedup too aggressive'
  | 'already well mined'
  | 'not worth re-extracting'
  | 'needs first deep extraction';

interface ReviewRow {
  resource: ResourceAuditRow;
  queueResult: ReExtractQueueItem | null;
  recommendation: Recommendation;
  explanation: string;
  priority: number; // higher = more important
}

function computeRecommendation(r: ResourceAuditRow, qr: ReExtractQueueItem | null): { rec: Recommendation; explanation: string; priority: number } {
  const kisPer1k = r.kis_per_1k_chars;
  const hasRun = !!r.last_extraction_run_id || !!qr;
  const isTranscript = ['transcript', 'podcast', 'audio', 'podcast_episode'].includes(r.resource_type.toLowerCase());
  const isDocument = ['document', 'presentation', 'article'].includes(r.resource_type.toLowerCase());

  // Already well mined
  if (kisPer1k >= 1.5) {
    return { rec: 'already well mined', explanation: `Density ${kisPer1k}/1k is above threshold. No further extraction needed.`, priority: 0 };
  }

  // Never run through updated pipeline
  if (!hasRun) {
    const priority = r.content_length >= 50000 ? 10 : r.content_length >= 10000 ? 8 : 5;
    return { rec: 'needs first deep extraction', explanation: `Never extracted with updated pipeline. ${isDocument ? 'Framework/document' : 'Transcript'} content should yield significantly more KIs.`, priority };
  }

  // Has queue result — analyze bottleneck
  if (qr) {
    if (qr.dominant_bottleneck === 'already_mined') {
      return { rec: 'already well mined', explanation: `Previous run found all generated items already exist.`, priority: 0 };
    }
    if (qr.dominant_bottleneck === 'validation_too_strict') {
      return { rec: 'relax validation for this content type', explanation: `${qr.ef_returned_count ?? 0} items generated but only ${qr.ef_validated_count ?? 0} passed validation. ${isTranscript ? 'Transcript validation thresholds may be too strict.' : 'Document field length requirements may be filtering good items.'}`, priority: 6 };
    }
    if (qr.dominant_bottleneck === 'dedup_too_aggressive') {
      return { rec: 'dedup too aggressive', explanation: `${qr.ef_validated_count ?? 0} items validated but ${qr.duplicates_skipped ?? 0} were deduped. Adjacent-but-distinct concepts may be getting collapsed.`, priority: 5 };
    }
    if (qr.dominant_bottleneck === 'extractor_weak_output') {
      return { rec: 're-extract again', explanation: `Extractor produced only ${qr.ef_returned_count ?? 0} raw items from ${(r.content_length / 1000).toFixed(0)}k chars. May benefit from chunking improvements.`, priority: 7 };
    }
    if (qr.dominant_bottleneck === 'api_failure') {
      return { rec: 're-extract again', explanation: `API failure (credits exhausted or rate-limited). Re-run when credits are available.`, priority: 8 };
    }
    if (qr.dominant_bottleneck === 'legacy_pipeline_rejection') {
      return { rec: 're-extract again', explanation: `Legacy single_pass pipeline rejected valid output. Re-run with current multi-pass pipeline.`, priority: 8 };
    }
    if (qr.ki_delta != null && qr.ki_delta > 0) {
      return { rec: 'already well mined', explanation: `Last run added ${qr.ki_delta} KIs. Current density is ${r.kis_per_1k_chars}/1k.`, priority: 1 };
    }
  }

  // Thin content
  if (r.content_length < 1500) {
    return { rec: 'not worth re-extracting', explanation: `Content only ${r.content_length} chars — too thin for meaningful extraction.`, priority: 0 };
  }

  // Default: worth trying
  const priority = isDocument ? (r.content_length >= 50000 ? 9 : 6) : (r.content_length >= 10000 ? 5 : 3);
  return { rec: 're-extract again', explanation: `${kisPer1k}/1k density is weak for ${(r.content_length / 1000).toFixed(0)}k chars of ${r.resource_type} content. Deep extraction should yield more.`, priority };
}

const recConfig: Record<Recommendation, { cls: string; icon: React.ReactNode }> = {
  're-extract again': { cls: 'border-primary/40 text-primary', icon: <Zap className="h-2.5 w-2.5" /> },
  'relax validation for this content type': { cls: 'border-amber-500/40 text-amber-600', icon: <AlertTriangle className="h-2.5 w-2.5" /> },
  'dedup too aggressive': { cls: 'border-blue-500/40 text-blue-600', icon: <Info className="h-2.5 w-2.5" /> },
  'already well mined': { cls: 'border-emerald-500/40 text-emerald-600', icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
  'not worth re-extracting': { cls: 'border-muted-foreground/40 text-muted-foreground', icon: <Ban className="h-2.5 w-2.5" /> },
  'needs first deep extraction': { cls: 'border-destructive/40 text-destructive', icon: <Zap className="h-2.5 w-2.5" /> },
};

export function RealBottleneckReview({ resources, queueResults, onFlagForReExtraction, onSelectResource }: Props) {
  const reviewRows = useMemo<ReviewRow[]>(() => {
    // ── CANONICAL STATE FILTER ──
    // Only show resources whose post-extraction state routes to 'bottleneck_review'
    const candidates = filterByPanel(resources, 'bottleneck_review')
      .sort((a, b) => a.kis_per_1k_chars - b.kis_per_1k_chars)
      .slice(0, 15);

    return candidates.map(r => {
      const qr = queueResults.find(q => q.resource_id === r.resource_id) ?? null;
      const canonical = derivePostExtractionState(r);
      const { rec, explanation, priority } = computeRecommendation(r, qr);
      return { resource: r, queueResult: qr, recommendation: rec, explanation: `[${canonical.label}] ${explanation}`, priority };
    }).sort((a, b) => b.priority - a.priority);
  }, [resources, queueResults]);

  const actionable = reviewRows.filter(r => r.recommendation === 're-extract again' || r.recommendation === 'needs first deep extraction');

  if (reviewRows.length === 0) return null;

  return (
    <TooltipProvider>
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Microscope className="h-4 w-4 text-primary" />
              Real Bottleneck Review ({reviewRows.length})
            </CardTitle>
            {actionable.length > 0 && (
              <Button
                variant="default"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  const toExtract = actionable.map(r => r.resource);
                  onFlagForReExtraction(toExtract, 'Bottleneck review — high-priority targets');
                }}
              >
                <Zap className="h-3 w-3" />
                Flag {actionable.length} for Re-Extraction
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground mb-3">
            Evidence-based analysis of weak-density resources. Shows why each resource is under-extracted and what to do about it.
          </p>
          <div className="max-h-[400px] overflow-auto border border-border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Resource</TableHead>
                  <TableHead className="text-[10px]">Type</TableHead>
                  <TableHead className="text-[10px] text-right">Content</TableHead>
                  <TableHead className="text-[10px] text-right">KIs</TableHead>
                  <TableHead className="text-[10px] text-right">KIs/1k</TableHead>
                  <TableHead className="text-[10px]">Pipeline</TableHead>
                  <TableHead className="text-[10px]">Bottleneck</TableHead>
                  <TableHead className="text-[10px]">Recommendation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewRows.map(({ resource: r, queueResult: qr, recommendation, explanation }) => {
                  const cfg = recConfig[recommendation];
                  return (
                    <TableRow
                      key={r.resource_id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => onSelectResource(r.resource_id)}
                    >
                      <TableCell>
                        <div className="text-[11px] max-w-[130px] truncate">{r.title}</div>
                        {r.content_length >= 40000 && (
                          <div className="text-[8px] text-primary font-medium">📦 large doc • chunked extraction</div>
                        )}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{r.resource_type}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{(r.content_length / 1000).toFixed(1)}k</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{r.ki_count_total}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{r.kis_per_1k_chars}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        {qr ? (
                          <span>{qr.ef_returned_count ?? '—'}→{qr.ef_validated_count ?? '—'}→{qr.ef_saved_count ?? '—'}</span>
                        ) : r.last_extraction_run_id ? (
                          <span>{r.last_extraction_returned_ki_count ?? '—'}→{r.last_extraction_validated_ki_count ?? '—'}→{r.last_extraction_saved_ki_count ?? '—'}</span>
                        ) : (
                          <span className="text-muted-foreground/50">No runs</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {qr?.dominant_bottleneck && qr.dominant_bottleneck !== 'none' ? (
                          <Badge variant="outline" className="text-[8px] border-destructive/30 text-destructive">
                            {qr.dominant_bottleneck.replace(/_/g, ' ')}
                          </Badge>
                        ) : !r.last_extraction_run_id ? (
                          <Badge variant="outline" className="text-[8px] border-amber-500/30 text-amber-500">never extracted</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className={cn("text-[8px] gap-0.5", cfg.cls)}>
                              {cfg.icon} {recommendation}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[250px] text-xs">{explanation}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}