/**
 * Resource Readiness — the trusted control center for resource health.
 *
 * Surfaces:
 * - "What should I review first?" prioritized sweep guidance
 * - Deterministic bucket classifications with helper text
 * - "Why this bucket?" explanations per resource
 * - Bottleneck labels (Ready for extraction, Active missing contexts, etc.)
 * - Tag quality visibility with required/important separation
 * - Safe bulk actions with confirmation context
 * - Underutilized resource grouping
 */

import { useState, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, RefreshCw, Wrench, Sparkles, Zap, Trash2, Tag, CheckCircle2,
  AlertTriangle, XCircle, FileText, Brain, HelpCircle, Info, ArrowRight,
  ChevronDown, ChevronRight, Rocket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  auditResourceReadiness,
  bulkFixContentBacked,
  bulkAutoTag,
  bulkActivateHighConfidence,
  type AuditSummary,
  type ReadinessBucket,
  type AuditedResource,
} from '@/lib/resourceAudit';
import { autoOperationalizeBatch, summarizeBatchResults, derivePipelineStage, getStageLabel, autoOperationalizeAllResources, countEligibleResources, forceExtractAll, getExtractionCoverage, type BackfillSummary, type ForceExtractResult, type ExtractionCoverage } from '@/lib/autoOperationalize';
import { auditPipelineIntegrity, auditKnowledgeUtilization, getSystemMetrics, type PipelineIntegrityResult, type KnowledgeUtilResult, type SystemMetrics } from '@/lib/salesBrainAudit';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { groupTagsByDimension, getDimensionLabel, getDimensionColor, TAG_TIERS, type TagDimension } from '@/lib/resourceTags';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Bucket metadata ────────────────────────────────────────

const BUCKET_CONFIG: Record<ReadinessBucket, {
  label: string;
  icon: React.ReactNode;
  color: string;
  help: string;
}> = {
  operationalized: {
    label: 'Operationalized',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: 'text-emerald-600',
    help: 'Active knowledge with contexts — already influencing Dave, practice, and prep.',
  },
  content_backed_needs_fix: {
    label: 'Content-Backed Needs Fix',
    icon: <Wrench className="h-3.5 w-3.5" />,
    color: 'text-orange-500',
    help: 'Has valid content but stuck in a stale blocker state. Fix to unlock extraction.',
  },
  blocked_incorrectly: {
    label: 'Blocked Incorrectly',
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: 'text-destructive',
    help: 'Blocked or manual-required without enough content to auto-fix. Review manually.',
  },
  extractable_not_operationalized: {
    label: 'Extractable / Not Activated',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: 'text-blue-500',
    help: 'Enriched with content but knowledge not yet extracted or activated. High-value next step.',
  },
  needs_tagging: {
    label: 'Needs Tagging',
    icon: <Tag className="h-3.5 w-3.5" />,
    color: 'text-amber-500',
    help: 'Missing required tags (skill or context). Auto-tag to make retrievable by Dave.',
  },
  ready: {
    label: 'Ready',
    icon: <FileText className="h-3.5 w-3.5" />,
    color: 'text-primary',
    help: 'Content-backed, enriched, and tagged. Ready for extraction or already usable.',
  },
  junk_or_low_signal: {
    label: 'Junk / Low Signal',
    icon: <Trash2 className="h-3.5 w-3.5" />,
    color: 'text-muted-foreground',
    help: 'Very low content (<50 chars), no URL. Safe to delete if clearly not useful.',
  },
  missing_content: {
    label: 'Missing Content',
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    color: 'text-muted-foreground',
    help: 'No usable content yet. Needs enrichment or manual input to become useful.',
  },
  orphaned_or_inconsistent: {
    label: 'Orphaned / Inconsistent',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: 'text-amber-600',
    help: 'Unusual state combination. Review manually — may need a targeted fix.',
  },
};

// Display order matches priority order
const BUCKET_ORDER: ReadinessBucket[] = [
  'content_backed_needs_fix', 'extractable_not_operationalized', 'needs_tagging',
  'operationalized', 'ready', 'blocked_incorrectly',
  'missing_content', 'junk_or_low_signal', 'orphaned_or_inconsistent',
];

// ── Bulk action confirmation text ──────────────────────────

const BULK_ACTION_DESCRIPTIONS: Record<string, { title: string; safe: string; wontDo: string }> = {
  fix: {
    title: 'Fix Content-Backed Resources',
    safe: 'Clears stale blocker states on resources that already have valid content (>200 chars). Re-verifies each resource before fixing.',
    wontDo: 'Will not touch resources without content. Will not delete or modify content.',
  },
  tag: {
    title: 'Auto-Tag Resources',
    safe: 'Fills in missing required (skill, context) and important (competitor, product) tags based on content analysis.',
    wontDo: 'Will not overwrite existing tags. Will not add weak optional tags (persona, stage, signal).',
  },
  activate: {
    title: 'Activate High-Confidence Knowledge',
    safe: 'Activates extracted knowledge items with confidence ≥70% that already have applies_to_contexts.',
    wontDo: 'Will not activate items without contexts. Will not activate low-confidence items.',
  },
  autoOp: {
    title: 'Auto-Operationalize Ready Resources',
    safe: 'Runs the full pipeline (tag → extract → activate) on content-backed resources that are not yet operationalized.',
    wontDo: 'Will not touch junk, missing-content, or already-operationalized resources. Will not auto-activate low-confidence items.',
  },
  backfillAll: {
    title: 'Operationalize All Existing Resources',
    safe: 'Runs the full pipeline on ALL eligible content-backed resources. Idempotent — already-processed resources pass through quickly.',
    wontDo: 'Will not touch junk or missing-content resources. Will not auto-activate low-confidence items. Will not overwrite user-edited knowledge.',
  },
  backfillSmart: {
    title: 'Operationalize All Eligible (Smart)',
    safe: 'Only processes resources in fixable/extractable/needs-tagging/ready buckets. Faster and more targeted than full backfill.',
    wontDo: 'Will not touch junk, missing-content, or already-operationalized resources. Will not auto-activate low-confidence items.',
  },
  forceExtract: {
    title: 'Force Extract All Missing Knowledge',
    safe: 'Runs extraction on all enriched resources with content_length > 300 that have no knowledge items yet. Then runs the full pipeline.',
    wontDo: 'Will not overwrite existing knowledge items. Will not auto-activate low-confidence items.',
  },
};

// ── Component ──────────────────────────────────────────────

export function ResourceReadinessSheet({ open, onOpenChange }: Props) {
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedBucket, setExpandedBucket] = useState<ReadinessBucket | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: string; ids?: string[] } | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<{ processed: number; total: number } | null>(null);
  const [lastBackfillResult, setLastBackfillResult] = useState<BackfillSummary | null>(null);
  const [deepAudit, setDeepAudit] = useState<{ pipeline?: PipelineIntegrityResult; knowledge?: KnowledgeUtilResult; metrics?: SystemMetrics } | null>(null);
  const [deepAuditLoading, setDeepAuditLoading] = useState(false);
  const [extractionCoverage, setExtractionCoverage] = useState<ExtractionCoverage | null>(null);
  const [forceExtractProgress, setForceExtractProgress] = useState<{ processed: number; total: number } | null>(null);
  const [lastForceExtract, setLastForceExtract] = useState<ForceExtractResult | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    try {
      const [result, coverage] = await Promise.all([
        auditResourceReadiness(),
        getExtractionCoverage(),
      ]);
      setAudit(result);
      setExtractionCoverage(coverage);
    } catch {
      toast.error('Audit failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const executeAction = async (type: string, ids?: string[]) => {
    setActionLoading(type);
    setConfirmAction(null);
    try {
      if (type === 'fix' && ids) {
        const fixed = await bulkFixContentBacked(ids);
        toast.success(`Fixed ${fixed} content-backed resources`);
      } else if (type === 'tag' && ids) {
        const tagged = await bulkAutoTag(ids);
        toast.success(`Auto-tagged ${tagged} resources`);
      } else if (type === 'activate') {
        const count = await bulkActivateHighConfidence();
        toast.success(`Activated ${count} high-confidence knowledge items`);
      } else if (type === 'delete' && ids) {
        let deleted = 0;
        for (const id of ids) {
          const { error } = await supabase.from('resources').delete().eq('id', id);
          if (!error) deleted++;
        }
        toast.success(`Deleted ${deleted} junk resources`);
      } else if (type === 'autoOp' && ids) {
        const results = await autoOperationalizeBatch(ids);
        const summary = summarizeBatchResults(results);
        toast.success(`Auto-operationalized: ${summary.operationalized} fully operationalized, ${summary.totalKnowledgeExtracted} extracted, ${summary.totalKnowledgeActivated} activated`);
        if (summary.needsReview > 0) toast.info(`${summary.needsReview} resources need manual review`);
      } else if (type === 'backfillAll' || type === 'backfillSmart') {
        const mode = type === 'backfillAll' ? 'all' : 'smart';
        setBackfillProgress({ processed: 0, total: 0 });
        const result = await autoOperationalizeAllResources(mode, (processed, total) => {
          setBackfillProgress({ processed, total });
        });
        setBackfillProgress(null);
        setLastBackfillResult(result);
        toast.success(`Backfill complete: ${result.operationalized} operationalized, ${result.totalKnowledgeExtracted} extracted, ${result.totalKnowledgeActivated} activated`);
        if (result.needsReview > 0) toast.info(`${result.needsReview} resources need manual review`);
        if (result.errors > 0) toast.warning(`${result.errors} errors during processing`);
      } else if (type === 'forceExtract') {
        setForceExtractProgress({ processed: 0, total: 0 });
        const extractResult = await forceExtractAll((processed, total) => {
          setForceExtractProgress({ processed, total });
        });
        setForceExtractProgress(null);
        setLastForceExtract(extractResult);
        toast.success(`Force extract: ${extractResult.newKnowledgeItems} items created, ${extractResult.becameOperationalized} operationalized`);
        if (extractResult.contentEmpty > 0) toast.warning(`${extractResult.contentEmpty} resources had empty content despite content_length`);
      }
    } catch {
      toast.error('Action failed');
    }
    setActionLoading(null);
    setBackfillProgress(null);
    setForceExtractProgress(null);
    await runAudit();
  };

  // Build prioritized sweep guidance
  const sweepSteps = audit ? buildSweepGuidance(audit) : [];
  const underutilizedCount = audit
    ? audit.counts.extractable_not_operationalized + audit.counts.needs_tagging
    : 0;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0">
          <SheetHeader className="p-4 pb-2 border-b border-border">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                Resource Readiness
              </SheetTitle>
              <Button size="sm" onClick={runAudit} disabled={loading} className="gap-1.5 h-8">
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {audit ? 'Re-scan' : 'Run Audit'}
              </Button>
            </div>
            {audit && (
              <p className="text-xs text-muted-foreground">
                {audit.totalScanned} resources scanned
              </p>
            )}
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-90px)]">
            {!audit && !loading && (
              <div className="p-8 text-center space-y-3">
                <Brain className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click "Run Audit" to scan all resources</p>
              </div>
            )}

            {loading && !audit && (
              <div className="p-8 text-center space-y-3">
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Scanning resources…</p>
              </div>
            )}

            {audit && (
              <div className="p-4 space-y-3">
                {/* ── Summary stats ── */}
                <div className="grid grid-cols-4 gap-1.5">
                  <MiniStat label="Operationalized" value={audit.counts.operationalized} accent="emerald" />
                  <MiniStat label="Extractable" value={audit.counts.extractable_not_operationalized} accent="blue" />
                  <MiniStat label="Needs Fix" value={audit.counts.content_backed_needs_fix} accent="orange" />
                  <MiniStat label="Underutilized" value={underutilizedCount} accent="amber" />
                </div>

                {/* ── "What should I review first?" ── */}
                {sweepSteps.length > 0 && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-foreground">What should I review first?</p>
                    {sweepSteps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px]">
                        <span className="font-bold text-primary shrink-0 mt-px">{i + 1}.</span>
                        <span className="text-foreground">{step}</span>
                      </div>
                    ))}
                    <p className="text-[9px] text-muted-foreground italic mt-1">
                      Rescue stranded content → extract value → fix targeting → inspect what works
                    </p>
                  </div>
                )}

                {/* ── Validation summary ── */}
                <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1">
                  <p className="text-[10px] font-medium text-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" /> Validation
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span>Missing required tags:</span>
                    <span className={cn('font-medium', audit.validationSummary.missingRequiredTags > 0 ? 'text-amber-600' : 'text-foreground')}>
                      {audit.validationSummary.missingRequiredTags}
                    </span>
                    <span>Active but no contexts:</span>
                    <span className={cn('font-medium', audit.validationSummary.activeButInconsistent > 0 ? 'text-orange-500' : 'text-foreground')}>
                      {audit.validationSummary.activeButInconsistent}
                    </span>
                    <span>Tag quality issues:</span>
                    <span className={cn('font-medium', audit.validationSummary.tagQualityIssueCount > 0 ? 'text-amber-500' : 'text-foreground')}>
                      {audit.validationSummary.tagQualityIssueCount}
                    </span>
                    <span>Fully operationalized:</span>
                    <span className="font-medium text-emerald-600">{audit.validationSummary.operationalizedCount}</span>
                  </div>
                </div>

                <Separator />

                {/* ── Bulk actions with safety context ── */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground">Bulk Actions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {audit.counts.content_backed_needs_fix > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'fix', ids: audit.buckets.content_backed_needs_fix.map(r => r.id) })}>
                        {actionLoading === 'fix' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                        Fix {audit.counts.content_backed_needs_fix} Content-Backed
                      </Button>
                    )}
                    {audit.counts.needs_tagging > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'tag', ids: audit.buckets.needs_tagging.map(r => r.id) })}>
                        {actionLoading === 'tag' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tag className="h-3 w-3" />}
                        Auto-tag {audit.counts.needs_tagging}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                      onClick={() => setConfirmAction({ type: 'activate' })}>
                      {actionLoading === 'activate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Activate High-Confidence
                    </Button>
                    {/* Auto-Operationalize: targets ready + extractable + needs_tagging */}
                    {(audit.counts.ready + audit.counts.extractable_not_operationalized + audit.counts.needs_tagging) > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-primary/30" disabled={!!actionLoading}
                        onClick={() => {
                          const ids = [
                            ...audit.buckets.extractable_not_operationalized,
                            ...audit.buckets.needs_tagging,
                            ...audit.buckets.ready,
                          ].map(r => r.id);
                          setConfirmAction({ type: 'autoOp', ids });
                        }}>
                        {actionLoading === 'autoOp' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                        Auto-Operationalize {audit.counts.ready + audit.counts.extractable_not_operationalized + audit.counts.needs_tagging}
                      </Button>
                    )}
                    {audit.counts.junk_or_low_signal > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'delete', ids: audit.buckets.junk_or_low_signal.map(r => r.id) })}>
                        <Trash2 className="h-3 w-3" />
                        Delete {audit.counts.junk_or_low_signal} Junk
                      </Button>
                    )}
                  </div>

                  {/* ── Backfill actions ── */}
                  <div className="pt-1.5 border-t border-border/50 space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground">Backfill All Existing Resources</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-emerald-500/30" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'backfillSmart' })}>
                        {actionLoading === 'backfillSmart' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3 text-emerald-600" />}
                        Operationalize All Eligible
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'backfillAll' })}>
                        {actionLoading === 'backfillAll' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                        Operationalize All Resources
                      </Button>
                    </div>
                    {backfillProgress && (
                      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Processing {backfillProgress.processed} / {backfillProgress.total} resources…
                      </div>
                    )}
                    {lastBackfillResult && !backfillProgress && (
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] space-y-0.5">
                        <p className="font-medium text-foreground">Last Backfill Results</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Total processed:</span><span className="font-medium text-foreground">{lastBackfillResult.total}</span>
                          <span>Operationalized:</span><span className="font-medium text-emerald-600">{lastBackfillResult.operationalized}</span>
                          <span>KI extracted:</span><span className="font-medium text-foreground">{lastBackfillResult.totalKnowledgeExtracted}</span>
                          <span>KI activated:</span><span className="font-medium text-foreground">{lastBackfillResult.totalKnowledgeActivated}</span>
                          <span>Tags added:</span><span className="font-medium text-foreground">{lastBackfillResult.totalTagsAdded}</span>
                          <span>Need review:</span><span className={cn('font-medium', lastBackfillResult.needsReview > 0 ? 'text-amber-500' : 'text-foreground')}>{lastBackfillResult.needsReview}</span>
                          {lastBackfillResult.errors > 0 && (<><span>Errors:</span><span className="font-medium text-destructive">{lastBackfillResult.errors}</span></>)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Extraction Coverage & Validation Summary ── */}
                  <div className="pt-1.5 border-t border-border/50 space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground">Pipeline Validation Summary</p>
                    {extractionCoverage ? (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[10px] space-y-1">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Enriched resources:</span><span className="font-medium text-foreground">{extractionCoverage.enrichedResources}</span>
                          <span>With knowledge items:</span><span className="font-medium text-foreground">{extractionCoverage.withKnowledgeItems} ({extractionCoverage.kiCoveragePct}%)</span>
                          <span>Operationalized:</span><span className="font-medium text-emerald-600">{extractionCoverage.operationalizedResources} ({extractionCoverage.opCoveragePct}%)</span>
                          <span>No knowledge yet:</span><span className={cn('font-medium', extractionCoverage.noKnowledgeYet > 0 ? 'text-amber-500' : 'text-foreground')}>{extractionCoverage.noKnowledgeYet}</span>
                        </div>
                        {/* Blocked-by breakdown */}
                        {(extractionCoverage.blockedByEmptyContent > 0 || extractionCoverage.blockedByNoExtraction > 0 || extractionCoverage.blockedByActivationCriteria > 0) && (
                          <div className="pt-1 border-t border-border/30">
                            <p className="font-medium text-foreground mb-0.5">Blocked Resources</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                              {extractionCoverage.blockedByEmptyContent > 0 && (
                                <><span>Empty content (stale length):</span><span className="font-medium text-destructive">{extractionCoverage.blockedByEmptyContent}</span></>
                              )}
                              {extractionCoverage.blockedByNoExtraction > 0 && (
                                <><span>Extraction not run:</span><span className="font-medium text-amber-500">{extractionCoverage.blockedByNoExtraction}</span></>
                              )}
                              {extractionCoverage.blockedByActivationCriteria > 0 && (
                                <><span>Activation criteria unmet:</span><span className="font-medium text-orange-500">{extractionCoverage.blockedByActivationCriteria}</span></>
                              )}
                            </div>
                          </div>
                        )}
                        {extractionCoverage.noKnowledgeYet > 0 && (
                          <div className="pt-1">
                            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-amber-500/30" disabled={!!actionLoading}
                              onClick={() => setConfirmAction({ type: 'forceExtract' })}>
                              {actionLoading === 'forceExtract' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 text-amber-500" />}
                              Force Extract All ({extractionCoverage.noKnowledgeYet})
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">Run audit to see coverage</p>
                    )}
                    {forceExtractProgress && (
                      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Force extracting {forceExtractProgress.processed} / {forceExtractProgress.total}…
                      </div>
                    )}
                    {lastForceExtract && !forceExtractProgress && (
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] space-y-0.5">
                        <p className="font-medium text-foreground">Force Extract Results</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Eligible:</span><span className="font-medium text-foreground">{lastForceExtract.eligible}</span>
                          <span>Processed:</span><span className="font-medium text-foreground">{lastForceExtract.processed}</span>
                          <span>New KI created:</span><span className="font-medium text-foreground">{lastForceExtract.newKnowledgeItems}</span>
                          <span>Became operationalized:</span><span className="font-medium text-emerald-600">{lastForceExtract.becameOperationalized}</span>
                          <span>Needs review:</span><span className={cn('font-medium', lastForceExtract.stillNeedsReview > 0 ? 'text-amber-500' : 'text-foreground')}>{lastForceExtract.stillNeedsReview}</span>
                          {lastForceExtract.contentEmpty > 0 && (
                            <><span>Content empty:</span><span className="font-medium text-destructive">{lastForceExtract.contentEmpty}</span></>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Deep Audit ── */}
                  <div className="pt-1.5 border-t border-border/50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-medium text-muted-foreground">System Health Audit</p>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" disabled={deepAuditLoading}
                        onClick={async () => {
                          setDeepAuditLoading(true);
                          try {
                            const [pipeline, knowledge, metrics] = await Promise.all([
                              auditPipelineIntegrity(),
                              auditKnowledgeUtilization(),
                              getSystemMetrics(),
                            ]);
                            setDeepAudit({ pipeline, knowledge, metrics });
                          } catch { toast.error('Audit failed'); }
                          setDeepAuditLoading(false);
                        }}>
                        {deepAuditLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                        Run Deep Audit
                      </Button>
                    </div>

                    {deepAudit?.metrics && (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[10px] space-y-1">
                        <p className="font-medium text-foreground">System Metrics</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Total resources:</span><span className="font-medium text-foreground">{deepAudit.metrics.resources.total}</span>
                          <span>Content-backed:</span><span className="font-medium text-foreground">{deepAudit.metrics.resources.content_backed}</span>
                          <span>With knowledge:</span><span className="font-medium text-foreground">{deepAudit.metrics.resources.with_knowledge}</span>
                          <span>Operationalized:</span><span className="font-medium text-emerald-600">{deepAudit.metrics.resources.operationalized}</span>
                          <span>Stalled:</span><span className={cn('font-medium', deepAudit.metrics.resources.stalled > 0 ? 'text-amber-500' : 'text-foreground')}>{deepAudit.metrics.resources.stalled}</span>
                          <span>Coverage:</span><span className="font-medium text-foreground">{deepAudit.metrics.pipeline.coverage_pct}%</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground pt-1 border-t border-border/30">
                          <span>Total KI:</span><span className="font-medium text-foreground">{deepAudit.metrics.knowledge.total}</span>
                          <span>Active KI:</span><span className="font-medium text-emerald-600">{deepAudit.metrics.knowledge.active}</span>
                          <span>Retrievable KI:</span><span className="font-medium text-foreground">{deepAudit.metrics.knowledge.retrievable}</span>
                          <span>Pending review:</span><span className={cn('font-medium', deepAudit.metrics.knowledge.review_needed > 0 ? 'text-amber-500' : 'text-foreground')}>{deepAudit.metrics.knowledge.review_needed}</span>
                          <span>Auto-activated:</span><span className="font-medium text-foreground">{deepAudit.metrics.pipeline.auto_activated_count}</span>
                          <span>Avg confidence:</span><span className="font-medium text-foreground">{deepAudit.metrics.pipeline.avg_confidence}</span>
                        </div>
                      </div>
                    )}

                    {deepAudit?.pipeline && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                          <span className="font-medium text-foreground flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                            Pipeline Bottlenecks ({deepAudit.pipeline.summary.stalledCount} stalled)
                          </span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1 pl-2 pt-1 text-[10px]">
                            {deepAudit.pipeline.stalled_before_tagging.length > 0 && (
                              <div>
                                <p className="font-medium text-amber-600">Stalled before tagging: {deepAudit.pipeline.stalled_before_tagging.length}</p>
                                {deepAudit.pipeline.stalled_before_tagging.slice(0, 3).map(r => (
                                  <p key={r.id} className="text-muted-foreground pl-2 truncate">• {r.title}</p>
                                ))}
                              </div>
                            )}
                            {deepAudit.pipeline.stalled_before_extraction.length > 0 && (
                              <div>
                                <p className="font-medium text-blue-500">Stalled before extraction: {deepAudit.pipeline.stalled_before_extraction.length}</p>
                                {deepAudit.pipeline.stalled_before_extraction.slice(0, 3).map(r => (
                                  <p key={r.id} className="text-muted-foreground pl-2 truncate">• {r.title}</p>
                                ))}
                              </div>
                            )}
                            {deepAudit.pipeline.stalled_before_activation.length > 0 && (
                              <div>
                                <p className="font-medium text-orange-500">Stalled before activation: {deepAudit.pipeline.stalled_before_activation.length}</p>
                                {deepAudit.pipeline.stalled_before_activation.slice(0, 3).map(r => (
                                  <p key={r.id} className="text-muted-foreground pl-2 truncate">• {r.title}</p>
                                ))}
                              </div>
                            )}
                            {deepAudit.pipeline.activated_but_not_retrievable.length > 0 && (
                              <div>
                                <p className="font-medium text-orange-500">Active but not retrievable: {deepAudit.pipeline.activated_but_not_retrievable.length}</p>
                                {deepAudit.pipeline.activated_but_not_retrievable.slice(0, 3).map(r => (
                                  <p key={r.id} className="text-muted-foreground pl-2 truncate">• {r.title} — {r.issue}</p>
                                ))}
                              </div>
                            )}
                            {deepAudit.pipeline.inconsistent_state.length > 0 && (
                              <div>
                                <p className="font-medium text-destructive">Inconsistent state: {deepAudit.pipeline.inconsistent_state.length}</p>
                                {deepAudit.pipeline.inconsistent_state.slice(0, 3).map(r => (
                                  <p key={r.id} className="text-muted-foreground pl-2 truncate">• {r.title} — {r.issue}</p>
                                ))}
                              </div>
                            )}
                            {deepAudit.pipeline.summary.stalledCount === 0 && (
                              <p className="text-emerald-600 font-medium">✓ No pipeline bottlenecks detected</p>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {deepAudit?.knowledge && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                          <span className="font-medium text-foreground flex items-center gap-1">
                            <Brain className="h-3 w-3 text-blue-500" />
                            Knowledge Utilization ({deepAudit.knowledge.summary.never_used + deepAudit.knowledge.summary.not_retrievable} unused)
                          </span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1 pl-2 pt-1 text-[10px]">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                              <span>Fully utilized:</span><span className="font-medium text-emerald-600">{deepAudit.knowledge.summary.fully_utilized}</span>
                              <span>Prep only:</span><span className="font-medium text-blue-500">{deepAudit.knowledge.summary.used_in_prep_only}</span>
                              <span>Roleplay only:</span><span className="font-medium text-blue-500">{deepAudit.knowledge.summary.used_in_roleplay_only}</span>
                              <span>Dave only:</span><span className="font-medium text-blue-500">{deepAudit.knowledge.summary.used_by_dave_only}</span>
                              <span>Rarely used:</span><span className="font-medium text-amber-500">{deepAudit.knowledge.summary.rarely_used}</span>
                              <span>Never used:</span><span className={cn('font-medium', deepAudit.knowledge.summary.never_used > 0 ? 'text-destructive' : 'text-foreground')}>{deepAudit.knowledge.summary.never_used}</span>
                              <span>Not retrievable:</span><span className={cn('font-medium', deepAudit.knowledge.summary.not_retrievable > 0 ? 'text-destructive' : 'text-foreground')}>{deepAudit.knowledge.summary.not_retrievable}</span>
                            </div>
                            {Object.entries(deepAudit.knowledge.summary.unused_reasons).length > 0 && (
                              <div className="pt-1 border-t border-border/30">
                                <p className="font-medium text-foreground mb-0.5">Root causes:</p>
                                {Object.entries(deepAudit.knowledge.summary.unused_reasons).map(([reason, count]) => (
                                  <p key={reason} className="text-muted-foreground pl-2">• {reason.replace(/_/g, ' ')}: {count as number}</p>
                                ))}
                              </div>
                            )}
                            {deepAudit.knowledge.summary.most_used.length > 0 && (
                              <div className="pt-1 border-t border-border/30">
                                <p className="font-medium text-foreground mb-0.5">Most used:</p>
                                {deepAudit.knowledge.summary.most_used.slice(0, 5).map(ki => (
                                  <p key={ki.id} className="text-muted-foreground pl-2 truncate">• {ki.title} ({ki.total_count}x)</p>
                                ))}
                              </div>
                            )}
                            {deepAudit.knowledge.items.filter(i => i.classification === 'never_used' || i.classification === 'not_retrievable').slice(0, 5).map(ki => (
                              <div key={ki.id} className="pl-2 border-l-2 border-amber-500/30 py-0.5">
                                <p className="font-medium text-foreground truncate">{ki.title}</p>
                                <p className="text-muted-foreground">{ki.issue}</p>
                                <p className="text-primary/80">{ki.recommendation}</p>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                </div>

                <Separator />

                {/* ── Bucket list ── */}
                <div className="space-y-0.5">
                  {BUCKET_ORDER.map(key => {
                    const cfg = BUCKET_CONFIG[key];
                    const count = audit.counts[key];
                    if (count === 0) return null;
                    const isExpanded = expandedBucket === key;

                    return (
                      <div key={key}>
                        <button
                          onClick={() => setExpandedBucket(isExpanded ? null : key)}
                          className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent/50 transition-colors text-left group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={cfg.color}>{cfg.icon}</span>
                            <div className="min-w-0">
                              <span className="text-xs font-medium text-foreground">{cfg.label}</span>
                              <p className="text-[9px] text-muted-foreground truncate">{cfg.help}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant="secondary" className="text-[10px] h-5">{count}</Badge>
                            {isExpanded
                              ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            }
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="ml-4 space-y-1 mb-2">
                            {audit.buckets[key].slice(0, 25).map(r => (
                              <ResourceRow key={r.id} resource={r} />
                            ))}
                            {count > 25 && (
                              <p className="text-[10px] text-muted-foreground pl-2">+ {count - 25} more</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* ── Confirmation dialog for bulk actions ── */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'delete'
                ? `Delete ${confirmAction.ids?.length ?? 0} junk resources?`
                : BULK_ACTION_DESCRIPTIONS[confirmAction?.type ?? '']?.title ?? 'Confirm Action'
              }
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirmAction?.type === 'delete' ? (
                  <p>These resources have very low content (&lt;50 chars) and no URL. This cannot be undone.</p>
                ) : (
                  <>
                    <p><strong>Affects:</strong> {confirmAction?.ids?.length ?? 'all eligible'} {confirmAction?.ids ? 'resources' : 'knowledge items'}</p>
                    <p><strong>Will do:</strong> {BULK_ACTION_DESCRIPTIONS[confirmAction?.type ?? '']?.safe}</p>
                    <p className="text-muted-foreground"><strong>Will NOT:</strong> {BULK_ACTION_DESCRIPTIONS[confirmAction?.type ?? '']?.wontDo}</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && executeAction(confirmAction.type, confirmAction.ids)}
              className={cn(confirmAction?.type === 'delete' && 'bg-destructive text-destructive-foreground')}
              disabled={!!actionLoading}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Sweep guidance builder ─────────────────────────────────

function buildSweepGuidance(audit: AuditSummary): string[] {
  const steps: string[] = [];
  const c = audit.counts;

  if (c.content_backed_needs_fix > 0)
    steps.push(`Fix ${c.content_backed_needs_fix} content-backed resources stuck in bad states`);
  if (c.extractable_not_operationalized > 0)
    steps.push(`Extract knowledge from ${c.extractable_not_operationalized} underutilized resources`);
  if (c.needs_tagging > 0)
    steps.push(`Add missing required tags to ${c.needs_tagging} resources`);
  if (c.operationalized > 0)
    steps.push(`Review ${c.operationalized} operationalized resources already driving behavior`);
  if (c.blocked_incorrectly > 0)
    steps.push(`Manually review ${c.blocked_incorrectly} incorrectly blocked resources`);

  return steps;
}

// ── Bottleneck label ───────────────────────────────────────

function getBottleneckLabel(r: AuditedResource): { text: string; color: string } {
  if (r.bucket === 'operationalized') return { text: 'Fully operationalized', color: 'text-emerald-600' };
  if (r.activeKnowledgeCount > 0 && !r.hasContexts) return { text: 'Active, missing contexts', color: 'text-orange-500' };
  if (r.knowledgeItemCount > 0 && r.activeKnowledgeCount === 0) return { text: 'Extracted, not activated', color: 'text-blue-500' };
  if (r.bucket === 'content_backed_needs_fix') return { text: 'Content-backed but blocked', color: 'text-orange-500' };
  if (r.bucket === 'extractable_not_operationalized' && r.knowledgeItemCount === 0) return { text: 'Ready for extraction', color: 'text-blue-500' };
  if (r.bucket === 'needs_tagging') return { text: 'Needs tagging', color: 'text-amber-500' };
  if (r.bucket === 'junk_or_low_signal') return { text: 'Low signal', color: 'text-muted-foreground' };
  if (r.bucket === 'ready') return { text: 'Ready', color: 'text-primary' };
  return { text: r.bucket.replace(/_/g, ' '), color: 'text-muted-foreground' };
}

// ── Resource row ───────────────────────────────────────────

function ResourceRow({ resource: r }: { resource: AuditedResource }) {
  const tagGroups = groupTagsByDimension(r.tags);
  const bottleneck = getBottleneckLabel(r);
  const pipelineStage = derivePipelineStage(
    { content_length: r.contentLength, tags: r.tags, enrichment_status: r.enrichmentStatus },
    { total: r.knowledgeItemCount, active: r.activeKnowledgeCount, hasContexts: r.hasContexts },
  );

  // Separate tags by tier for display
  const requiredTags: Array<[TagDimension, string[]]> = [];
  const importantTags: Array<[TagDimension, string[]]> = [];
  const optionalTags: Array<[TagDimension, string[]]> = [];

  tagGroups.forEach((vals, dim) => {
    const tier = TAG_TIERS[dim];
    if (tier === 'required') requiredTags.push([dim, vals]);
    else if (tier === 'important') importantTags.push([dim, vals]);
    else optionalTags.push([dim, vals]);
  });

  return (
    <div className="p-2 rounded border border-border bg-card text-xs space-y-1.5">
      {/* Title + bottleneck label + badges */}
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground truncate">{r.title}</p>
          <p className={cn('text-[9px] font-medium', bottleneck.color)}>{bottleneck.text}</p>
        </div>
        <div className="flex gap-0.5 shrink-0 flex-wrap justify-end max-w-[45%]">
          <Badge variant="outline" className="text-[7px] h-3.5 px-1 border-primary/20">{getStageLabel(pipelineStage)}</Badge>
          {r.badges.map(b => (
            <Badge key={b} variant="outline" className="text-[7px] h-3.5 px-1">{b}</Badge>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
        <span>{r.contentLength.toLocaleString()} chars</span>
        <span className="text-border">·</span>
        <span>{r.enrichmentStatus}</span>
        {r.qualityScore !== null && (
          <>
            <span className="text-border">·</span>
            <span>Score {Math.round(r.qualityScore)}</span>
          </>
        )}
        {r.knowledgeItemCount > 0 && (
          <>
            <span className="text-border">·</span>
            <span>{r.activeWithContexts}/{r.activeKnowledgeCount}/{r.knowledgeItemCount} KI</span>
          </>
        )}
      </div>

      {/* Tags by tier */}
      {(requiredTags.length > 0 || importantTags.length > 0) && (
        <div className="flex flex-wrap gap-0.5">
          {requiredTags.map(([dim, vals]) => (
            <Badge key={dim} variant="outline" className={cn('text-[8px] h-3.5 px-1 border-primary/30', getDimensionColor(dim))}>
              {getDimensionLabel(dim)}: {vals.slice(0, 2).join(', ')}
            </Badge>
          ))}
          {importantTags.map(([dim, vals]) => (
            <Badge key={dim} variant="outline" className={cn('text-[8px] h-3.5 px-1', getDimensionColor(dim))}>
              {getDimensionLabel(dim)}: {vals.slice(0, 2).join(', ')}
            </Badge>
          ))}
        </div>
      )}

      {/* Missing required tag warnings */}
      {r.missingRequiredTags.length > 0 && (
        <p className="text-[9px] text-amber-600 flex items-center gap-1">
          <Tag className="h-2.5 w-2.5 shrink-0" />
          Missing: {r.missingRequiredTags.join(', ')}
        </p>
      )}

      {/* Tag quality issues */}
      {r.tagQualityIssues.length > 0 && (
        <div className="space-y-0.5">
          {r.tagQualityIssues.map((issue, i) => (
            <p key={i} className="text-[9px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              {issue.message}
            </p>
          ))}
        </div>
      )}

      {/* Why + action */}
      <div className="border-t border-border/50 pt-1 space-y-0.5">
        <p className="text-[9px] text-muted-foreground">
          <span className="font-medium">Why:</span> {r.bucketReason}
        </p>
        <p className="text-[9px] text-primary/80 flex items-center gap-0.5">
          <ArrowRight className="h-2.5 w-2.5 shrink-0" />
          {r.recommendedAction}
        </p>
      </div>
    </div>
  );
}

// ── Mini stat ──────────────────────────────────────────────

function MiniStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600',
    blue: 'text-blue-500',
    orange: 'text-orange-500',
    amber: 'text-amber-500',
  };
  return (
    <div className="rounded-lg border border-border p-1.5 text-center">
      <p className={cn('text-base font-bold', colorMap[accent] ?? 'text-foreground')}>{value}</p>
      <p className="text-[8px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}
