/**
 * Resource Upside Queue — execution-improvement backlog.
 *
 * Features:
 *  - Top 25 highest-impact resources
 *  - Guided extraction mode (1 at a time)
 *  - Auto-activation engine
 *  - Bulk promote templates / examples
 *  - Quality flagging on extraction
 *  - Actionization layer integration
 */

import { useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Crown, Star, Brain, FileText, ChevronDown, ChevronRight,
  AlertTriangle, ArrowUpRight, CheckCircle2, Sparkles, TrendingUp,
  Archive, Zap, Play, SkipForward, Edit3, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  classifyResources,
  summarizeBuckets,
  computeUpsideScore,
  type ActionBucket,
  type ClassificationResult,
  type BucketSummary,
  type UpsideScore,
} from '@/lib/resourceClassifier';
import { extractKnowledgeHeuristic, type ExtractionSource } from '@/lib/knowledgeExtraction';
import { useKnowledgeItems as useAllKnowledgeItems } from '@/hooks/useKnowledgeItems';
import { useResources, type Resource } from '@/hooks/useResources';
import { useInsertKnowledgeItems, type KnowledgeItemInsert } from '@/hooks/useKnowledgeItems';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

// ── Bucket config ──────────────────────────────────────────

const BUCKET_CONFIG: Record<ActionBucket, {
  label: string;
  icon: typeof Crown;
  color: string;
  badgeClass: string;
  description: string;
  defaultOpen: boolean;
}> = {
  promote_template: {
    label: 'Ready to Promote — Template',
    icon: Crown,
    color: 'text-amber-500',
    badgeClass: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    description: 'Reusable structures — promote to make them selectable in generation',
    defaultOpen: true,
  },
  promote_example: {
    label: 'Ready to Promote — Example',
    icon: Star,
    color: 'text-primary',
    badgeClass: 'bg-primary/15 text-primary border-primary/30',
    description: 'Strong outputs — promote to surface in evidence & ranking',
    defaultOpen: true,
  },
  extract_knowledge: {
    label: 'Ready for Knowledge Extraction',
    icon: Brain,
    color: 'text-emerald-500',
    badgeClass: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    description: 'Tactics & principles — extract to power "What Actually Works"',
    defaultOpen: true,
  },
  manual_review: {
    label: 'Needs Manual Review',
    icon: AlertTriangle,
    color: 'text-status-yellow',
    badgeClass: 'bg-status-yellow/15 text-status-yellow border-status-yellow/30',
    description: 'Decide: Template, Example, Knowledge, Reference, or Archive',
    defaultOpen: false,
  },
  reference_only: {
    label: 'Reference Only',
    icon: FileText,
    color: 'text-muted-foreground',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    description: 'Supporting material — low direct leverage',
    defaultOpen: false,
  },
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: 'bg-status-green/15 text-status-green',
  medium: 'bg-status-yellow/15 text-status-yellow',
  low: 'bg-muted text-muted-foreground',
};

const BUCKET_ORDER: ActionBucket[] = [
  'promote_template', 'promote_example', 'extract_knowledge', 'manual_review', 'reference_only',
];

const CLASSIFIABLE_STATUSES = new Set(['enriched', 'deep_enriched', 'verified']);

// ── Types ──────────────────────────────────────────────────

interface CandidateItem {
  resource: Resource;
  classification: ClassificationResult;
  upside: UpsideScore;
}

// ── Component ──────────────────────────────────────────────

export function ResourceUpsideQueue() {
  const { data: resources = [] } = useResources();
  const { user } = useAuth();
  const qc = useQueryClient();
  const insertKnowledge = useInsertKnowledgeItems();
  const { data: allKnowledgeItems = [] } = useAllKnowledgeItems();
  const existingForDedup = useMemo(() =>
    allKnowledgeItems.map(i => ({ title: i.title, tactic_summary: i.tactic_summary })),
    [allKnowledgeItems]
  );

  const candidates = useMemo(() =>
    resources.filter(r => {
      const hasStatus = CLASSIFIABLE_STATUSES.has(r.enrichment_status);
      const hasManualContent = !!(r.content && r.content.length > 30);
      return (hasStatus || hasManualContent) && !r.is_template && !r.content_classification;
    }), [resources]);

  const classifications = useMemo(() => classifyResources(candidates), [candidates]);
  const summary = useMemo(() => summarizeBuckets(classifications), [classifications]);

  const allItems: CandidateItem[] = useMemo(() =>
    candidates.map(r => {
      const c = classifications.get(r.id)!;
      const upside = computeUpsideScore(r as any, c);
      return { resource: r, classification: c, upside };
    }).filter(i => !!i.classification),
  [candidates, classifications]);

  // Top 25 ranked by upside
  const top25 = useMemo(() =>
    [...allItems].sort((a, b) => b.upside.total - a.upside.total).slice(0, 25),
  [allItems]);

  // Grouped by bucket
  const grouped = useMemo(() => {
    const groups: Record<ActionBucket, CandidateItem[]> = {
      promote_template: [], promote_example: [], extract_knowledge: [],
      manual_review: [], reference_only: [],
    };
    for (const item of allItems) {
      groups[item.classification.actionBucket].push(item);
    }
    for (const bucket of BUCKET_ORDER) {
      groups[bucket].sort((a, b) => b.upside.total - a.upside.total);
    }
    return groups;
  }, [allItems]);

  const [promoted, setPromoted] = useState<Set<string>>(new Set());
  const [guidedMode, setGuidedMode] = useState(false);
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [extractionPreview, setExtractionPreview] = useState<{
    resource: Resource;
    candidates: KnowledgeItemInsert[];
    selected: Set<number>;
    editingIdx: number | null;
    editText: string;
  } | null>(null);

  // ── Promote handler ──────────────────────────────────────

  const handlePromote = useCallback(async (
    resource: Resource,
    targetRole: 'template' | 'example' | 'knowledge' | 'reference' | 'archive',
    classification: ClassificationResult,
  ) => {
    if (!user) return;
    try {
      if (targetRole === 'template') {
        await supabase.from('resources').update({
          is_template: true,
          template_category: classification.detectedUseCases[0] || 'Custom',
          resource_type: 'template',
        }).eq('id', resource.id);
        // Also create execution_template for immediate use
        await supabase.from('execution_templates' as any).insert({
          user_id: user.id,
          title: resource.title,
          body: resource.content || '',
          output_type: classification.detectedUseCases[0]?.toLowerCase().replace(/[\s\/]+/g, '_') || 'custom',
          template_type: 'other',
          template_origin: 'promoted_from_resource',
          status: 'active',
          tags: classification.capabilities,
          stage: classification.detectedUseCases[0] || null,
        } as any);
        toast.success(`"${resource.title}" promoted to Template — now usable in generation`);
      } else if (targetRole === 'example') {
        await supabase.from('execution_outputs').insert({
          user_id: user.id,
          title: resource.title,
          content: resource.content || '',
          output_type: classification.detectedUseCases[0]?.toLowerCase().replace(/[\s\/]+/g, '_') || 'custom',
          is_strong_example: true,
          stage: classification.detectedUseCases[0] || null,
        });
        toast.success(`"${resource.title}" saved as Example — now visible in evidence`);
      } else if (targetRole === 'knowledge') {
        const source: ExtractionSource = {
          resourceId: resource.id,
          userId: user.id,
          title: resource.title,
          content: resource.content,
          description: resource.description,
          tags: resource.tags || [],
          resourceType: resource.resource_type,
        };
        const extracted = extractKnowledgeHeuristic(source, existingForDedup);
        if (extracted.length === 0) {
          toast.info('No actionable tactics found — try manual review');
          return;
        }
        setExtractionPreview({
          resource,
          candidates: extracted,
          selected: new Set(extracted.map((_, i) => i)),
          editingIdx: null,
          editText: '',
        });
        return;
      } else if (targetRole === 'archive') {
        await supabase.from('resources').update({
          content_classification: 'archived',
        }).eq('id', resource.id);
        toast.success(`"${resource.title}" archived`);
      } else {
        await supabase.from('resources').update({
          content_classification: 'reference',
        }).eq('id', resource.id);
        toast.success(`"${resource.title}" marked as Reference`);
      }
      setPromoted(prev => new Set(prev).add(resource.id));
      qc.invalidateQueries({ queryKey: ['resources'] });
    } catch {
      toast.error('Action failed');
    }
  }, [user, qc]);

  // ── Save extracted knowledge ─────────────────────────────

  const handleSaveExtractedKnowledge = useCallback(async () => {
    if (!extractionPreview) return;
    const selected = extractionPreview.candidates.filter((_, i) => extractionPreview.selected.has(i));
    // Quality gate: flag low-quality items
    const highQuality = selected.filter(item => {
      const summary = item.tactic_summary || '';
      const isGeneric = summary.length < 20 || /summary|overview|introduction|chapter/i.test(summary);
      return !isGeneric;
    });
    const lowQuality = selected.length - highQuality.length;

    if (highQuality.length === 0) {
      toast.info('No high-quality items to save — all flagged as too generic');
      return;
    }
    try {
      // Auto-activate high-confidence items
      const toInsert: KnowledgeItemInsert[] = highQuality.map(item => ({
        ...item,
        status: ((item.confidence_score ?? 0) >= 0.6 && item.when_to_use ? 'active' : 'review_needed') as 'active' | 'review_needed',
        active: (item.confidence_score ?? 0) >= 0.6 && !!item.when_to_use,
      }));
      await insertKnowledge.mutateAsync(toInsert);
      const autoActivated = toInsert.filter(i => i.active).length;
      setPromoted(prev => new Set(prev).add(extractionPreview.resource.id));
      setExtractionPreview(null);
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast.success(`Saved ${highQuality.length} items (${autoActivated} auto-activated)${lowQuality > 0 ? `, ${lowQuality} low-quality skipped` : ''}`);
    } catch {
      toast.error('Failed to save knowledge items');
    }
  }, [extractionPreview, insertKnowledge, qc]);

  // ── Bulk promote ─────────────────────────────────────────

  const handleBulkPromoteTemplates = useCallback(async () => {
    if (!user) return;
    const items = grouped.promote_template.filter(i => !promoted.has(i.resource.id)).slice(0, 10);
    if (items.length === 0) { toast.info('No templates to promote'); return; }
    let count = 0;
    for (const { resource, classification } of items) {
      try {
        await supabase.from('resources').update({
          is_template: true, template_category: classification.detectedUseCases[0] || 'Custom',
          resource_type: 'template',
        }).eq('id', resource.id);
        await supabase.from('execution_templates' as any).insert({
          user_id: user.id, title: resource.title, body: resource.content || '',
          output_type: classification.detectedUseCases[0]?.toLowerCase().replace(/[\s\/]+/g, '_') || 'custom',
          template_type: 'other', template_origin: 'promoted_from_resource', status: 'active',
          tags: classification.capabilities, stage: classification.detectedUseCases[0] || null,
        } as any);
        setPromoted(prev => new Set(prev).add(resource.id));
        count++;
      } catch { /* continue */ }
    }
    qc.invalidateQueries({ queryKey: ['resources'] });
    toast.success(`Promoted ${count} templates — now usable in generation`);
  }, [user, grouped.promote_template, promoted, qc]);

  const handleBulkPromoteExamples = useCallback(async () => {
    if (!user) return;
    const items = grouped.promote_example.filter(i => !promoted.has(i.resource.id)).slice(0, 20);
    if (items.length === 0) { toast.info('No examples to promote'); return; }
    let count = 0;
    for (const { resource, classification } of items) {
      try {
        await supabase.from('execution_outputs').insert({
          user_id: user.id, title: resource.title, content: resource.content || '',
          output_type: classification.detectedUseCases[0]?.toLowerCase().replace(/[\s\/]+/g, '_') || 'custom',
          is_strong_example: true, stage: classification.detectedUseCases[0] || null,
        });
        setPromoted(prev => new Set(prev).add(resource.id));
        count++;
      } catch { /* continue */ }
    }
    qc.invalidateQueries({ queryKey: ['resources'] });
    toast.success(`Promoted ${count} examples — now visible in evidence`);
  }, [user, grouped.promote_example, promoted, qc]);

  // ── Bulk auto-activate knowledge ─────────────────────────

  const handleBulkAutoActivate = useCallback(async () => {
    if (!user) return;
    const { data: reviewItems } = await supabase
      .from('knowledge_items')
      .select('id, confidence_score, when_to_use, tactic_summary')
      .eq('user_id', user.id)
      .in('status', ['review_needed', 'extracted'])
      .eq('active', false)
      .limit(200);

    // Lowered threshold: activate anything actionable
    const qualifiers = (reviewItems || []).filter(item =>
      item.confidence_score >= 0.4 &&
      item.tactic_summary &&
      item.tactic_summary.length > 15
    );

    if (qualifiers.length === 0) { toast.info('No items qualify for activation'); return; }

    let count = 0;
    for (const item of qualifiers) {
      const { error } = await supabase
        .from('knowledge_items')
        .update({ status: 'active', active: true })
        .eq('id', item.id);
      if (!error) count++;
    }
    qc.invalidateQueries({ queryKey: ['knowledge-items'] });
    toast.success(`Auto-activated ${count} knowledge items — now usable in execution`);
  }, [user, qc]);

  // ── Batch backfill via edge function ─────────────────────

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    processed: number; knowledge_created: number; templates_created: number;
    failed: number; remaining: number;
  } | null>(null);

  const handleBatchBackfill = useCallback(async () => {
    if (!user) return;
    setBatchRunning(true);
    setBatchResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('batch-actionize', {
        body: { batchSize: 15 },
      });
      if (error) throw error;
      setBatchResult(data);
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast.success(`Processed ${data.processed} resources → ${data.knowledge_created} actions created`);
    } catch (err) {
      console.error('Batch backfill failed:', err);
      toast.error('Batch backfill failed');
    } finally {
      setBatchRunning(false);
    }
  }, [user, qc]);

  // ── Guided extraction mode ───────────────────────────────

  const guidedItems = useMemo(() =>
    grouped.extract_knowledge.filter(i => !promoted.has(i.resource.id)),
  [grouped.extract_knowledge, promoted]);

  const currentGuidedItem = guidedMode && guidedItems.length > 0 ? guidedItems[Math.min(guidedIndex, guidedItems.length - 1)] : null;

  const handleGuidedExtract = useCallback(() => {
    if (!currentGuidedItem || !user) return;
    handlePromote(currentGuidedItem.resource, 'knowledge', currentGuidedItem.classification);
  }, [currentGuidedItem, user, handlePromote]);

  const handleGuidedSkip = useCallback(() => {
    setGuidedIndex(prev => prev + 1);
    if (guidedIndex + 1 >= guidedItems.length) {
      setGuidedMode(false);
      toast.info('All items reviewed');
    }
  }, [guidedIndex, guidedItems.length]);

  // ── Render ───────────────────────────────────────────────

  if (candidates.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-card p-6 text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No resources awaiting classification.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Canonical summary header */}
      <SummaryHeader
        summary={summary}
        totalCandidates={candidates.length}
        totalPromoted={promoted.size}
        onBulkTemplates={handleBulkPromoteTemplates}
        onBulkExamples={handleBulkPromoteExamples}
        onBulkActivate={handleBulkAutoActivate}
        onStartGuided={() => { setGuidedMode(true); setGuidedIndex(0); }}
        guidedAvailable={guidedItems.length}
        onBatchBackfill={handleBatchBackfill}
        batchRunning={batchRunning}
        batchResult={batchResult}
      />

      {/* Stuck reasons */}
      {summary.topStuckReasons.length > 0 && (
        <div className="border border-status-yellow/30 rounded-lg bg-status-yellow/5 p-3">
          <p className="text-xs font-medium text-status-yellow flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Why resources are stuck
          </p>
          <ul className="space-y-0.5">
            {summary.topStuckReasons.map((reason, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">• {reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Guided extraction mode */}
      {guidedMode && currentGuidedItem && (
        <GuidedExtractionCard
          item={currentGuidedItem}
          index={guidedIndex}
          total={guidedItems.length}
          onExtract={handleGuidedExtract}
          onSkip={handleGuidedSkip}
          onExit={() => setGuidedMode(false)}
        />
      )}

      {/* TOP 25 — Highest Impact */}
      {!guidedMode && <Top25Section items={top25} promoted={promoted} onPromote={handlePromote} />}

      {/* Action buckets */}
      {!guidedMode && BUCKET_ORDER.map(bucket => (
        <BucketSection
          key={bucket}
          bucket={bucket}
          items={grouped[bucket]}
          promoted={promoted}
          onPromote={handlePromote}
        />
      ))}

      {/* Knowledge extraction preview dialog */}
      {extractionPreview && (
        <ExtractionPreviewDialog
          preview={extractionPreview}
          onToggle={(idx) => {
            setExtractionPreview(prev => {
              if (!prev) return null;
              const next = new Set(prev.selected);
              next.has(idx) ? next.delete(idx) : next.add(idx);
              return { ...prev, selected: next };
            });
          }}
          onEdit={(idx) => {
            setExtractionPreview(prev => {
              if (!prev) return null;
              return { ...prev, editingIdx: idx, editText: prev.candidates[idx]?.tactic_summary || '' };
            });
          }}
          onSaveEdit={() => {
            setExtractionPreview(prev => {
              if (!prev || prev.editingIdx === null) return prev;
              const updated = [...prev.candidates];
              updated[prev.editingIdx] = { ...updated[prev.editingIdx], tactic_summary: prev.editText };
              return { ...prev, candidates: updated, editingIdx: null, editText: '' };
            });
          }}
          onEditTextChange={(text) => {
            setExtractionPreview(prev => prev ? { ...prev, editText: text } : null);
          }}
          onSave={handleSaveExtractedKnowledge}
          onClose={() => setExtractionPreview(null)}
          saving={insertKnowledge.isPending}
        />
      )}
    </div>
  );
}

// ── Summary Header ─────────────────────────────────────────

function SummaryHeader({ summary, totalCandidates, totalPromoted, onBulkTemplates, onBulkExamples, onBulkActivate, onStartGuided, guidedAvailable, onBatchBackfill, batchRunning, batchResult }: {
  summary: BucketSummary; totalCandidates: number; totalPromoted: number;
  onBulkTemplates: () => void; onBulkExamples: () => void; onBulkActivate: () => void;
  onStartGuided: () => void; guidedAvailable: number;
  onBatchBackfill: () => void; batchRunning: boolean;
  batchResult: { processed: number; knowledge_created: number; templates_created: number; failed: number; remaining: number } | null;
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <ArrowUpRight className="h-4 w-4 text-primary" />
            Resource Upside Backlog
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalCandidates} classifiable · {totalPromoted} promoted this session
          </p>
        </div>
      </div>

      {/* Bucket counts */}
      <div className="grid grid-cols-5 gap-2">
        {BUCKET_ORDER.map(bucket => {
          const cfg = BUCKET_CONFIG[bucket];
          const Icon = cfg.icon;
          const count = summary[bucket];
          return (
            <div key={bucket} className="text-center p-2 rounded-md bg-muted/30 border border-border">
              <Icon className={cn('h-4 w-4 mx-auto mb-1', cfg.color)} />
              <p className="text-lg font-bold text-foreground">{count}</p>
              <p className="text-[9px] text-muted-foreground leading-tight">
                {bucket === 'promote_template' ? 'Template' :
                 bucket === 'promote_example' ? 'Example' :
                 bucket === 'extract_knowledge' ? 'Knowledge' :
                 bucket === 'manual_review' ? 'Review' : 'Reference'}
              </p>
            </div>
          );
        })}
      </div>

      {/* Batch result */}
      {batchResult && (
        <div className="rounded-md bg-muted/50 border border-border p-2.5 text-xs space-y-0.5">
          <p className="font-medium text-foreground">
            Batch: {batchResult.processed} processed → {batchResult.knowledge_created} actions, {batchResult.templates_created} templates
          </p>
          {batchResult.failed > 0 && (
            <p className="text-destructive">{batchResult.failed} failed (need transformation)</p>
          )}
          {batchResult.remaining > 0 && (
            <p className="text-muted-foreground">{batchResult.remaining} remaining — run again to continue</p>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="default" className="h-7 text-[10px] gap-1" onClick={onBatchBackfill} disabled={batchRunning}>
          {batchRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
          {batchRunning ? 'Processing...' : 'Batch Actionize (15)'}
        </Button>
        {summary.promote_template > 0 && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={onBulkTemplates}>
            <Crown className="h-3 w-3 text-amber-500" />
            Promote Templates
          </Button>
        )}
        {summary.promote_example > 0 && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={onBulkExamples}>
            <Star className="h-3 w-3 text-primary" />
            Promote Examples
          </Button>
        )}
        {guidedAvailable > 0 && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={onStartGuided}>
            <Play className="h-3 w-3 text-emerald-500" />
            Guided ({guidedAvailable})
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={onBulkActivate}>
          <Zap className="h-3 w-3 text-amber-500" />
          Activate All
        </Button>
      </div>
    </div>
  );
}

// ── Guided Extraction Card ─────────────────────────────────

function GuidedExtractionCard({ item, index, total, onExtract, onSkip, onExit }: {
  item: CandidateItem; index: number; total: number;
  onExtract: () => void; onSkip: () => void; onExit: () => void;
}) {
  const { resource, classification, upside } = item;
  return (
    <div className="border-2 border-emerald-500/40 rounded-lg bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-emerald-500" />
          <span className="text-xs font-semibold text-foreground">Guided Extraction</span>
          <Badge variant="outline" className="text-[10px]">{index + 1} / {total}</Badge>
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onExit}>Exit</Button>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">{resource.title}</p>
        <p className="text-[10px] text-muted-foreground">{classification.reason}</p>
        {classification.detectedUseCases.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {classification.detectedUseCases.map(uc => (
              <Badge key={uc} variant="outline" className="text-[9px]">{uc}</Badge>
            ))}
            {classification.capabilities.map(cap => (
              <Badge key={cap} variant="outline" className="text-[9px] border-dashed">{cap.replace(/_/g, ' ')}</Badge>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Why it matters: {upside.factors.join(' · ')} ({upside.total}pt)
        </p>

        {/* Content preview */}
        {resource.content && (
          <div className="bg-muted/50 border border-border rounded-md p-2 max-h-32 overflow-y-auto">
            <p className="text-[10px] text-muted-foreground whitespace-pre-wrap">{resource.content.slice(0, 600)}</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="gap-1 text-xs" onClick={onExtract}>
          <Brain className="h-3 w-3" /> Extract Knowledge
        </Button>
        <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={onSkip}>
          <SkipForward className="h-3 w-3" /> Skip
        </Button>
      </div>
    </div>
  );
}

// ── Top 25 Section ─────────────────────────────────────────

function Top25Section({ items, promoted, onPromote }: {
  items: CandidateItem[];
  promoted: Set<string>;
  onPromote: (r: Resource, role: 'template' | 'example' | 'knowledge' | 'reference' | 'archive', c: ClassificationResult) => void;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  const ROLE_ICON: Record<string, { icon: typeof Crown; color: string; label: string }> = {
    template: { icon: Crown, color: 'text-amber-500', label: 'Template' },
    example: { icon: Star, color: 'text-primary', label: 'Example' },
    knowledge: { icon: Brain, color: 'text-emerald-500', label: 'Knowledge' },
    reference: { icon: FileText, color: 'text-muted-foreground', label: 'Reference' },
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-primary/30 rounded-lg bg-primary/5">
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-primary/10 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-primary" />}
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">Highest Impact to Unlock</span>
        <Badge variant="outline" className="text-[10px] ml-auto bg-primary/15 text-primary border-primary/30">
          Top {items.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-1.5">
        <p className="text-[10px] text-muted-foreground mb-2">
          Ranked by multi-use potential, capability richness, content depth, and stage relevance.
        </p>
        {items.map(({ resource, classification, upside }, idx) => {
          const isPromoted = promoted.has(resource.id);
          const roleInfo = ROLE_ICON[classification.role] || ROLE_ICON.reference;
          const RoleIcon = roleInfo.icon;
          const targetRole = classification.role as 'template' | 'example' | 'knowledge' | 'reference';

          return (
            <div
              key={resource.id}
              className={cn(
                'flex items-start gap-2 p-2.5 rounded-md border text-xs transition-colors',
                isPromoted ? 'border-status-green/30 bg-status-green/5' : 'border-border bg-card',
              )}
            >
              <span className="text-[10px] font-bold text-muted-foreground w-4 shrink-0 pt-0.5">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isPromoted && <CheckCircle2 className="h-3 w-3 text-status-green shrink-0" />}
                  <span className="font-medium text-foreground truncate">{resource.title}</span>
                  <Badge className={cn('text-[9px] shrink-0 gap-0.5', CONFIDENCE_BADGE[classification.confidence])}>
                    <RoleIcon className={cn('h-2.5 w-2.5', roleInfo.color)} />
                    {roleInfo.label}
                  </Badge>
                  <Badge variant="outline" className="text-[9px] shrink-0">{upside.total}pt</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{upside.factors.join(' · ')}</p>
                {classification.detectedUseCases.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {classification.detectedUseCases.map(uc => (
                      <Badge key={uc} variant="outline" className="text-[9px]">{uc}</Badge>
                    ))}
                  </div>
                )}
              </div>
              {!isPromoted && (
                <Button
                  size="sm" variant="outline" className="h-6 text-[10px] gap-1 shrink-0"
                  onClick={() => onPromote(resource, targetRole, classification)}
                >
                  <RoleIcon className={cn('h-3 w-3', roleInfo.color)} />
                  {targetRole === 'knowledge' ? 'Extract' : 'Promote'}
                </Button>
              )}
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Bucket Section ─────────────────────────────────────────

function BucketSection({
  bucket, items, promoted, onPromote,
}: {
  bucket: ActionBucket;
  items: CandidateItem[];
  promoted: Set<string>;
  onPromote: (r: Resource, role: 'template' | 'example' | 'knowledge' | 'reference' | 'archive', c: ClassificationResult) => void;
}) {
  const cfg = BUCKET_CONFIG[bucket];
  const [open, setOpen] = useState(cfg.defaultOpen && items.length > 0);
  const Icon = cfg.icon;

  if (items.length === 0) return null;

  const targetRole: 'template' | 'example' | 'knowledge' | 'reference' =
    bucket === 'promote_template' ? 'template' :
    bucket === 'promote_example' ? 'example' :
    bucket === 'extract_knowledge' ? 'knowledge' : 'reference';

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border rounded-lg bg-card">
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-muted/50 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <Icon className={cn('h-4 w-4', cfg.color)} />
        <span className="text-xs font-semibold text-foreground">{cfg.label}</span>
        <Badge variant="outline" className={cn('text-[10px] ml-auto', cfg.badgeClass)}>{items.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-1.5">
        <p className="text-[10px] text-muted-foreground mb-2">{cfg.description}</p>
        {items.slice(0, 15).map(({ resource, classification, upside }) => {
          const isPromoted = promoted.has(resource.id);
          return (
            <div
              key={resource.id}
              className={cn(
                'flex items-start gap-2 p-2.5 rounded-md border text-xs transition-colors',
                isPromoted ? 'border-status-green/30 bg-status-green/5' : 'border-border bg-background',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isPromoted && <CheckCircle2 className="h-3 w-3 text-status-green shrink-0" />}
                  <span className="font-medium text-foreground truncate">{resource.title}</span>
                  <Badge className={cn('text-[9px] shrink-0', CONFIDENCE_BADGE[classification.confidence])}>
                    {classification.confidence.toUpperCase()}
                  </Badge>
                  <Badge variant="outline" className="text-[9px]">{upside.total}pt</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{classification.reason}</p>
                {(classification.detectedUseCases.length > 0 || classification.capabilities.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {classification.detectedUseCases.map(uc => (
                      <Badge key={uc} variant="outline" className="text-[9px]">{uc}</Badge>
                    ))}
                    {classification.capabilities.map(cap => (
                      <Badge key={cap} variant="outline" className="text-[9px] border-dashed">{cap.replace(/_/g, ' ')}</Badge>
                    ))}
                  </div>
                )}
                {classification.stuckReason && (
                  <p className="text-[10px] text-status-yellow mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" /> {classification.stuckReason}
                  </p>
                )}
              </div>
              {!isPromoted && (
                <div className="flex flex-col gap-1 shrink-0">
                  {bucket === 'manual_review' ? (
                    <>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                        onClick={() => onPromote(resource, 'template', classification)}>
                        <Crown className="h-3 w-3 text-amber-500" /> Template
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                        onClick={() => onPromote(resource, 'example', classification)}>
                        <Star className="h-3 w-3 text-primary" /> Example
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                        onClick={() => onPromote(resource, 'knowledge', classification)}>
                        <Brain className="h-3 w-3 text-emerald-500" /> Knowledge
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground"
                        onClick={() => onPromote(resource, 'reference', classification)}>
                        Reference
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground"
                        onClick={() => onPromote(resource, 'archive', classification)}>
                        <Archive className="h-3 w-3" /> Archive
                      </Button>
                    </>
                  ) : bucket !== 'reference_only' ? (
                    <>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                        onClick={() => onPromote(resource, targetRole, classification)}>
                        <Icon className={cn('h-3 w-3', cfg.color)} />
                        {bucket === 'extract_knowledge' ? 'Extract' : 'Promote'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground"
                        onClick={() => onPromote(resource, 'reference', classification)}>
                        Keep as Ref
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground"
                      onClick={() => onPromote(resource, 'archive', classification)}>
                      <Archive className="h-3 w-3" /> Archive
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length > 15 && (
          <p className="text-[10px] text-muted-foreground text-center py-1">+ {items.length - 15} more</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Knowledge Extraction Preview Dialog ────────────────────

function ExtractionPreviewDialog({ preview, onToggle, onEdit, onSaveEdit, onEditTextChange, onSave, onClose, saving }: {
  preview: { resource: Resource; candidates: KnowledgeItemInsert[]; selected: Set<number>; editingIdx: number | null; editText: string };
  onToggle: (idx: number) => void;
  onEdit: (idx: number) => void;
  onSaveEdit: () => void;
  onEditTextChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const selectedCount = preview.selected.size;
  // Quality check
  const qualityFlags = preview.candidates.map(item => {
    const summary = item.tactic_summary || '';
    return summary.length < 20 || /summary|overview|introduction|chapter/i.test(summary);
  });

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Brain className="h-4 w-4 text-emerald-500" />
            Knowledge Extraction Preview
          </DialogTitle>
          <DialogDescription className="text-xs">
            From: <span className="font-medium text-foreground">{preview.resource.title}</span>
            &nbsp;· {preview.candidates.length} candidates · {selectedCount} selected
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {preview.candidates.map((item, idx) => {
            const isSelected = preview.selected.has(idx);
            const confidence = Math.round((item.confidence_score ?? 0) * 100);
            const isLowQuality = qualityFlags[idx];
            const isEditing = preview.editingIdx === idx;

            return (
              <div
                key={idx}
                className={cn(
                  'flex items-start gap-2 p-3 rounded-md border text-xs transition-colors',
                  isLowQuality && isSelected ? 'border-status-yellow/40 bg-status-yellow/5' :
                  isSelected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/30 opacity-60',
                )}
              >
                <Checkbox checked={isSelected} className="mt-0.5" onCheckedChange={() => onToggle(idx)} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-foreground">{item.title}</span>
                    <Badge variant="outline" className="text-[9px]">{item.chapter?.replace(/_/g, ' ')}</Badge>
                    <Badge className={cn('text-[9px]', confidence >= 55 ? 'bg-status-green/15 text-status-green' : 'bg-muted text-muted-foreground')}>
                      {confidence}%
                    </Badge>
                    {isLowQuality && (
                      <Badge className="text-[9px] bg-status-yellow/15 text-status-yellow border-status-yellow/30">
                        LOW QUALITY
                      </Badge>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="space-y-1">
                      <Textarea
                        value={preview.editText}
                        onChange={e => onEditTextChange(e.target.value)}
                        rows={2}
                        className="text-[10px]"
                      />
                      <Button size="sm" variant="outline" className="h-5 text-[9px]" onClick={onSaveEdit}>
                        Save Edit
                      </Button>
                    </div>
                  ) : (
                    <>
                      {item.tactic_summary && (
                        <p className="text-[10px] text-muted-foreground">{item.tactic_summary}</p>
                      )}
                      <div className="flex gap-3 text-[10px] text-muted-foreground">
                        {item.when_to_use && <span>📍 {item.when_to_use}</span>}
                      </div>
                      {item.example_usage && (
                        <p className="text-[10px] italic text-muted-foreground border-l-2 border-border pl-2">
                          {item.example_usage}
                        </p>
                      )}
                    </>
                  )}
                </div>
                {!isEditing && (
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0 shrink-0" onClick={() => onEdit(idx)}>
                    <Edit3 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mr-auto">
            {qualityFlags.filter(Boolean).length > 0 && (
              <span className="text-status-yellow flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {qualityFlags.filter(Boolean).length} low-quality items will be skipped
              </span>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || selectedCount === 0} className="gap-1">
            <Brain className="h-3.5 w-3.5" />
            Save {selectedCount} Item{selectedCount !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
