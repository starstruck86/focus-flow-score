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

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
import { BatchSelectionPanel } from './BatchSelectionPanel';
import { QueueActionBar, type QueueProgress } from './QueueActionBar';
import {
  auditResourceReadiness,
  bulkFixContentBacked,
  bulkAutoTag,
  bulkActivateHighConfidence,
  type AuditSummary,
  type ReadinessBucket,
  type AuditedResource,
} from '@/lib/resourceAudit';
import { autoOperationalizeBatch, summarizeBatchResults, getStageLabel, autoOperationalizeAllResources, countEligibleResources, forceExtractAll, getExtractionCoverage, estimateBatchOutput, type BackfillSummary, type ForceExtractResult, type ExtractionCoverage, type BlockedExample, type BlockedReason, type BatchSummary } from '@/lib/autoOperationalize';
import { LifecycleSummaryBar } from './LifecycleSummaryBar';
import { useCanonicalLifecycle, STAGE_LABELS, STAGE_COLORS } from '@/hooks/useCanonicalLifecycle';
import { deriveCanonicalStage, type LifecycleStage } from '@/lib/canonicalLifecycle';
import { scanExistingKnowledge, executeKIBackfill, type BackfillReport } from '@/lib/kiBackfill';
import {
  auditPipelineIntegrity, auditKnowledgeUtilization, getSystemMetrics,
  runInvariantCheck, buildResourceFunnel, buildKnowledgeFunnel, buildUsageProof, buildRootCauses, buildNothingSlipsSummary,
  type PipelineIntegrityResult, type KnowledgeUtilResult, type SystemMetrics,
  type InvariantCheckResult, type ResourceFunnel, type KnowledgeFunnel, type UsageProof, type RootCauseReport, type NothingSlipsSummary,
} from '@/lib/salesBrainAudit';
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
    label: 'Ready to Use',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: 'text-emerald-600',
    help: 'Active knowledge with contexts — already influencing prep, practice, and Dave.',
  },
  content_backed_needs_fix: {
    label: 'Needs Review',
    icon: <Wrench className="h-3.5 w-3.5" />,
    color: 'text-orange-500',
    help: 'Has valid content but stuck in a stale state. Fix to unlock extraction.',
  },
  blocked_incorrectly: {
    label: 'Blocked',
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: 'text-destructive',
    help: 'Blocked without enough content to auto-fix. Review manually.',
  },
  extractable_not_operationalized: {
    label: 'Needs Extraction',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: 'text-blue-500',
    help: 'Enriched with content but knowledge not yet extracted. High-value next step.',
  },
  low_quality_extraction: {
    label: 'Needs Better Extraction',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: 'text-amber-600',
    help: 'Has knowledge items but none are usable — likely summaries, not actionable tactics.',
  },
  needs_tagging: {
    label: 'Needs Tagging',
    icon: <Tag className="h-3.5 w-3.5" />,
    color: 'text-amber-500',
    help: 'Missing required tags. Auto-tag to make retrievable.',
  },
  ready: {
    label: 'Ready',
    icon: <FileText className="h-3.5 w-3.5" />,
    color: 'text-primary',
    help: 'Content-backed, enriched, and tagged. Ready for extraction.',
  },
  junk_or_low_signal: {
    label: 'Low Value',
    icon: <Trash2 className="h-3.5 w-3.5" />,
    color: 'text-muted-foreground',
    help: 'Very low content, no URL. Safe to delete.',
  },
  missing_content: {
    label: 'Missing Content',
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    color: 'text-muted-foreground',
    help: 'No usable content yet. Needs enrichment or manual input.',
  },
  orphaned_or_inconsistent: {
    label: 'Needs Review',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: 'text-amber-600',
    help: 'Unusual state. Review manually.',
  },
};

// Display order matches priority order
const BUCKET_ORDER: ReadinessBucket[] = [
  'content_backed_needs_fix', 'extractable_not_operationalized', 'low_quality_extraction', 'needs_tagging',
  'operationalized', 'ready', 'blocked_incorrectly',
  'missing_content', 'junk_or_low_signal', 'orphaned_or_inconsistent',
];

// ── Bulk action confirmation text ──────────────────────────

const BULK_ACTION_DESCRIPTIONS: Record<string, { title: string; safe: string; wontDo: string }> = {
  fix: {
    title: 'Fix Content Issues',
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
    title: 'Extract Knowledge from Ready Resources',
    safe: 'Runs the full pipeline (tag → extract → activate) on content-backed resources that have no knowledge yet.',
    wontDo: 'Will not touch junk, missing-content, or already-processed resources. Will not auto-activate low-confidence items.',
  },
  backfillAll: {
    title: 'Extract from All Resources',
    safe: 'Runs the full pipeline on ALL eligible content-backed resources. Idempotent — already-processed resources pass through quickly.',
    wontDo: 'Will not touch junk or missing-content resources. Will not auto-activate low-confidence items. Will not overwrite user-edited knowledge.',
  },
  backfillSmart: {
    title: 'Extract from All Eligible (Smart)',
    safe: 'Only processes resources in fixable/extractable/needs-tagging/ready buckets. Faster and more targeted than full extraction.',
    wontDo: 'Will not touch junk, missing-content, or already-processed resources. Will not auto-activate low-confidence items.',
  },
  forceExtract: {
    title: 'Force Extract All Missing Knowledge',
    safe: 'Runs extraction on all enriched resources with content_length > 300 that have no knowledge items yet. Then runs the full pipeline.',
    wontDo: 'Will not overwrite existing knowledge items. Will not auto-activate low-confidence items.',
  },
  kiScan: {
    title: 'Scan Knowledge Items',
    safe: 'Classifies all existing knowledge items into keep / activate / rewrite / archive without changing anything.',
    wontDo: 'Read-only scan — no items will be modified.',
  },
  kiActivate: {
    title: 'Activate Newly Qualified Items',
    safe: 'Activates inactive knowledge items that meet the new 0.55 confidence threshold and have all required fields.',
    wontDo: 'Will not touch user-edited items. Will not modify items that are already active.',
  },
  kiRewrite: {
    title: 'Reprocess Weak Knowledge Items',
    safe: 'Re-extracts weak/summary-like knowledge items from their source resources using improved tactic-focused extraction.',
    wontDo: 'Will not touch user-edited items. Archives weak items and creates new actionable replacements.',
  },
  kiArchive: {
    title: 'Archive Low-Value Items',
    safe: 'Archives duplicate, vague, and non-actionable knowledge items that cannot be improved.',
    wontDo: 'Will not touch user-edited items. Will not delete — only marks as stale/inactive.',
  },
  kiFull: {
    title: 'Full Knowledge Remediation',
    safe: 'Runs the complete backfill: activates qualified items, rewrites weak ones from source, and archives junk.',
    wontDo: 'Will not touch user-edited items. Will not delete — only archives.',
  },
  delete: {
    title: 'Delete Low-Value Resources',
    safe: 'Permanently removes junk resources with very low content (<50 chars) and no URL.',
    wontDo: 'Cannot be undone.',
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
  const [deepAudit, setDeepAudit] = useState<{
    pipeline?: PipelineIntegrityResult; knowledge?: KnowledgeUtilResult; metrics?: SystemMetrics;
    invariant?: InvariantCheckResult; resFunnel?: ResourceFunnel; kiFunnel?: KnowledgeFunnel;
    usageProof?: UsageProof; rootCauses?: RootCauseReport; summary?: NothingSlipsSummary;
  } | null>(null);
  const [deepAuditLoading, setDeepAuditLoading] = useState(false);
  const [extractionCoverage, setExtractionCoverage] = useState<ExtractionCoverage | null>(null);
  const [forceExtractProgress, setForceExtractProgress] = useState<{ processed: number; total: number } | null>(null);
  const [lastForceExtract, setLastForceExtract] = useState<ForceExtractResult | null>(null);
  const [kiBackfillProgress, setKiBackfillProgress] = useState<{ processed: number; total: number } | null>(null);
  const [kiBackfillReport, setKiBackfillReport] = useState<BackfillReport | null>(null);
  const [kiScanReport, setKiScanReport] = useState<BackfillReport | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [autoOpProgress, setAutoOpProgress] = useState<{ processed: number; total: number; current: string } | null>(null);
  const [lastAutoOpSummary, setLastAutoOpSummary] = useState<BatchSummary | null>(null);

  // Canonical lifecycle — SINGLE SOURCE OF TRUTH
  const { summary: lifecycle, refetch: refetchLifecycle } = useCanonicalLifecycle();

  const runAudit = useCallback(async () => {
    setLoading(true);
    setAuditError(null);
    try {
      const [result, coverage] = await Promise.all([
        auditResourceReadiness(),
        getExtractionCoverage(),
      ]);
      setAudit(result);
      setExtractionCoverage(coverage);
      // Also refresh canonical lifecycle
      refetchLifecycle();
    } catch (err: any) {
      const msg = err?.message ?? 'Unknown error';
      setAuditError(msg);
      toast.error(`Audit failed: ${msg}`);
      console.error('[ResourceReadiness] Audit error:', err);
    } finally {
      setLoading(false);
    }
  }, [refetchLifecycle]);

  // Auto-run audit when sheet opens (if not already loaded)
  const hasAutoRun = useRef(false);
  useEffect(() => {
    if (open && !audit && !loading && !hasAutoRun.current) {
      hasAutoRun.current = true;
      runAudit();
    }
  }, [open, audit, loading, runAudit]);

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
        if (ids.length === 0) {
          toast.error('No eligible resources found based on current filters');
          return;
        }
        setAutoOpProgress({ processed: 0, total: ids.length, current: 'Starting…' });
        setLastAutoOpSummary(null);
        try {
          const results = await autoOperationalizeBatch(ids, (processed, total, currentTitle) => {
            setAutoOpProgress({ processed, total, current: currentTitle });
          });
          const summary = summarizeBatchResults(results);
          setLastAutoOpSummary(summary);

          if (summary.operationalized === 0 && summary.totalKnowledgeExtracted === 0) {
            toast.warning(`0 resources produced knowledge — ${summary.needsReview} need review. Check audit for details.`);
          } else {
            toast.success(
              `Processed ${summary.total} → ${summary.operationalized} extracted, ` +
              `${summary.outcomes.partial_extraction} partial, ` +
              `${summary.outcomes.lightweight_extraction} lightweight, ` +
              `${summary.outcomes.needs_review} review, ` +
              `${summary.totalKnowledgeExtracted} KI created`
            );
          }
          if (summary.needsReview > 0) toast.info(`${summary.needsReview} resources need manual review`);
        } catch (err: any) {
          if (err?.message?.includes('CRITICAL MISMATCH')) {
            toast.error('Pipeline eligibility mismatch — UI and execution disagree on what is eligible. Refreshing audit.');
          } else {
            toast.error(`Extraction failed: ${err?.message ?? 'Unknown error'}`);
          }
        } finally {
          setAutoOpProgress(null);
        }
      } else if (type === 'backfillAll' || type === 'backfillSmart') {
        const mode = type === 'backfillAll' ? 'all' : 'smart';
        setBackfillProgress({ processed: 0, total: 0 });
        const result = await autoOperationalizeAllResources(mode, (processed, total) => {
          setBackfillProgress({ processed, total });
        });
        setBackfillProgress(null);
        setLastBackfillResult(result);
        toast.success(`Extraction complete: ${result.operationalized} fully extracted, ${result.totalKnowledgeExtracted} KI created, ${result.totalKnowledgeActivated} activated`);
        if (result.needsReview > 0) toast.info(`${result.needsReview} resources need manual review`);
        if (result.errors > 0) toast.warning(`${result.errors} errors during processing`);
      } else if (type === 'forceExtract') {
        setForceExtractProgress({ processed: 0, total: 0 });
        const extractResult = await forceExtractAll((processed, total) => {
          setForceExtractProgress({ processed, total });
        });
        setForceExtractProgress(null);
        setLastForceExtract(extractResult);
        toast.success(`Force extract: ${extractResult.newKnowledgeItems} items created, ${extractResult.becameOperationalized} ready to use`);
        if (extractResult.contentEmpty > 0) toast.warning(`${extractResult.contentEmpty} resources had empty content despite content_length`);
      } else if (type === 'kiScan') {
        const report = await scanExistingKnowledge();
        setKiScanReport(report);
        toast.success(`Scanned ${report.total_scanned} items: ${report.kept} keep, ${report.activated} activate, ${report.rewritten} rewrite, ${report.archived} archive`);
      } else if (type === 'kiActivate' || type === 'kiRewrite' || type === 'kiArchive' || type === 'kiFull') {
        const modeMap: Record<string, 'activate' | 'rewrite' | 'archive' | 'full'> = {
          kiActivate: 'activate', kiRewrite: 'rewrite', kiArchive: 'archive', kiFull: 'full',
        };
        setKiBackfillProgress({ processed: 0, total: 0 });
        const report = await executeKIBackfill(modeMap[type], (processed, total) => {
          setKiBackfillProgress({ processed, total });
        });
        setKiBackfillProgress(null);
        setKiBackfillReport(report);
        toast.success(`KI remediation: ${report.activated} activated, ${report.rewritten} rewritten (${report.new_items_created} new), ${report.archived} archived`);
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
            {!audit && !loading && !auditError && (
              <div className="p-8 text-center space-y-3">
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading audit…</p>
              </div>
            )}

            {auditError && !audit && (
              <div className="p-6 text-center space-y-3">
                <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
                <p className="text-sm text-destructive">Audit failed: {auditError}</p>
                <Button size="sm" onClick={runAudit}>Retry</Button>
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
                {/* ── Canonical Lifecycle Summary — SINGLE SOURCE OF TRUTH ── */}
                <LifecycleSummaryBar summary={lifecycle} />

                {/* ── NEXT BEST ACTION ── */}
                <NextBestActionPanel audit={audit} actionLoading={actionLoading} onAction={(type, ids) => setConfirmAction({ type, ids })} />

                {/* ── Bucket summary stats ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <MiniStat label="Ready to Use" value={audit.counts.operationalized} accent="emerald" />
                  <MiniStat label="Needs Extraction" value={audit.counts.extractable_not_operationalized} accent="blue" />
                  <MiniStat label="Needs Review" value={audit.counts.content_backed_needs_fix} accent="orange" />
                  <MiniStat label="Underutilized" value={underutilizedCount} accent="amber" />
                </div>

                {/* ── State legend ── */}
                <div className="rounded-md border border-border bg-muted/20 p-2 text-[9px] text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span><span className="font-medium text-foreground">Enriched</span> — content/metadata processed</span>
                  <span><span className="font-medium text-foreground">Eligible</span> — ready for extraction pipeline</span>
                  <span><span className="font-medium text-foreground">Extracted</span> — knowledge items created</span>
                  <span><span className="font-medium text-foreground">Activated</span> — KI usable in system</span>
                  <span><span className="font-medium text-foreground">Needs Review</span> — uncertain extraction result</span>
                  <span><span className="font-medium text-foreground">No Content</span> — no usable content path</span>
                </div>

                {/* ── Batch Selection Panel ── */}
                <Collapsible>
                  <CollapsibleTrigger className="w-full flex items-center justify-between p-2 rounded-md border border-primary/20 bg-primary/5 hover:bg-primary/10 text-[11px] font-semibold text-foreground">
                    <span className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      Batch Processing
                    </span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2">
                      <BatchSelectionPanel
                        resources={[
                          ...audit.buckets.extractable_not_operationalized,
                          ...audit.buckets.needs_tagging,
                          ...audit.buckets.ready,
                          ...audit.buckets.content_backed_needs_fix,
                          ...audit.buckets.low_quality_extraction,
                        ].map(r => ({
                          id: r.id,
                          title: r.title,
                          sourceType: undefined,
                          enrichmentStatus: r.enrichmentStatus,
                          contentLength: r.contentLength,
                          hasKnowledge: r.knowledgeItemCount > 0,
                        }))}
                        onComplete={runAudit}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

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
                  </div>
                )}

                <Separator />

                {/* ── Primary + Secondary actions ── */}
                <div className="space-y-1.5">
                  {/* Test mode */}
                  {(audit.counts.ready + audit.counts.extractable_not_operationalized + audit.counts.needs_tagging) > 5 && (
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 text-muted-foreground" disabled={!!actionLoading}
                      onClick={() => {
                        const ids = [
                          ...audit.buckets.extractable_not_operationalized,
                          ...audit.buckets.needs_tagging,
                          ...audit.buckets.ready,
                        ].map(r => r.id).slice(0, 5);
                        setConfirmAction({ type: 'autoOp', ids });
                      }}>
                      <Rocket className="h-3 w-3" />
                      Test Extraction (5)
                    </Button>
                  )}

                  {/* More Actions — collapsible */}
                  <Collapsible>
                    <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                      <span className="font-medium text-muted-foreground">More Actions</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-wrap gap-1.5 pt-1.5">
                        {audit.counts.content_backed_needs_fix > 0 && (
                          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                            onClick={() => setConfirmAction({ type: 'fix', ids: audit.buckets.content_backed_needs_fix.map(r => r.id) })}>
                            {actionLoading === 'fix' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                            Fix {audit.counts.content_backed_needs_fix} Content Issues
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
                          Activate Knowledge
                        </Button>
                        {audit.counts.junk_or_low_signal > 0 && (
                          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive" disabled={!!actionLoading}
                            onClick={() => setConfirmAction({ type: 'delete', ids: audit.buckets.junk_or_low_signal.map(r => r.id) })}>
                            <Trash2 className="h-3 w-3" />
                            Delete {audit.counts.junk_or_low_signal} Junk
                          </Button>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                {/* ── Auto-Op Progress + Results ── */}
                {autoOpProgress && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-2 space-y-1.5">
                    <div className="flex items-center gap-2 text-[10px]">
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      <span className="font-medium text-foreground">
                        Processing {autoOpProgress.processed} / {autoOpProgress.total}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all"
                        style={{ width: `${autoOpProgress.total > 0 ? (autoOpProgress.processed / autoOpProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="text-[9px] text-muted-foreground truncate">{autoOpProgress.current}</p>
                  </div>
                )}

                {lastAutoOpSummary && !autoOpProgress && (
                  <OperatorSummaryPanel summary={lastAutoOpSummary} />
                )}

                {/* ── Backfill actions ── */}
                <Collapsible>
                  <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                    <span className="font-medium text-muted-foreground">Full Library Extraction</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-emerald-500/30" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'backfillSmart' })}>
                        {actionLoading === 'backfillSmart' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3 text-emerald-600" />}
                        Extract All Eligible
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'backfillAll' })}>
                        {actionLoading === 'backfillAll' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                        Extract All Resources
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
                  </CollapsibleContent>
                </Collapsible>

                  {/* ── Knowledge Item Remediation ── */}
                  <div className="pt-1.5 border-t border-border/50 space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground">Knowledge Item Remediation</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'kiScan' })}>
                        {actionLoading === 'kiScan' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                        Scan Knowledge Items
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'kiActivate' })}>
                        {actionLoading === 'kiActivate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        Activate Qualified
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'kiRewrite' })}>
                        {actionLoading === 'kiRewrite' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Reprocess Weak Items
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'kiArchive' })}>
                        {actionLoading === 'kiArchive' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Archive Low-Value
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-primary/30" disabled={!!actionLoading}
                        onClick={() => setConfirmAction({ type: 'kiFull' })}>
                        {actionLoading === 'kiFull' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3 text-primary" />}
                        Full Remediation
                      </Button>
                    </div>
                    {kiBackfillProgress && (
                      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Remediating {kiBackfillProgress.processed} / {kiBackfillProgress.total} items…
                      </div>
                    )}
                    {/* Scan results */}
                    {kiScanReport && !kiBackfillReport && (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[10px] space-y-0.5">
                        <p className="font-medium text-foreground">Scan Results (dry run)</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Total scanned:</span><span className="font-medium text-foreground">{kiScanReport.total_scanned}</span>
                          <span>Keep as-is:</span><span className="font-medium text-emerald-600">{kiScanReport.kept}</span>
                          <span>Ready to activate:</span><span className="font-medium text-blue-600">{kiScanReport.activated}</span>
                          <span>Need rewrite:</span><span className="font-medium text-amber-600">{kiScanReport.rewritten}</span>
                          <span>Archive/delete:</span><span className="font-medium text-destructive">{kiScanReport.archived}</span>
                          <span>Protected (user-edited):</span><span className="font-medium text-foreground">{kiScanReport.protected_skipped}</span>
                        </div>
                      </div>
                    )}
                    {/* Backfill results */}
                    {kiBackfillReport && !kiBackfillProgress && (
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] space-y-0.5">
                        <p className="font-medium text-foreground">Remediation Results</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Total scanned:</span><span className="font-medium text-foreground">{kiBackfillReport.total_scanned}</span>
                          <span>Kept:</span><span className="font-medium text-emerald-600">{kiBackfillReport.kept}</span>
                          <span>Activated:</span><span className="font-medium text-blue-600">{kiBackfillReport.activated}</span>
                          <span>Rewritten:</span><span className="font-medium text-amber-600">{kiBackfillReport.rewritten}</span>
                          <span>New items created:</span><span className="font-medium text-primary">{kiBackfillReport.new_items_created}</span>
                          <span>Archived:</span><span className="font-medium text-destructive">{kiBackfillReport.archived}</span>
                          <span>Protected:</span><span className="font-medium text-foreground">{kiBackfillReport.protected_skipped}</span>
                          {kiBackfillReport.errors > 0 && (<><span>Errors:</span><span className="font-medium text-destructive">{kiBackfillReport.errors}</span></>)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Pipeline Validation Summary ── */}
                  <div className="pt-1.5 border-t border-border/50 space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground">Pipeline Validation Summary</p>
                    {extractionCoverage ? (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[10px] space-y-1">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Enriched resources:</span><span className="font-medium text-foreground">{extractionCoverage.enrichedResources}</span>
                          <span>With knowledge items:</span><span className="font-medium text-foreground">{extractionCoverage.withKnowledgeItems} ({extractionCoverage.kiCoveragePct}%)</span>
                          <span>Ready to use:</span><span className="font-medium text-emerald-600">{extractionCoverage.operationalizedResources} ({extractionCoverage.opCoveragePct}%)</span>
                          <span>No knowledge yet:</span><span className={cn('font-medium', extractionCoverage.noKnowledgeYet > 0 ? 'text-amber-500' : 'text-foreground')}>{extractionCoverage.noKnowledgeYet}</span>
                        </div>

                        {/* Blocked-by breakdown */}
                        {(extractionCoverage.blockedByEmptyContent > 0 || extractionCoverage.blockedByNoExtraction > 0 || extractionCoverage.blockedByActivationCriteria > 0 || extractionCoverage.blockedByMissingContexts > 0 || extractionCoverage.blockedByStaleBlockerState > 0) && (
                          <div className="pt-1 border-t border-border/30">
                            <p className="font-medium text-foreground mb-0.5">Blocked Resources</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                              {extractionCoverage.blockedByEmptyContent > 0 && (
                                <><span>Missing content:</span><span className="font-medium text-destructive">{extractionCoverage.blockedByEmptyContent}</span></>
                              )}
                              {extractionCoverage.blockedByNoExtraction > 0 && (
                                <><span>Needs extraction:</span><span className="font-medium text-amber-500">{extractionCoverage.blockedByNoExtraction}</span></>
                              )}
                              {extractionCoverage.blockedByActivationCriteria > 0 && (
                                <><span>Needs activation:</span><span className="font-medium text-orange-500">{extractionCoverage.blockedByActivationCriteria}</span></>
                              )}
                              {extractionCoverage.blockedByMissingContexts > 0 && (
                                <><span>Needs context repair:</span><span className="font-medium text-orange-500">{extractionCoverage.blockedByMissingContexts}</span></>
                              )}
                              {extractionCoverage.blockedByStaleBlockerState > 0 && (
                                <><span>Needs review:</span><span className="font-medium text-destructive">{extractionCoverage.blockedByStaleBlockerState}</span></>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Examples per failure class */}
                        {Object.entries(extractionCoverage.examples).map(([reason, items]) => {
                          const exampleItems = items as BlockedExample[];
                          if (exampleItems.length === 0 || reason === 'operationalized') return null;
                          return (
                            <Collapsible key={reason}>
                              <CollapsibleTrigger className="w-full flex items-center justify-between p-1 rounded hover:bg-accent/50 text-[10px]">
                                <span className="font-medium text-foreground capitalize">
                                  {(reason as string).replace(/_/g, ' ')} — {exampleItems.length} example{exampleItems.length > 1 ? 's' : ''}
                                </span>
                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="space-y-1 pl-1 pt-0.5">
                                  {exampleItems.map(ex => (
                                    <div key={ex.id} className="p-1.5 rounded border border-border/50 bg-card text-[9px] space-y-0.5">
                                      <p className="font-medium text-foreground truncate">{ex.title}</p>
                                      <div className="flex flex-wrap gap-x-3 gap-y-0 text-muted-foreground">
                                        <span>content_length: {ex.contentLengthField}</span>
                                        <span>actual: {ex.actualContentLength}</span>
                                        <span>KI: {ex.kiCount}</span>
                                        <span>active: {ex.activeKiCount}</span>
                                      </div>
                                      <p className="text-muted-foreground italic">{ex.detail}</p>
                                    </div>
                                  ))}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })}

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
                          <span>Became ready to use:</span><span className="font-medium text-emerald-600">{lastForceExtract.becameOperationalized}</span>
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
                            const [pipeline, knowledge, metrics, invariant, resFunnel, kiFunnel, usageProof] = await Promise.all([
                              auditPipelineIntegrity(), auditKnowledgeUtilization(), getSystemMetrics(),
                              runInvariantCheck(), buildResourceFunnel(), buildKnowledgeFunnel(), buildUsageProof(),
                            ]);
                            const rootCauses = buildRootCauses(invariant, knowledge);
                            const nstSummary = buildNothingSlipsSummary(metrics, invariant, resFunnel, kiFunnel);
                            setDeepAudit({ pipeline, knowledge, metrics, invariant, resFunnel, kiFunnel, usageProof, rootCauses, summary: nstSummary });
                          } catch { toast.error('Audit failed'); }
                          setDeepAuditLoading(false);
                        }}>
                        {deepAuditLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                        Run Deep Audit
                      </Button>
                    </div>

                    {/* ── Nothing Slips Through Summary ── */}
                    {deepAudit?.summary && (
                      <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-2.5 text-[10px] space-y-1.5">
                        <p className="text-xs font-semibold text-foreground">Nothing Slips Through</p>
                        <div className="space-y-0.5 text-muted-foreground">
                          {deepAudit.summary.lines.map((line, i) => (<p key={i}>• {line}</p>))}
                        </div>
                        <p className="font-medium text-foreground pt-0.5">Biggest leak: <span className="text-destructive">{deepAudit.summary.biggestLeak}</span></p>
                        <div className="pt-1 border-t border-border/30">
                          <p className="font-semibold text-foreground mb-0.5">What should I do next?</p>
                          {deepAudit.summary.nextSteps.map((step, i) => (
                            <p key={i} className="text-muted-foreground"><span className="font-bold text-primary">{i + 1}.</span> {step}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Invariant Check ── */}
                    {deepAudit?.invariant && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                          <span className="font-medium text-foreground flex items-center gap-1">
                            {deepAudit.invariant.healthy ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-destructive" />}
                            Invariant Check ({deepAudit.invariant.violations.length} violations)
                          </span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-2 pt-1 text-[10px] space-y-1">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                              <span>Content-backed enriched:</span><span className="font-medium text-foreground">{deepAudit.invariant.totalContentBackedEnriched}</span>
                              <span>Ready to use:</span><span className="font-medium text-emerald-600">{deepAudit.invariant.byClass.operationalized}</span>
                              <span>Empty content:</span><span className={cn('font-medium', deepAudit.invariant.byClass.blocked_by_empty_content > 0 ? 'text-destructive' : 'text-foreground')}>{deepAudit.invariant.byClass.blocked_by_empty_content}</span>
                              <span>No extraction:</span><span className={cn('font-medium', deepAudit.invariant.byClass.blocked_by_no_extraction > 0 ? 'text-amber-500' : 'text-foreground')}>{deepAudit.invariant.byClass.blocked_by_no_extraction}</span>
                              <span>Activation criteria:</span><span className={cn('font-medium', deepAudit.invariant.byClass.blocked_by_activation_criteria > 0 ? 'text-orange-500' : 'text-foreground')}>{deepAudit.invariant.byClass.blocked_by_activation_criteria}</span>
                              <span>Missing contexts:</span><span className={cn('font-medium', deepAudit.invariant.byClass.blocked_by_missing_contexts > 0 ? 'text-orange-500' : 'text-foreground')}>{deepAudit.invariant.byClass.blocked_by_missing_contexts}</span>
                              <span>Violations:</span><span className={cn('font-medium', deepAudit.invariant.violations.length > 0 ? 'text-destructive' : 'text-emerald-600')}>{deepAudit.invariant.violations.length}</span>
                            </div>
                            {deepAudit.invariant.violations.slice(0, 10).map(v => (
                              <div key={v.id} className="p-1 border border-destructive/20 rounded bg-card space-y-0.5">
                                <p className="font-medium text-foreground truncate">{v.title}</p>
                                <div className="flex flex-wrap gap-x-3 text-muted-foreground">
                                  <span>KI:{v.kiCount} active:{v.activeKiCount} w/ctx:{v.activeWithContextsCount}</span>
                                </div>
                                <p className="text-destructive italic">{v.reason}</p>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* ── Resource Funnel ── */}
                    {deepAudit?.resFunnel && deepAudit.resFunnel.stages.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                          <span className="font-medium text-foreground flex items-center gap-1"><Rocket className="h-3 w-3 text-primary" /> Resource Funnel</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-2 pt-1 text-[10px] space-y-0.5">
                            {deepAudit.resFunnel.stages.map((s, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <span className="w-[160px] truncate font-medium text-foreground">{s.label}</span>
                                <span className="font-bold text-foreground w-8 text-right">{s.count}</span>
                                <span className="text-muted-foreground w-10 text-right">({s.pct}%)</span>
                                {i > 0 && s.dropoffPct > 0 && <span className="text-destructive text-[9px]">↓{s.dropoffPct}%</span>}
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* ── KI Funnel ── */}
                    {deepAudit?.kiFunnel && deepAudit.kiFunnel.stages.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                          <span className="font-medium text-foreground flex items-center gap-1"><Brain className="h-3 w-3 text-blue-500" /> Knowledge Item Funnel</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-2 pt-1 text-[10px] space-y-0.5">
                            {deepAudit.kiFunnel.stages.map((s, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <span className="w-[160px] truncate font-medium text-foreground">{s.label}</span>
                                <span className="font-bold text-foreground w-8 text-right">{s.count}</span>
                                <span className="text-muted-foreground w-10 text-right">({s.pct}%)</span>
                                {i > 0 && i < 7 && s.dropoffPct > 0 && <span className="text-destructive text-[9px]">↓{s.dropoffPct}%</span>}
                              </div>
                            ))}
                            <div className="pt-1 border-t border-border/30 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                              <span>Avg confidence:</span><span className="font-medium text-foreground">{deepAudit.kiFunnel.avgConfidence}</span>
                              <span>Auto-activated:</span><span className="font-medium text-foreground">{deepAudit.kiFunnel.autoActivatedCount}</span>
                              <span>Never used:</span><span className={cn('font-medium', deepAudit.kiFunnel.neverUsed > 0 ? 'text-destructive' : 'text-emerald-600')}>{deepAudit.kiFunnel.neverUsed}</span>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* ── Usage Proof ── */}
                    {deepAudit?.usageProof && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                          <span className="font-medium text-foreground flex items-center gap-1"><Zap className="h-3 w-3 text-emerald-600" /> Usage Proof</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-2 pt-1 text-[10px] space-y-2">
                            {deepAudit.usageProof.topResources.length > 0 && (<div>
                              <p className="font-semibold text-foreground mb-0.5">Top Used Resources</p>
                              {deepAudit.usageProof.topResources.slice(0, 5).map(r => (
                                <div key={r.id} className="flex items-center gap-2 py-0.5 text-muted-foreground">
                                  <span className="flex-1 truncate font-medium text-foreground">{r.title}</span>
                                  <span>P:{r.prepCount}</span><span>R:{r.roleplayCount}</span><span>D:{r.daveCount}</span>
                                </div>
                              ))}
                            </div>)}
                            {deepAudit.usageProof.neverUsedKI.length > 0 && (<div>
                              <p className="font-semibold text-destructive mb-0.5">Never-Used Active KI</p>
                              {deepAudit.usageProof.neverUsedKI.slice(0, 5).map(ki => (
                                <div key={ki.id} className="p-1 border border-border/50 rounded bg-card space-y-0.5">
                                  <p className="font-medium text-foreground truncate">{ki.title}</p>
                                  <p className="text-amber-500 italic">{ki.issue}</p>
                                </div>
                              ))}
                            </div>)}
                            {deepAudit.usageProof.topResources.length === 0 && <p className="text-muted-foreground italic">No usage telemetry yet.</p>}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* ── Root Causes ── */}
                    {deepAudit?.rootCauses && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
                          <span className="font-medium text-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /> Root Causes</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-2 pt-1 text-[10px] space-y-1.5">
                            {deepAudit.rootCauses.resourceCauses.map(g => (
                              <p key={g.label} className="text-muted-foreground">• {g.label}: <span className="font-medium text-foreground">{g.count}</span></p>
                            ))}
                            {deepAudit.rootCauses.knowledgeCauses.map(g => (
                              <p key={g.label} className="text-muted-foreground">• {g.label}: <span className="font-medium text-foreground">{g.count}</span></p>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {deepAudit?.metrics && (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[10px] space-y-1">
                        <p className="font-medium text-foreground">System Metrics</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span>Total resources:</span><span className="font-medium text-foreground">{deepAudit.metrics.resources.total}</span>
                          <span>Content-backed:</span><span className="font-medium text-foreground">{deepAudit.metrics.resources.content_backed}</span>
                          <span>With knowledge:</span><span className="font-medium text-foreground">{deepAudit.metrics.resources.with_knowledge}</span>
                          <span>Ready to use:</span><span className="font-medium text-emerald-600">{deepAudit.metrics.resources.operationalized}</span>
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

                {/* ── Acceptance Checklist ── */}
                {(lastAutoOpSummary || lastBackfillResult) && (
                  <div className="rounded-md border border-border bg-muted/20 p-2 text-[10px] space-y-1">
                    <p className="font-medium text-foreground text-[11px]">Workflow Checklist</p>
                    <div className="space-y-0.5">
                      {[
                        { label: 'Test batch completed', done: !!lastAutoOpSummary && (lastAutoOpSummary.total <= 5) },
                        { label: 'Full extraction completed', done: !!lastAutoOpSummary && (lastAutoOpSummary.total > 5) || !!lastBackfillResult },
                        { label: 'Failures reviewed', done: !!lastAutoOpSummary && lastAutoOpSummary.failedResources.length === 0 },
                        { label: 'Knowledge activated', done: !!lastAutoOpSummary && lastAutoOpSummary.totalKnowledgeActivated > 0 || !!lastBackfillResult && lastBackfillResult.totalKnowledgeActivated > 0 },
                      ].map(item => (
                        <div key={item.label} className="flex items-center gap-1.5">
                          {item.done
                            ? <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                            : <div className="h-3 w-3 rounded-full border border-muted-foreground/40 shrink-0" />
                          }
                          <span className={cn(item.done ? 'text-foreground' : 'text-muted-foreground')}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                ? `Delete ${confirmAction.ids?.length ?? 0} low-value resources?`
                : BULK_ACTION_DESCRIPTIONS[confirmAction?.type ?? '']?.title ?? 'Confirm Action'
              }
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirmAction?.type === 'delete' ? (
                  <p>These resources have very low content (&lt;50 chars) and no URL. This cannot be undone.</p>
                ) : confirmAction?.type === 'autoOp' && confirmAction.ids ? (
                  (() => {
                    const est = estimateBatchOutput(confirmAction.ids.length);
                    return (
                      <>
                        <p><strong>Processing:</strong> {confirmAction.ids.length} resources</p>
                        <p><strong>Estimated output:</strong> {est.estimatedKnowledgeItems.min}–{est.estimatedKnowledgeItems.max} knowledge items</p>
                        <p><strong>Estimated time:</strong> ~{est.estimatedTimeMinutes.min}–{est.estimatedTimeMinutes.max} minutes</p>
                        <p className="text-muted-foreground"><strong>Will NOT:</strong> {BULK_ACTION_DESCRIPTIONS[confirmAction.type]?.wontDo}</p>
                      </>
                    );
                  })()
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

// ── Next Best Action Panel ─────────────────────────────────

function NextBestActionPanel({ audit, actionLoading, onAction }: {
  audit: AuditSummary;
  actionLoading: string | null;
  onAction: (type: string, ids?: string[]) => void;
}) {
  const c = audit.counts;
  const extractableCount = c.extractable_not_operationalized + c.needs_tagging + c.ready;
  const fixableCount = c.content_backed_needs_fix;
  const lowQualityCount = c.low_quality_extraction;

  let ctaLabel: string;
  let ctaDescription: string;
  let ctaIcon: React.ReactNode;
  let ctaAction: () => void;
  let ctaDisabled = !!actionLoading;
  let systemClean = false;

  if (extractableCount > 0) {
    ctaLabel = `Extract Knowledge (${extractableCount})`;
    ctaDescription = `${extractableCount} resources are enriched and ready for knowledge extraction.`;
    ctaIcon = <Sparkles className="h-4 w-4" />;
    ctaAction = () => {
      const ids = [
        ...audit.buckets.extractable_not_operationalized,
        ...audit.buckets.needs_tagging,
        ...audit.buckets.ready,
      ].map(r => r.id);
      onAction('autoOp', ids);
    };
  } else if (lowQualityCount > 0) {
    ctaLabel = `Improve ${lowQualityCount} Weak Extractions`;
    ctaDescription = `${lowQualityCount} resources have knowledge items but none are usable.`;
    ctaIcon = <Sparkles className="h-4 w-4" />;
    ctaAction = () => onAction('kiRewrite');
  } else if (fixableCount > 0) {
    ctaLabel = `Fix ${fixableCount} Content Issues`;
    ctaDescription = `${fixableCount} resources have content but are stuck in a stale state.`;
    ctaIcon = <Wrench className="h-4 w-4" />;
    ctaAction = () => onAction('fix', audit.buckets.content_backed_needs_fix.map(r => r.id));
  } else {
    systemClean = true;
    ctaLabel = 'System Clean';
    ctaDescription = 'No pending extraction, activation, or content issues found.';
    ctaIcon = <CheckCircle2 className="h-4 w-4" />;
    ctaAction = () => {};
    ctaDisabled = true;
  }

  return (
    <div className={cn(
      "rounded-lg border-2 p-3 space-y-2",
      systemClean ? "border-emerald-500/30 bg-emerald-500/5" : "border-primary/30 bg-primary/5"
    )}>
      <div className="flex items-center gap-2">
        <span className={systemClean ? "text-emerald-600" : "text-primary"}>{ctaIcon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">{systemClean ? '✓ System Clean' : 'Next Best Action'}</p>
          <p className="text-[10px] text-muted-foreground">{ctaDescription}</p>
        </div>
      </div>
      {!systemClean && (
        <Button size="sm" className="w-full h-8 text-xs gap-1.5" disabled={ctaDisabled} onClick={ctaAction}>
          {actionLoading === 'autoOp' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : ctaIcon}
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}

// ── Operator Summary Panel ─────────────────────────────────

function OperatorSummaryPanel({ summary }: { summary: BatchSummary }) {
  const totalProcessed = summary.total;
  const produced = summary.outcomes.operationalized + summary.outcomes.partial_extraction + summary.outcomes.lightweight_extraction;
  const needsAttention = summary.outcomes.needs_review + summary.outcomes.no_content + summary.outcomes.failed;
  const [expandedFailure, setExpandedFailure] = useState<string | null>(null);

  let nextAction = '';
  if (summary.outcomes.operationalized > 0 && summary.totalKnowledgeActivated === 0) {
    nextAction = `Activate ${summary.totalKnowledgeExtracted} new knowledge items.`;
  } else if (summary.outcomes.needs_review > 0) {
    nextAction = `Review ${summary.outcomes.needs_review} resources that need attention.`;
  } else if (produced > 0) {
    nextAction = 'Knowledge is ready to use — no further action needed.';
  } else {
    nextAction = 'Check resource content quality and re-enrich if needed.';
  }

  const getFailureAction = (outcome: string): string => {
    switch (outcome) {
      case 'no_content': return 'Add transcript or manual notes';
      case 'needs_review': return 'Review extraction output';
      case 'failed': return 'Retry extraction';
      default: return '';
    }
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-card p-3 text-[10px] space-y-2">
      <p className="text-xs font-semibold text-foreground">Extraction Results</p>

      <div className="rounded-md bg-muted/30 p-2 space-y-1">
        <p className="font-medium text-foreground">What happened</p>
        <p className="text-muted-foreground">
          {totalProcessed} resource{totalProcessed !== 1 ? 's' : ''} processed → {produced} produced usable knowledge, {summary.totalKnowledgeExtracted} KI extracted, {summary.totalKnowledgeActivated} KI activated.
        </p>
        <div className="grid grid-cols-3 gap-1 pt-1">
          <div className="text-center p-1 rounded bg-emerald-500/10">
            <p className="text-sm font-bold text-emerald-600">{summary.outcomes.operationalized}</p>
            <p className="text-[8px] text-muted-foreground">Extracted</p>
          </div>
          <div className="text-center p-1 rounded bg-blue-500/10">
            <p className="text-sm font-bold text-blue-500">{summary.outcomes.partial_extraction + summary.outcomes.lightweight_extraction}</p>
            <p className="text-[8px] text-muted-foreground">Partial</p>
          </div>
          <div className="text-center p-1 rounded bg-amber-500/10">
            <p className="text-sm font-bold text-amber-500">{needsAttention}</p>
            <p className="text-[8px] text-muted-foreground">Needs Attention</p>
          </div>
        </div>
      </div>

      {needsAttention > 0 && (
        <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-2 space-y-1">
          <p className="font-medium text-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-500" /> What needs attention
          </p>
          {summary.outcomes.needs_review > 0 && <p className="text-muted-foreground">• {summary.outcomes.needs_review} need manual review</p>}
          {summary.outcomes.no_content > 0 && <p className="text-muted-foreground">• {summary.outcomes.no_content} had no usable content</p>}
          {summary.outcomes.failed > 0 && <p className="text-muted-foreground">• {summary.outcomes.failed} failed during extraction</p>}
        </div>
      )}

      <div className="rounded-md bg-primary/5 border border-primary/20 p-2">
        <p className="font-medium text-foreground flex items-center gap-1">
          <ArrowRight className="h-3 w-3 text-primary" /> Recommended next action
        </p>
        <p className="text-muted-foreground">{nextAction}</p>
      </div>

      {summary.failedResources.length > 0 && (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{summary.failedResources.length} issue{summary.failedResources.length !== 1 ? 's' : ''}</p>
          {summary.failedResources.slice(0, 20).map(f => {
            const isExp = expandedFailure === f.id;
            return (
              <div key={f.id} className="border border-border/50 rounded bg-card">
                <button
                  onClick={() => setExpandedFailure(isExp ? null : f.id)}
                  className="w-full flex items-center justify-between p-1.5 text-left hover:bg-accent/30 text-[10px]"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <Badge variant="outline" className={cn("text-[7px] h-3.5 px-1 shrink-0",
                      f.outcome === 'no_content' ? 'text-muted-foreground' :
                      f.outcome === 'needs_review' ? 'text-amber-500' : 'text-destructive'
                    )}>
                      {f.outcome.replace(/_/g, ' ')}
                    </Badge>
                    <span className="truncate text-foreground">{f.title || '(untitled)'}</span>
                  </div>
                  {isExp ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
                </button>
                {isExp && (
                  <div className="px-1.5 pb-1.5 space-y-0.5 text-[9px]">
                    <p className="text-muted-foreground"><span className="font-medium">Reason:</span> {f.reason || 'Unknown'}</p>
                    <p className="text-primary/80 flex items-center gap-0.5">
                      <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                      {getFailureAction(f.outcome)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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
    steps.push(`${c.operationalized} resources already producing usable knowledge`);
  if (c.blocked_incorrectly > 0)
    steps.push(`Manually review ${c.blocked_incorrectly} incorrectly blocked resources`);

  return steps;
}

// ── Bottleneck label ───────────────────────────────────────

function getBottleneckLabel(r: AuditedResource): { text: string; color: string } {
  if (r.bucket === 'operationalized') return { text: 'Ready to use', color: 'text-emerald-600' };
  if (r.activeKnowledgeCount > 0 && !r.hasContexts) return { text: 'Needs context repair', color: 'text-orange-500' };
  if (r.knowledgeItemCount > 0 && r.activeKnowledgeCount === 0) return { text: 'Needs activation', color: 'text-blue-500' };
  if (r.bucket === 'content_backed_needs_fix') return { text: 'Needs review', color: 'text-orange-500' };
  if (r.bucket === 'extractable_not_operationalized' && r.knowledgeItemCount === 0) return { text: 'Needs extraction', color: 'text-blue-500' };
  if (r.bucket === 'needs_tagging') return { text: 'Needs tagging', color: 'text-amber-500' };
  if (r.bucket === 'junk_or_low_signal') return { text: 'Low value', color: 'text-muted-foreground' };
  if (r.bucket === 'ready') return { text: 'Ready', color: 'text-primary' };
  return { text: r.bucket.replace(/_/g, ' '), color: 'text-muted-foreground' };
}

// ── Resource row ───────────────────────────────────────────

function ResourceRow({ resource: r }: { resource: AuditedResource }) {
  const tagGroups = groupTagsByDimension(r.tags);
  const bottleneck = getBottleneckLabel(r);
  const canonicalStage = deriveCanonicalStage(
    { content_length: r.contentLength, tags: r.tags, enrichment_status: r.enrichmentStatus },
    { total: r.knowledgeItemCount, active: r.activeKnowledgeCount, activeWithContexts: r.activeWithContexts },
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
      {/* Title + bottleneck label + canonical stage badge */}
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground truncate">{r.title}</p>
          <p className={cn('text-[9px] font-medium', bottleneck.color)}>{bottleneck.text}</p>
        </div>
        <div className="flex gap-0.5 shrink-0 flex-wrap justify-end max-w-[45%]">
          <Badge variant="outline" className={cn("text-[7px] h-3.5 px-1 border-primary/20", STAGE_COLORS[canonicalStage])}>{STAGE_LABELS[canonicalStage]}</Badge>
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
