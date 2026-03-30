/**
 * Resource Upside Queue — action-first UI to unlock stuck resources.
 * Lives in Knowledge > Audit as the primary curation surface.
 */

import { useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Crown, Star, Brain, FileText, ChevronDown, ChevronRight,
  AlertTriangle, ArrowUpRight, CheckCircle2, Sparkles, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  classifyResources,
  summarizeBuckets,
  type ActionBucket,
  type ClassificationResult,
  type BucketSummary,
} from '@/lib/resourceClassifier';
import { useResources, type Resource } from '@/hooks/useResources';
import { useInsertKnowledgeItems } from '@/hooks/useKnowledgeItems';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

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
    label: 'Promote to Template',
    icon: Crown,
    color: 'text-amber-500',
    badgeClass: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    description: 'Reusable structures — promote to make them selectable in generation',
    defaultOpen: true,
  },
  promote_example: {
    label: 'Promote to Example',
    icon: Star,
    color: 'text-primary',
    badgeClass: 'bg-primary/15 text-primary border-primary/30',
    description: 'Strong outputs — promote to surface in evidence & ranking',
    defaultOpen: true,
  },
  extract_knowledge: {
    label: 'Extract Knowledge',
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
    description: 'Low confidence or stuck — needs human decision',
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
  'promote_template',
  'promote_example',
  'extract_knowledge',
  'manual_review',
  'reference_only',
];

// ── Eligible statuses ──────────────────────────────────────

const CLASSIFIABLE_STATUSES = new Set([
  'enriched', 'deep_enriched', 'verified',
]);

// ── Component ──────────────────────────────────────────────

export function ResourceUpsideQueue() {
  const { data: resources = [] } = useResources();
  const { user } = useAuth();
  const qc = useQueryClient();
  const insertKnowledge = useInsertKnowledgeItems();

  // Broad candidate scope: any classifiable, content-backed resource not already promoted
  const candidates = useMemo(() =>
    resources.filter(r => {
      const hasStatus = CLASSIFIABLE_STATUSES.has(r.enrichment_status);
      const hasManualContent = !!(r.content && r.content.length > 30);
      return (hasStatus || hasManualContent) && !r.is_template && !r.content_classification;
    }), [resources]);

  const classifications = useMemo(() => classifyResources(candidates), [candidates]);
  const summary = useMemo(() => summarizeBuckets(classifications), [classifications]);

  // Group by action bucket
  const grouped = useMemo(() => {
    const groups: Record<ActionBucket, Array<{ resource: Resource; classification: ClassificationResult }>> = {
      promote_template: [], promote_example: [], extract_knowledge: [],
      manual_review: [], reference_only: [],
    };
    for (const r of candidates) {
      const c = classifications.get(r.id);
      if (c) groups[c.actionBucket].push({ resource: r, classification: c });
    }
    const order = { high: 0, medium: 1, low: 2 };
    for (const bucket of BUCKET_ORDER) {
      groups[bucket].sort((a, b) => order[a.classification.confidence] - order[b.classification.confidence]);
    }
    return groups;
  }, [candidates, classifications]);

  const [promoted, setPromoted] = useState<Set<string>>(new Set());

  const handlePromote = useCallback(async (resource: Resource, targetRole: 'template' | 'example' | 'knowledge' | 'reference', classification: ClassificationResult) => {
    if (!user) return;
    try {
      if (targetRole === 'template') {
        await supabase.from('resources').update({
          is_template: true,
          template_category: classification.detectedUseCases[0] || 'Custom',
          resource_type: 'template',
        }).eq('id', resource.id);
        toast.success(`"${resource.title}" promoted to Template — now selectable in generation`);
      } else if (targetRole === 'example') {
        await supabase.from('execution_outputs').insert({
          user_id: user.id,
          title: resource.title,
          content: resource.content || '',
          output_type: classification.detectedUseCases[0]?.toLowerCase().replace(/[\s\/]+/g, '_') || 'custom',
          is_strong_example: true,
          stage: classification.detectedUseCases[0] || null,
        });
        toast.success(`"${resource.title}" saved as Strong Example — now available in evidence`);
      } else if (targetRole === 'knowledge') {
        // Create as review_needed — user must approve before activation
        insertKnowledge.mutate([{
          title: resource.title,
          chapter: classification.detectedUseCases[0]?.toLowerCase().replace(/[\s\/]+/g, '_') || 'general',
          knowledge_type: 'tactic' as any,
          tactic_summary: resource.description || resource.content?.slice(0, 500) || '',
          source_resource_id: resource.id,
          confidence_score: classification.confidence === 'high' ? 0.85 : classification.confidence === 'medium' ? 0.65 : 0.45,
          status: 'review_needed' as any,
          tags: [...(resource.tags || []), ...classification.capabilities],
          applies_to_contexts: classification.detectedUseCases,
          user_id: user.id,
        } as any]);
      } else {
        await supabase.from('resources').update({
          content_classification: 'reference',
        }).eq('id', resource.id);
        toast.success(`"${resource.title}" marked as Reference`);
      }

      setPromoted(prev => new Set(prev).add(resource.id));
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['execution-outputs'] });
    } catch {
      toast.error('Promotion failed');
    }
  }, [user, qc, insertKnowledge]);

  const totalCandidates = candidates.length;
  const totalPromoted = promoted.size;

  if (totalCandidates === 0) {
    return (
      <div className="border border-border rounded-lg bg-card p-6 text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No resources awaiting classification.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Enrich or upload resources to surface promotion candidates.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary header */}
      <SummaryHeader summary={summary} totalCandidates={totalCandidates} totalPromoted={totalPromoted} />

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
    </div>
  );
}

// ── Summary Header ─────────────────────────────────────────

function SummaryHeader({ summary, totalCandidates, totalPromoted }: {
  summary: BucketSummary;
  totalCandidates: number;
  totalPromoted: number;
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <ArrowUpRight className="h-4 w-4 text-primary" />
            Resource Upside Queue
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
              <p className="text-[9px] text-muted-foreground leading-tight">{cfg.label.replace('Promote to ', '').replace('Extract ', '')}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bucket Section ─────────────────────────────────────────

function BucketSection({
  bucket,
  items,
  promoted,
  onPromote,
}: {
  bucket: ActionBucket;
  items: Array<{ resource: Resource; classification: ClassificationResult }>;
  promoted: Set<string>;
  onPromote: (r: Resource, role: 'template' | 'example' | 'knowledge' | 'reference', c: ClassificationResult) => void;
}) {
  const cfg = BUCKET_CONFIG[bucket];
  const [open, setOpen] = useState(cfg.defaultOpen && items.length > 0);
  const Icon = cfg.icon;

  if (items.length === 0) return null;

  const targetRole: 'template' | 'example' | 'knowledge' | 'reference' =
    bucket === 'promote_template' ? 'template' :
    bucket === 'promote_example' ? 'example' :
    bucket === 'extract_knowledge' ? 'knowledge' :
    'reference';

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
        {items.slice(0, 15).map(({ resource, classification }) => {
          const isPromoted = promoted.has(resource.id);
          return (
            <div
              key={resource.id}
              className={cn(
                'flex items-start gap-2 p-2.5 rounded-md border text-xs transition-colors',
                isPromoted
                  ? 'border-status-green/30 bg-status-green/5'
                  : 'border-border bg-background'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isPromoted && <CheckCircle2 className="h-3 w-3 text-status-green shrink-0" />}
                  <span className="font-medium text-foreground truncate">{resource.title}</span>
                  <Badge className={cn('text-[9px] shrink-0', CONFIDENCE_BADGE[classification.confidence])}>
                    {classification.confidence.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{classification.reason}</p>

                {/* Use cases + capabilities */}
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

                {/* Stuck reason */}
                {classification.stuckReason && (
                  <p className="text-[10px] text-status-yellow mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {classification.stuckReason}
                  </p>
                )}

                {classification.signals.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 italic">
                    {classification.signals.join(' · ')}
                  </p>
                )}
              </div>
              {!isPromoted && (
                <div className="flex flex-col gap-1 shrink-0">
                  {bucket !== 'manual_review' && bucket !== 'reference_only' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => onPromote(resource, targetRole, classification)}
                    >
                      <Icon className={cn('h-3 w-3', cfg.color)} />
                      {bucket === 'extract_knowledge' ? 'Extract' : 'Promote'}
                    </Button>
                  )}
                  {bucket === 'manual_review' && (
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
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] text-muted-foreground"
                    onClick={() => onPromote(resource, 'reference', classification)}
                  >
                    Keep as Ref
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {items.length > 15 && (
          <p className="text-[10px] text-muted-foreground text-center py-1">
            + {items.length - 15} more
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
