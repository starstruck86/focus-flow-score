import { useState, useMemo } from 'react';
import { useExtractionResourceList, useExtractionAttempts, useExtractionResourceDetail } from '@/hooks/useExtractionAdmin';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Clock, CheckCircle2, AlertTriangle, XCircle, RotateCcw, Eye } from 'lucide-react';

// ── Status badges ──────────────────────────
function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">Unknown</Badge>;
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; icon?: React.ReactNode }> = {
    extracted: { variant: 'default', label: 'Extracted', icon: <CheckCircle2 className="h-3 w-3" /> },
    extraction_retrying: { variant: 'secondary', label: 'Retrying', icon: <RotateCcw className="h-3 w-3 animate-spin" /> },
    extraction_requires_review: { variant: 'destructive', label: 'Requires Review', icon: <AlertTriangle className="h-3 w-3" /> },
    extraction_failed: { variant: 'destructive', label: 'Failed', icon: <XCircle className="h-3 w-3" /> },
  };
  const cfg = map[status] || { variant: 'outline' as const, label: status };
  return <Badge variant={cfg.variant} className="gap-1">{cfg.icon}{cfg.label}</Badge>;
}

function FailureTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-muted-foreground text-xs">—</span>;
  const colors: Record<string, string> = {
    under_floor_invariant: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
    structural_failure: 'bg-red-500/20 text-red-700 dark:text-red-400',
    segmentation_failure: 'bg-purple-500/20 text-purple-700 dark:text-purple-400',
    model_failure: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
    transient_error: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
  };
  return <Badge variant="outline" className={`text-xs ${colors[type] || ''}`}>{type.replace(/_/g, ' ')}</Badge>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isRetryDue(nextRetryAt: string | null): boolean {
  if (!nextRetryAt) return false;
  return new Date(nextRetryAt).getTime() <= Date.now();
}

// ── Resource Detail View ───────────────────
function ResourceDetail({ resourceId, onBack }: { resourceId: string; onBack: () => void }) {
  const { data: resource } = useExtractionResourceDetail(resourceId);
  const { data: attempts = [] } = useExtractionAttempts(resourceId);
  const audit = resource?.extraction_audit_summary;

  if (!resource) return <div className="text-muted-foreground p-4">Loading…</div>;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 mb-2">
        <ArrowLeft className="h-4 w-4" /> Back to list
      </Button>

      {/* Resource Summary */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Resource Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><span className="text-muted-foreground">Title</span><p className="font-medium truncate">{resource.title}</p></div>
            <div><span className="text-muted-foreground">Status</span><div className="mt-1"><StatusBadge status={resource.enrichment_status} /></div></div>
            <div><span className="text-muted-foreground">Attempts</span><p className="font-mono">{resource.extraction_attempt_count || 0} / {resource.max_extraction_attempts || 4}</p></div>
            <div><span className="text-muted-foreground">Retry Eligible</span><p>{resource.extraction_retry_eligible ? '✅ Yes' : '❌ No'}</p></div>
            <div><span className="text-muted-foreground">Last Failure</span><div className="mt-1"><FailureTypeBadge type={resource.extraction_failure_type} /></div></div>
            <div><span className="text-muted-foreground">Strategy</span><p className="font-mono text-xs">{resource.extractor_strategy || '—'}</p></div>
            <div><span className="text-muted-foreground">Next Retry At</span>
              <p className="text-xs">{resource.next_retry_at ? formatTime(resource.next_retry_at) : '—'}
                {resource.next_retry_at && (
                  <Badge variant="outline" className={`ml-2 text-xs ${isRetryDue(resource.next_retry_at) ? 'bg-green-500/20 text-green-700' : 'bg-yellow-500/20 text-yellow-700'}`}>
                    {isRetryDue(resource.next_retry_at) ? 'Due now' : 'Pending'}
                  </Badge>
                )}
              </p>
            </div>
            <div><span className="text-muted-foreground">Type</span><p className="text-xs">{resource.resource_type || '—'}</p></div>
            <div><span className="text-muted-foreground">Content Length</span><p className="font-mono text-xs">{resource.content_length?.toLocaleString() || '—'} chars</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Summary */}
      {audit && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Terminal Audit Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-muted-foreground">Total Attempts</span><p className="font-mono text-lg font-bold">{audit.total_attempts}</p></div>
              <div><span className="text-muted-foreground">Final KI Count</span><p className="font-mono text-lg font-bold">{audit.final_ki_count}</p></div>
              <div><span className="text-muted-foreground">Min KI Floor</span><p className="font-mono">{audit.min_ki_floor}</p></div>
              <div><span className="text-muted-foreground">Floor Met</span><p>{audit.floor_met ? '✅ Yes' : '❌ No'}</p></div>
              <div><span className="text-muted-foreground">Final Status</span><div className="mt-1"><StatusBadge status={audit.final_status} /></div></div>
              <div><span className="text-muted-foreground">Final Failure Type</span><div className="mt-1"><FailureTypeBadge type={audit.final_failure_type} /></div></div>
              <div><span className="text-muted-foreground">Total Elapsed</span><p className="font-mono">{formatDuration(audit.total_elapsed_ms)}</p></div>
              <div><span className="text-muted-foreground">Structured Lesson</span><p>{audit.is_structured_lesson ? '📚 Yes' : 'No'}</p></div>
              <div className="col-span-2"><span className="text-muted-foreground">Strategies Used</span>
                <div className="flex gap-1 mt-1 flex-wrap">{(audit.strategies_used || []).map((s: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs font-mono">{s}</Badge>
                ))}</div>
              </div>
              <div><span className="text-muted-foreground">Completed At</span><p className="text-xs">{formatTime(audit.completed_at)}</p></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attempt Timeline */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Attempt Timeline ({attempts.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Failure</TableHead>
                <TableHead className="text-right">KIs</TableHead>
                <TableHead className="text-right">Raw</TableHead>
                <TableHead className="text-right">Valid</TableHead>
                <TableHead className="text-right">Dedup</TableHead>
                <TableHead className="text-right">Val Loss%</TableHead>
                <TableHead className="text-right">Dup Loss%</TableHead>
                <TableHead className="text-right">Floor</TableHead>
                <TableHead>Floor Met</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((a, idx) => {
                const isLatest = idx === attempts.length - 1;
                const valLoss = a.raw_item_count > 0 ? Math.round(((a.raw_item_count - a.validated_count) / a.raw_item_count) * 100) : 0;
                const dupLoss = a.validated_count > 0 ? Math.round(((a.validated_count - a.deduped_count) / a.validated_count) * 100) : 0;
                return (
                  <TableRow key={a.id} className={isLatest ? 'bg-accent/50 font-medium' : ''}>
                    <TableCell className="font-mono">{a.attempt_number}{isLatest && <span className="ml-1 text-xs text-primary">←</span>}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs font-mono">{a.strategy}</Badge></TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell><FailureTypeBadge type={a.failure_type} /></TableCell>
                    <TableCell className="text-right font-mono font-bold">{a.ki_count}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{a.raw_item_count}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{a.validated_count}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{a.deduped_count}</TableCell>
                    <TableCell className={`text-right font-mono text-xs ${valLoss > 50 ? 'text-red-600 font-bold' : valLoss > 25 ? 'text-amber-600' : 'text-muted-foreground'}`}>{valLoss}%</TableCell>
                    <TableCell className={`text-right font-mono text-xs ${dupLoss > 30 ? 'text-red-600 font-bold' : dupLoss > 15 ? 'text-amber-600' : 'text-muted-foreground'}`}>{dupLoss}%</TableCell>
                    <TableCell className="text-right font-mono">{a.min_ki_floor}</TableCell>
                    <TableCell>{a.floor_met ? '✅' : '❌'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatDuration(a.duration_ms)}</TableCell>
                    <TableCell className="text-xs">{formatTime(a.completed_at)}</TableCell>
                  </TableRow>
                );
              })}
              {attempts.length === 0 && (
                <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-8">No attempt records found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ──────────────────────────────
export default function ExtractionAdmin() {
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [failureFilter, setFailureFilter] = useState<string>('all');
  const [retryDueNow, setRetryDueNow] = useState(false);
  const [lessonsOnly, setLessonsOnly] = useState(false);

  const filters = useMemo(() => ({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    failureType: failureFilter !== 'all' ? failureFilter : undefined,
    retryDueNow,
    requiresReview: statusFilter === 'extraction_requires_review',
    lessonsOnly,
  }), [statusFilter, failureFilter, retryDueNow, lessonsOnly]);

  const { data: resources = [], isLoading } = useExtractionResourceList(filters);

  if (selectedResourceId) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8 max-w-7xl mx-auto">
        <ResourceDetail resourceId={selectedResourceId} onBack={() => setSelectedResourceId(null)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Extraction Admin</h1>
        <p className="text-muted-foreground text-sm">Operational monitoring for the extraction pipeline</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filter by status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="extracted">Extracted</SelectItem>
                <SelectItem value="extraction_retrying">Retrying</SelectItem>
                <SelectItem value="extraction_requires_review">Requires Review</SelectItem>
                <SelectItem value="extraction_failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={failureFilter} onValueChange={setFailureFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filter by failure" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All failure types</SelectItem>
                <SelectItem value="under_floor_invariant">Under Floor</SelectItem>
                <SelectItem value="structural_failure">Structural</SelectItem>
                <SelectItem value="segmentation_failure">Segmentation</SelectItem>
                <SelectItem value="model_failure">Model Failure</SelectItem>
                <SelectItem value="transient_error">Transient</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant={retryDueNow ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRetryDueNow(!retryDueNow)}
              className="gap-1"
            >
              <Clock className="h-3 w-3" /> Retry Due Now
            </Button>

            <Button
              variant={lessonsOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLessonsOnly(!lessonsOnly)}
            >
              📚 Lessons Only
            </Button>

            <span className="text-xs text-muted-foreground ml-auto">{resources.length} resources</span>
          </div>
        </CardContent>
      </Card>

      {/* Resource List */}
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Last Failure</TableHead>
                  <TableHead>Next Retry</TableHead>
                  <TableHead className="text-right">Final KIs</TableHead>
                  <TableHead>Floor Met</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map(r => {
                  const audit = r.extraction_audit_summary;
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-accent/30" onClick={() => setSelectedResourceId(r.id)}>
                      <TableCell className="max-w-[250px] truncate font-medium">{r.title}</TableCell>
                      <TableCell><StatusBadge status={r.enrichment_status} /></TableCell>
                      <TableCell className="text-right font-mono">{r.extraction_attempt_count || 0}/{r.max_extraction_attempts || 4}</TableCell>
                      <TableCell><FailureTypeBadge type={r.extraction_failure_type} /></TableCell>
                      <TableCell className="text-xs">
                        {r.next_retry_at ? (
                          <span className={isRetryDue(r.next_retry_at) ? 'text-green-600 font-medium' : 'text-yellow-600'}>
                            {isRetryDue(r.next_retry_at) ? 'Due now' : formatTime(r.next_retry_at)}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">{audit?.final_ki_count ?? '—'}</TableCell>
                      <TableCell>{audit?.floor_met === true ? '✅' : audit?.floor_met === false ? '❌' : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatTime(r.updated_at)}</TableCell>
                      <TableCell><Eye className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  );
                })}
                {resources.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No resources match filters</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
