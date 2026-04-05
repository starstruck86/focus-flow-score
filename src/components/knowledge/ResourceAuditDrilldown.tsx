/**
 * Resource-level audit drilldown sheet.
 * Shows full extraction history, metrics, and re-extract action for a single resource.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Loader2, Zap, Clock, FileText, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';

interface Props {
  resource: ResourceAuditRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReExtract: (resource: ResourceAuditRow) => void;
}

function useExtractionRuns(resourceId: string | null) {
  return useQuery({
    queryKey: ['extraction-runs', resourceId],
    queryFn: async () => {
      if (!resourceId) return [];
      const { data, error } = await supabase
        .from('extraction_runs' as any)
        .select('*')
        .eq('resource_id', resourceId)
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!resourceId,
  });
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === 'partial') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

function DepthBadge({ bucket }: { bucket: string }) {
  const variant = bucket === 'strong' ? 'default'
    : bucket === 'moderate' ? 'secondary'
    : bucket === 'shallow' ? 'outline'
    : 'destructive';
  return <Badge variant={variant} className="text-[9px]">{bucket}</Badge>;
}

export function ResourceAuditDrilldown({ resource, open, onOpenChange, onReExtract }: Props) {
  const { data: runs = [], isLoading: runsLoading } = useExtractionRuns(resource?.resource_id ?? null);
  const r = resource;

  if (!r) return null;

  const needsDeepReExtract = r.under_extracted_flag || r.extraction_depth_bucket === 'shallow' || r.extraction_depth_bucket === 'none';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Resource Audit
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {/* Identity */}
          <div>
            <h3 className="text-sm font-semibold truncate">{r.title}</h3>
            <div className="flex gap-2 mt-1">
              <Badge variant="outline" className="text-[9px]">{r.resource_type}</Badge>
              <Badge variant="outline" className="text-[9px]">{r.enrichment_status}</Badge>
              <DepthBadge bucket={r.extraction_depth_bucket} />
              {r.under_extracted_flag && <Badge variant="destructive" className="text-[9px]">Under-Extracted</Badge>}
            </div>
          </div>

          <Separator />

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <MetricCard label="Content Length" value={`${(r.content_length / 1000).toFixed(1)}k chars`} />
            <MetricCard label="Total KIs" value={String(r.ki_count_total)} />
            <MetricCard label="Active KIs" value={String(r.ki_count_active)} highlight={r.ki_count_active < r.ki_count_total} />
            <MetricCard label="KIs w/ Context" value={String(r.ki_with_context_count)} highlight={r.ki_with_context_count < r.ki_count_active} />
            <MetricCard label="KIs/1k Chars" value={String(r.kis_per_1k_chars)} />
            <MetricCard label="Extraction Mode" value={r.extraction_mode} />
            <MetricCard label="Method" value={r.extraction_method || 'unknown'} />
            <MetricCard label="Attempts" value={String(r.extraction_attempt_count)} />
          </div>

          {/* Passes & Pipeline */}
          {r.extraction_passes_run.length > 0 && (
            <div className="text-xs">
              <div className="text-muted-foreground font-medium mb-1">Passes Run</div>
              <div className="flex gap-1 flex-wrap">
                {r.extraction_passes_run.map(p => (
                  <Badge key={p} variant="secondary" className="text-[9px]">{p}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Latest Run Metrics */}
          {r.last_extraction_run_id && (
            <>
              <Separator />
              <div className="text-xs">
                <div className="text-muted-foreground font-medium mb-2">Latest Run Snapshot</div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Status:</span><span className="flex items-center gap-1"><RunStatusIcon status={r.last_extraction_run_status || ''} />{r.last_extraction_run_status}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Model:</span><span>{r.last_extraction_model || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Returned:</span><span className="font-mono">{r.last_extraction_returned_ki_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Deduped:</span><span className="font-mono">{r.last_extraction_deduped_ki_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Validated:</span><span className="font-mono">{r.last_extraction_validated_ki_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Saved:</span><span className="font-mono">{r.last_extraction_saved_ki_count ?? '—'}</span></div>
                  {r.last_extraction_duration_ms && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Duration:</span><span>{(r.last_extraction_duration_ms / 1000).toFixed(1)}s</span></div>
                  )}
                </div>
                {r.last_extraction_error && (
                  <div className="mt-2 text-destructive bg-destructive/10 rounded p-2 text-[10px]">{r.last_extraction_error}</div>
                )}
              </div>
            </>
          )}

          {/* Summary */}
          {r.last_extraction_summary && (
            <div className="text-[11px] bg-muted/50 rounded-md p-2">
              <div className="text-muted-foreground font-medium mb-1">Extraction Summary</div>
              {r.last_extraction_summary}
            </div>
          )}

          <Separator />

          {/* Extraction History */}
          <div>
            <div className="text-xs text-muted-foreground font-medium mb-2">Extraction History</div>
            {runsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading runs…
              </div>
            ) : runs.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No extraction runs recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {runs.map((run: any) => (
                  <div key={run.id} className="border border-border rounded-md p-2 text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <RunStatusIcon status={run.status} />
                        <span className="font-medium">{run.status}</span>
                        {run.extraction_mode && <Badge variant="outline" className="text-[8px]">{run.extraction_mode}</Badge>}
                      </span>
                      <span className="text-muted-foreground">
                        {run.started_at ? new Date(run.started_at).toLocaleDateString() : '—'}
                      </span>
                    </div>
                    {run.summary && <div className="text-muted-foreground truncate">{run.summary}</div>}
                    <div className="flex gap-3 text-muted-foreground">
                      {run.saved_candidate_count != null && <span>Saved: {run.saved_candidate_count}</span>}
                      {run.kis_per_1k_chars != null && <span>{run.kis_per_1k_chars} KIs/1k</span>}
                      {run.duration_ms && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Re-Extract Action */}
          {needsDeepReExtract && (
            <div className="pt-2">
              <Button
                className="w-full gap-2"
                onClick={() => { onReExtract(r); onOpenChange(false); }}
              >
                <Zap className="h-4 w-4" />
                Re-Extract This Resource (Deep Mode)
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-1">
                Runs 3-pass deep extraction: Core → Hidden → Framework
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border border-border rounded p-2">
      <div className={cn("font-bold text-sm", highlight && "text-amber-500")}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
