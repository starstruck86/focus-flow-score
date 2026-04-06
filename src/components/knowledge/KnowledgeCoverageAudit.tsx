/**
 * Knowledge Coverage Audit — proves extraction thoroughness across all resources.
 * Includes: verification queue, re-extraction workflow, audit drilldown, filters.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Brain, AlertTriangle, CheckCircle2, ChevronDown, BarChart3,
  Search, Zap, Loader2, RefreshCw, TrendingUp, Filter, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKnowledgeCoverageAudit, type ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';
import { useKnowledgeStats } from '@/hooks/useKnowledgeItems';
import { useDeepReExtraction } from '@/hooks/useDeepReExtraction';
import { VerificationQueue } from './VerificationQueue';
import { ReExtractionQueue } from './ReExtractionQueue';
import { ResourceAuditDrilldown } from './ResourceAuditDrilldown';
import { RealBottleneckReview } from './RealBottleneckReview';
import { toast } from 'sonner';

type AuditFilter = 'all' | 'resumable' | 'under_extracted' | 'shallow' | 'rich_weak' | 'zero_kis' | 'recently_extracted' | 'biggest_lift';

export function KnowledgeCoverageAudit() {
  const { data: audit, isLoading, refetch } = useKnowledgeCoverageAudit();
  const uiStats = useKnowledgeStats();
  const deepReExtract = useDeepReExtraction();

  const [showAuditTable, setShowAuditTable] = useState(false);
  const [showTop20, setShowTop20] = useState(false);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);

  const selectedResource = useMemo(() => {
    if (!selectedResourceId || !audit) return null;
    return audit.resources.find(r => r.resource_id === selectedResourceId) ?? null;
  }, [selectedResourceId, audit]);

  const isResumable = (x: ResourceAuditRow) =>
    x.extraction_is_resumable
    || (x.extraction_batches_completed > 0 && x.extraction_batches_completed < x.extraction_batch_total)
    || x.last_extraction_run_status === 'partial_complete_resumable';

  const resumableResources = useMemo(() => {
    if (!audit) return [];
    return audit.resources.filter(isResumable);
  }, [audit]);

  const filteredResources = useMemo(() => {
    if (!audit) return [];
    const r = audit.resources;
    switch (auditFilter) {
      case 'resumable': return r.filter(isResumable);
      case 'under_extracted': return r.filter(x => x.under_extracted_flag);
      case 'shallow': return r.filter(x => x.extraction_depth_bucket === 'shallow');
      case 'rich_weak': return r.filter(x => x.content_length >= 3000 && x.kis_per_1k_chars < 1.0);
      case 'zero_kis': return r.filter(x => x.ki_count_total === 0);
      case 'recently_extracted': return r.filter(x => x.last_extraction_run_id != null).sort((a, b) => {
        const aMs = a.last_extraction_duration_ms ?? 0;
        const bMs = b.last_extraction_duration_ms ?? 0;
        return bMs - aMs;
      });
      case 'biggest_lift': return r.filter(x => x.last_extraction_saved_ki_count != null && (x.last_extraction_saved_ki_count ?? 0) > 0)
        .sort((a, b) => (b.last_extraction_saved_ki_count ?? 0) - (a.last_extraction_saved_ki_count ?? 0));
      default: return r;
    }
  }, [audit, auditFilter]);

  if (isLoading || !audit) {
    return (
      <div className="flex items-center justify-center py-12 gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Running coverage audit…</span>
      </div>
    );
  }

  const uiTotal = uiStats.total;
  const uiActive = uiStats.active;
  const dbTotal = audit.dbTotalKIs;
  const dbActive = audit.dbActiveKIs;
  const totalDelta = dbTotal - uiTotal;
  const activeDelta = dbActive - uiActive;
  const hasPaginationBug = (uiTotal === 1000 && dbTotal > 1000) || (uiActive === 1000 && dbActive > 1000);
  const countIntegrityPass = totalDelta === 0 && activeDelta === 0;
  const fullyMinedPct = audit.resources.length > 0 ? Math.round((audit.resourcesFullyMined / audit.resources.length) * 100) : 0;

  const handleFlagForReExtraction = (resources: ResourceAuditRow[], reason: string) => {
    void deepReExtract.flagForReExtraction(resources, reason);
  };

  const handleFlagSingle = (resource: ResourceAuditRow) => {
    void deepReExtract.flagForReExtraction([resource], 'Manual — single resource re-extract');
  };

  return (
    <div className="space-y-4">
      {/* Knowledge Coverage Summary */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Knowledge Coverage Summary
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MiniStat label="Fully Mined" value={audit.resourcesFullyMined} color="text-emerald-600" />
            <MiniStat label="Shallow" value={audit.resourcesShallowlyMined} color="text-amber-500" />
            <MiniStat label="Under-Extracted" value={audit.resourcesUnderExtracted} color="text-destructive" />
            <MiniStat label="Zero KIs" value={audit.resourcesZeroKIs} color="text-muted-foreground" />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Coverage:</span>
            <Progress value={fullyMinedPct} className="h-2 flex-1" />
            <span className="font-medium">{fullyMinedPct}%</span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="border border-border rounded-md p-2">
              <div className="text-lg font-bold">{audit.dbTotalKIs}</div>
              <div className="text-muted-foreground">Total KIs</div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="text-lg font-bold text-emerald-600">{audit.dbActiveKIs}</div>
              <div className="text-muted-foreground">Active KIs</div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="text-lg font-bold">{audit.avgKisPer1k}</div>
              <div className="text-muted-foreground">Avg KIs/1k chars</div>
            </div>
          </div>

          {/* Method Mix */}
          <div className="border border-border rounded-md p-2">
            <div className="text-[10px] text-muted-foreground mb-1 font-medium">Extraction Method Mix</div>
            <div className="flex gap-2 text-xs flex-wrap">
              <Badge variant="default" className="text-[9px]">LLM: {audit.methodMix.llm}</Badge>
              <Badge variant="secondary" className="text-[9px]">Heuristic: {audit.methodMix.heuristic}</Badge>
              <Badge variant="outline" className="text-[9px]">Hybrid: {audit.methodMix.hybrid}</Badge>
              <Badge variant="outline" className="text-[9px]">Unknown: {audit.methodMix.unknown}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumable Extractions */}
      {resumableResources.length > 0 && (
        <Card className="border-blue-500/30 bg-blue-50/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-blue-500" />
              Resumable Extractions ({resumableResources.length})
              <Badge className="text-[9px] bg-blue-600">ACTION NEEDED</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground mb-2">
              These resources have partially completed batch extraction. Resume to finish remaining batches.
            </p>
            <div className="border border-border rounded-md overflow-hidden">
              <div className="max-h-[300px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Resource</TableHead>
                      <TableHead className="text-[10px] text-right">Content</TableHead>
                      <TableHead className="text-[10px] text-right">KIs</TableHead>
                      <TableHead className="text-[10px] text-right">KIs/1k</TableHead>
                      <TableHead className="text-[10px]">Batches</TableHead>
                      <TableHead className="text-[10px]">Next</TableHead>
                      <TableHead className="text-[10px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resumableResources.map(r => (
                      <TableRow key={r.resource_id} className="cursor-pointer hover:bg-accent/50">
                        <TableCell className="text-[11px] max-w-[140px] truncate" onClick={() => setSelectedResourceId(r.resource_id)}>
                          {r.title}
                          <Badge className="ml-1 text-[8px] bg-blue-600">RESUMABLE</Badge>
                        </TableCell>
                        <TableCell className="text-[11px] text-right font-mono">{(r.content_length / 1000).toFixed(1)}k</TableCell>
                        <TableCell className="text-[11px] text-right font-mono">{r.ki_count_total}</TableCell>
                        <TableCell className="text-[11px] text-right font-mono">{r.kis_per_1k_chars}</TableCell>
                        <TableCell className="text-[11px] font-mono">{r.extraction_batches_completed}/{r.extraction_batch_total}</TableCell>
                        <TableCell className="text-[11px] text-blue-600 font-medium">Batch {r.extraction_batches_completed + 1}</TableCell>
                        <TableCell>
                          <Button variant="default" size="sm" className="h-6 text-[10px] gap-1" onClick={() => handleFlagSingle(r)}>
                            <RotateCcw className="h-3 w-3" /> Resume
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verification Queue */}
      <VerificationQueue
        resources={audit.resources}
        onFlagForReExtraction={handleFlagForReExtraction}
        onSelectResource={setSelectedResourceId}
      />

      {/* Real Bottleneck Review */}
      <RealBottleneckReview
        resources={audit.resources}
        queueResults={deepReExtract.queue}
        onFlagForReExtraction={handleFlagForReExtraction}
        onSelectResource={setSelectedResourceId}
      />

      {/* Re-Extraction Queue */}
      <ReExtractionQueue
        queue={deepReExtract.queue}
        isRunning={deepReExtract.isRunning}
        liftSummary={deepReExtract.liftSummary}
        onRunDeepExtraction={deepReExtract.runDeepExtraction}
        onRemove={deepReExtract.removeFromQueue}
        onClear={deepReExtract.clearQueue}
        onMarkExcluded={deepReExtract.markExcluded}
      />

      {/* Under-Extracted Recovery */}
      {audit.resourcesUnderExtracted > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-500" />
              Under-Extracted Resources ({audit.resourcesUnderExtracted})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              These resources have rich content but low KI density. Deep re-extraction could yield significantly more knowledge.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => {
                const underExtracted = audit.resources.filter(r => r.under_extracted_flag && r.content_length >= 1500);
                handleFlagForReExtraction(underExtracted, 'Under-extracted — auto-flagged');
              }}
            >
              <Zap className="h-3 w-3" />
              Flag {audit.resourcesUnderExtracted} for Deep Re-Extraction
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Count Integrity Check */}
      <Card className={cn(!countIntegrityPass && 'border-destructive/30')}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {countIntegrityPass
              ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              : <AlertTriangle className="h-4 w-4 text-destructive" />
            }
            Count Integrity Check
            <Badge variant={countIntegrityPass ? 'default' : 'destructive'} className="text-[10px]">
              {countIntegrityPass ? 'PASS' : 'FAIL'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-1 text-xs">
            <div className="font-medium text-muted-foreground"></div>
            <div className="font-medium text-center">DB</div>
            <div className="font-medium text-center">UI</div>
            <div className="text-muted-foreground">Total KIs</div>
            <div className="text-center font-mono">{dbTotal}</div>
            <div className={cn("text-center font-mono", totalDelta !== 0 && "text-destructive font-bold")}>{uiTotal}</div>
            <div className="text-muted-foreground">Active KIs</div>
            <div className="text-center font-mono">{dbActive}</div>
            <div className={cn("text-center font-mono", activeDelta !== 0 && "text-destructive font-bold")}>{uiActive}</div>
            {totalDelta !== 0 && (
              <>
                <div className="text-muted-foreground">Delta</div>
                <div className="text-center text-destructive font-mono col-span-2">
                  {totalDelta > 0 ? `UI missing ${totalDelta}` : `UI over-counting by ${Math.abs(totalDelta)}`}
                </div>
              </>
            )}
          </div>
          {hasPaginationBug && (
            <div className="mt-2 text-[11px] bg-destructive/10 text-destructive rounded-md px-3 py-2">
              ⚠️ Likely pagination/query cap bug — UI shows exactly 1000 but DB has {dbTotal}.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top 20 Weakest */}
      <Collapsible open={showTop20} onOpenChange={setShowTop20}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between border border-border rounded-md px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" />
              Top 20 Richest Resources with Weakest KI Density
            </span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showTop20 && "rotate-180")} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="border border-border rounded-md overflow-hidden">
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Resource</TableHead>
                    <TableHead className="text-[10px] text-right">Content</TableHead>
                    <TableHead className="text-[10px] text-right">KIs</TableHead>
                    <TableHead className="text-[10px] text-right">KIs/1k</TableHead>
                    <TableHead className="text-[10px]">Depth</TableHead>
                    <TableHead className="text-[10px]">Mode</TableHead>
                    <TableHead className="text-[10px]">Passes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.top20Weakest.map(r => (
                    <TableRow
                      key={r.resource_id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => setSelectedResourceId(r.resource_id)}
                    >
                      <TableCell className="text-[11px] max-w-[160px] truncate">{r.title}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{(r.content_length / 1000).toFixed(1)}k</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{r.ki_count_total}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{r.kis_per_1k_chars}</TableCell>
                      <TableCell><DepthBadge bucket={r.extraction_depth_bucket} /></TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{r.extraction_mode}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        {r.extraction_passes_run.length > 0 ? r.extraction_passes_run.join('+') : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Full Audit Table with Filters */}
      <Collapsible open={showAuditTable} onOpenChange={setShowAuditTable}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between border border-border rounded-md px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5" />
              Full Resource Audit Table ({filteredResources.length} resources)
            </span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAuditTable && "rotate-180")} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {/* Filters */}
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={auditFilter} onValueChange={(v) => setAuditFilter(v as AuditFilter)}>
              <SelectTrigger className="h-7 text-xs w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Resources</SelectItem>
                <SelectItem value="resumable">Resumable Only</SelectItem>
                <SelectItem value="under_extracted">Under-Extracted Only</SelectItem>
                <SelectItem value="shallow">Shallow Only</SelectItem>
                <SelectItem value="rich_weak">Rich Content, Weak Density</SelectItem>
                <SelectItem value="zero_kis">Zero KIs</SelectItem>
                <SelectItem value="recently_extracted">Recently Extracted</SelectItem>
                <SelectItem value="biggest_lift">Biggest KI Lift</SelectItem>
              </SelectContent>
            </Select>
            {auditFilter !== 'all' && (
              <Badge variant="secondary" className="text-[9px]">{filteredResources.length} results</Badge>
            )}
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Resource</TableHead>
                    <TableHead className="text-[10px]">Type</TableHead>
                    <TableHead className="text-[10px] text-right">Content</TableHead>
                    <TableHead className="text-[10px] text-right">KIs</TableHead>
                    <TableHead className="text-[10px] text-right">Active</TableHead>
                    <TableHead className="text-[10px] text-right">KIs/1k</TableHead>
                    <TableHead className="text-[10px]">Depth</TableHead>
                    <TableHead className="text-[10px]">Mode</TableHead>
                    <TableHead className="text-[10px]">Passes</TableHead>
                    <TableHead className="text-[10px]">Method</TableHead>
                    <TableHead className="text-[10px]">Flag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResources.map(r => (
                    <TableRow
                      key={r.resource_id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => setSelectedResourceId(r.resource_id)}
                    >
                      <TableCell className="text-[11px] max-w-[150px] truncate">{r.title}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{r.resource_type}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{(r.content_length / 1000).toFixed(1)}k</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{r.ki_count_total}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{r.ki_count_active}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">{r.kis_per_1k_chars}</TableCell>
                      <TableCell><DepthBadge bucket={r.extraction_depth_bucket} /></TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{r.extraction_mode}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        {r.extraction_passes_run.length > 0 ? r.extraction_passes_run.join('+') : '—'}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{r.extraction_method || '—'}</TableCell>
                      <TableCell>
                        {r.under_extracted_flag && (
                          <Badge variant="destructive" className="text-[9px]">Under</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Resource Audit Drilldown */}
      <ResourceAuditDrilldown
        resource={selectedResource}
        open={!!selectedResourceId}
        onOpenChange={(open) => { if (!open) setSelectedResourceId(null); }}
        onReExtract={handleFlagSingle}
        onMarkExcluded={deepReExtract.markExcluded}
        isExcluded={selectedResourceId ? deepReExtract.excludedResourceIds.has(selectedResourceId) : false}
        lastQueueResult={selectedResourceId ? deepReExtract.queue.find(q => q.resource_id === selectedResourceId) : undefined}
      />
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border border-border rounded-md p-2 text-center">
      <div className={cn("text-xl font-bold", color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DepthBadge({ bucket }: { bucket: string }) {
  const variant = bucket === 'strong' ? 'default'
    : bucket === 'moderate' ? 'secondary'
    : bucket === 'shallow' ? 'outline'
    : 'destructive';
  return <Badge variant={variant} className="text-[9px]">{bucket}</Badge>;
}
