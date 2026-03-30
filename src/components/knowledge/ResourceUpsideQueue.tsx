/**
 * Resource Upside Queue — execution-improvement backlog.
 * Ranked by unlockable value, with knowledge extraction preview.
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
  Archive, X, Eye, Edit3,
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

  const candidates = useMemo(() =>
    resources.filter(r => {
      const hasStatus = CLASSIFIABLE_STATUSES.has(r.enrichment_status);
      const hasManualContent = !!(r.content && r.content.length > 30);
      return (hasStatus || hasManualContent) && !r.is_template && !r.content_classification;
    }), [resources]);

  const classifications = useMemo(() => classifyResources(candidates), [candidates]);
  const summary = useMemo(() => summarizeBuckets(classifications), [classifications]);

  // Build items with upside scores
  const allItems: CandidateItem[] = useMemo(() =>
    candidates.map(r => {
      const c = classifications.get(r.id)!;
      const upside = computeUpsideScore(r as any, c);
      return { resource: r, classification: c, upside };
    }).filter(i => !!i.classification),
  [candidates, classifications]);

  // Top 20 ranked by upside
  const top20 = useMemo(() =>
    [...allItems].sort((a, b) => b.upside.total - a.upside.total).slice(0, 20),
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
  const [extractionPreview, setExtractionPreview] = useState<{
    resource: Resource;
    candidates: KnowledgeItemInsert[];
    selected: Set<number>;
  } | null>(null);

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
        toast.success(`"${resource.title}" promoted to Template`);
      } else if (targetRole === 'example') {
        await supabase.from('execution_outputs').insert({
          user_id: user.id,
          title: resource.title,
          content: resource.content || '',
          output_type: classification.detectedUseCases[0]?.toLowerCase().replace(/[\s\/]+/g, '_') || 'custom',
          is_strong_example: true,
          stage: classification.detectedUseCases[0] || null,
        });
        toast.success(`"${resource.title}" saved as Strong Example`);
      } else if (targetRole === 'knowledge') {
        // Show extraction preview instead of directly creating
        const source: ExtractionSource = {
          resourceId: resource.id,
          userId: user.id,
          title: resource.title,
          content: resource.content,
          description: resource.description,
          tags: resource.tags || [],
          resourceType: resource.resource_type,
        };
        const extracted = extractKnowledgeHeuristic(source);
        if (extracted.length === 0) {
          toast.info('No actionable tactics found — try manual review');
          return;
        }
        setExtractionPreview({
          resource,
          candidates: extracted,
          selected: new Set(extracted.map((_, i) => i)),
        });
        return; // Don't mark as promoted yet
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

  const handleSaveExtractedKnowledge = useCallback(async () => {
    if (!extractionPreview) return;
    const selected = extractionPreview.candidates.filter((_, i) => extractionPreview.selected.has(i));
    if (selected.length === 0) {
      toast.info('No items selected');
      return;
    }
    try {
      await insertKnowledge.mutateAsync(selected);
      setPromoted(prev => new Set(prev).add(extractionPreview.resource.id));
      setExtractionPreview(null);
      qc.invalidateQueries({ queryKey: ['resources'] });
    } catch {
      toast.error('Failed to save knowledge items');
    }
  }, [extractionPreview, insertKnowledge, qc]);

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
      <SummaryHeader summary={summary} totalCandidates={candidates.length} totalPromoted={promoted.size} />

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

      {/* TOP 20 — Highest Upside */}
      <Top20Section items={top20} promoted={promoted} onPromote={handlePromote} />

      {/* Action buckets */}
      {BUCKET_ORDER.map(bucket => (
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
          onSave={handleSaveExtractedKnowledge}
          onClose={() => setExtractionPreview(null)}
          saving={insertKnowledge.isPending}
        />
      )}
    </div>
  );
}

// ── Summary Header ─────────────────────────────────────────

function SummaryHeader({ summary, totalCandidates, totalPromoted }: {
  summary: BucketSummary; totalCandidates: number; totalPromoted: number;
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="flex items-center justify-between mb-3">
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
    </div>
  );
}

// ── Top 20 Section ─────────────────────────────────────────

function Top20Section({ items, promoted, onPromote }: {
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
        <span className="text-xs font-semibold text-foreground">Highest Upside to Unlock</span>
        <Badge variant="outline" className="text-[10px] ml-auto bg-primary/15 text-primary border-primary/30">
          Top {items.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-1.5">
        <p className="text-[10px] text-muted-foreground mb-2">
          Ranked by multi-use potential, confidence, capability richness, and promotability.
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
              {/* Rank */}
              <span className="text-[10px] font-bold text-muted-foreground w-4 shrink-0 pt-0.5">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isPromoted && <CheckCircle2 className="h-3 w-3 text-status-green shrink-0" />}
                  <span className="font-medium text-foreground truncate">{resource.title}</span>
                  <Badge className={cn('text-[9px] shrink-0 gap-0.5', CONFIDENCE_BADGE[classification.confidence])}>
                    <RoleIcon className={cn('h-2.5 w-2.5', roleInfo.color)} />
                    {roleInfo.label}
                  </Badge>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {upside.total}pt
                  </Badge>
                </div>
                {/* Why it matters */}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {upside.factors.join(' · ')}
                </p>
                {/* Use cases */}
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
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-1 shrink-0"
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
                      <Badge key={cap} variant="outline" className="text-[9px] border-dashed">
                        {cap.replace(/_/g, ' ')}
                      </Badge>
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

function ExtractionPreviewDialog({ preview, onToggle, onSave, onClose, saving }: {
  preview: { resource: Resource; candidates: KnowledgeItemInsert[]; selected: Set<number> };
  onToggle: (idx: number) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const selectedCount = preview.selected.size;

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
            &nbsp;· {preview.candidates.length} candidates found · {selectedCount} selected
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {preview.candidates.map((item, idx) => {
            const isSelected = preview.selected.has(idx);
            const confidence = Math.round((item.confidence_score ?? 0) * 100);
            return (
              <div
                key={idx}
                className={cn(
                  'flex items-start gap-2 p-3 rounded-md border text-xs transition-colors cursor-pointer',
                  isSelected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/30 opacity-60',
                )}
                onClick={() => onToggle(idx)}
              >
                <Checkbox checked={isSelected} className="mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-foreground">{item.title}</span>
                    <Badge variant="outline" className="text-[9px]">{item.chapter?.replace(/_/g, ' ')}</Badge>
                    <Badge className={cn('text-[9px]', confidence >= 55 ? 'bg-status-green/15 text-status-green' : 'bg-muted text-muted-foreground')}>
                      {confidence}%
                    </Badge>
                  </div>
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
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={onSave}
            disabled={saving || selectedCount === 0}
            className="gap-1"
          >
            <Brain className="h-3.5 w-3.5" />
            Save {selectedCount} Item{selectedCount !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
