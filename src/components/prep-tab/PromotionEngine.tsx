/**
 * Promotion Engine — classifies enriched resources and lets the user
 * promote them into Template / Example / Knowledge / Reference roles.
 */

import { useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Crown, Star, Brain, FileText, ChevronDown, ChevronRight,
  ArrowUpRight, Sparkles, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { classifyResources, type ResourceRole, type ClassificationResult } from '@/lib/resourceClassifier';
import { useResources, type Resource } from '@/hooks/useResources';
import { useKnowledgeItems } from '@/hooks/useKnowledgeItems';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

// ── Role config ────────────────────────────────────────────

const ROLE_CONFIG: Record<ResourceRole, {
  label: string;
  icon: typeof Crown;
  color: string;
  badgeClass: string;
  description: string;
}> = {
  template: {
    label: 'Template',
    icon: Crown,
    color: 'text-amber-500',
    badgeClass: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    description: 'Reusable structure — emails, frameworks, agendas',
  },
  example: {
    label: 'Example',
    icon: Star,
    color: 'text-primary',
    badgeClass: 'bg-primary/15 text-primary border-primary/30',
    description: 'Strong prior output worth referencing',
  },
  knowledge: {
    label: 'Knowledge',
    icon: Brain,
    color: 'text-emerald-500',
    badgeClass: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    description: 'Atomic tactic, insight, or principle',
  },
  reference: {
    label: 'Reference',
    icon: FileText,
    color: 'text-muted-foreground',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    description: 'Supporting material — low direct leverage',
  },
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: 'bg-status-green/15 text-status-green',
  medium: 'bg-status-yellow/15 text-status-yellow',
  low: 'bg-muted text-muted-foreground',
};

// ── Component ──────────────────────────────────────────────

export function PromotionEngine() {
  const { data: resources = [] } = useResources();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { createKnowledgeItem } = useKnowledgeItems();

  // Only classify enriched/complete resources that aren't already promoted
  const candidates = useMemo(() =>
    resources.filter(r =>
      r.enrichment_status === 'enriched' &&
      !r.is_template &&
      r.content && r.content.length > 50
    ), [resources]);

  const classifications = useMemo(() => classifyResources(candidates), [candidates]);

  // Group by role
  const grouped = useMemo(() => {
    const groups: Record<ResourceRole, Array<{ resource: Resource; classification: ClassificationResult }>> = {
      template: [], example: [], knowledge: [], reference: [],
    };
    for (const r of candidates) {
      const c = classifications.get(r.id);
      if (c) groups[c.role].push({ resource: r, classification: c });
    }
    // Sort each group by confidence (high first)
    const order = { high: 0, medium: 1, low: 2 };
    for (const role of Object.keys(groups) as ResourceRole[]) {
      groups[role].sort((a, b) => order[a.classification.confidence] - order[b.classification.confidence]);
    }
    return groups;
  }, [candidates, classifications]);

  const [promoted, setPromoted] = useState<Set<string>>(new Set());

  const handlePromote = useCallback(async (resource: Resource, targetRole: ResourceRole, classification: ClassificationResult) => {
    if (!user) return;
    try {
      if (targetRole === 'template') {
        await supabase.from('resources').update({
          is_template: true,
          template_category: classification.detectedUseCase || 'Custom',
          resource_type: 'template',
        }).eq('id', resource.id);
        toast.success(`"${resource.title}" promoted to Template`);
      } else if (targetRole === 'example') {
        // Save as execution_output marked as strong example
        await supabase.from('execution_outputs').insert({
          user_id: user.id,
          title: resource.title,
          content: resource.content || '',
          output_type: classification.detectedUseCase?.toLowerCase().replace(/\s+/g, '_') || 'custom',
          is_strong_example: true,
          stage: classification.detectedUseCase || null,
        });
        toast.success(`"${resource.title}" saved as Strong Example`);
      } else if (targetRole === 'knowledge') {
        createKnowledgeItem?.({
          title: resource.title,
          chapter: 'messaging',
          knowledge_type: 'tactic',
          tactic_summary: resource.description || resource.content?.slice(0, 500) || '',
          source_resource_id: resource.id,
          confidence_score: classification.confidence === 'high' ? 0.85 : classification.confidence === 'medium' ? 0.65 : 0.45,
          status: 'review_needed',
          tags: resource.tags || [],
          applies_to_contexts: classification.detectedUseCase ? [classification.detectedUseCase] : [],
        });
        toast.success(`"${resource.title}" extracted as Knowledge`);
      } else {
        // reference — just tag it
        await supabase.from('resources').update({
          content_classification: 'reference',
        }).eq('id', resource.id);
        toast.success(`"${resource.title}" marked as Reference`);
      }

      setPromoted(prev => new Set(prev).add(resource.id));
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['execution-outputs'] });
    } catch (e) {
      toast.error('Promotion failed');
    }
  }, [user, qc, createKnowledgeItem]);

  const totalCandidates = candidates.length;
  const totalPromoted = promoted.size;

  if (totalCandidates === 0) {
    return (
      <div className="border border-border rounded-lg bg-card p-4 text-center">
        <Sparkles className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No enriched resources awaiting classification.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="border border-border rounded-lg bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <ArrowUpRight className="h-4 w-4 text-primary" />
              Promotion Engine
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalCandidates} resources classified · {totalPromoted} promoted
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(['template', 'example', 'knowledge', 'reference'] as ResourceRole[]).map(role => {
              const cfg = ROLE_CONFIG[role];
              const Icon = cfg.icon;
              return (
                <Badge key={role} variant="outline" className={cn('text-[10px] gap-1', cfg.badgeClass)}>
                  <Icon className="h-3 w-3" />
                  {grouped[role].length}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Role sections */}
        {(['template', 'example', 'knowledge', 'reference'] as ResourceRole[]).map(role => (
          <RoleSection
            key={role}
            role={role}
            items={grouped[role]}
            promoted={promoted}
            onPromote={handlePromote}
          />
        ))}
      </div>
    </div>
  );
}

// ── Role Section ───────────────────────────────────────────

function RoleSection({
  role,
  items,
  promoted,
  onPromote,
}: {
  role: ResourceRole;
  items: Array<{ resource: Resource; classification: ClassificationResult }>;
  promoted: Set<string>;
  onPromote: (r: Resource, role: ResourceRole, c: ClassificationResult) => void;
}) {
  const [open, setOpen] = useState(role === 'template' || role === 'example');
  const cfg = ROLE_CONFIG[role];
  const Icon = cfg.icon;

  if (items.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <Icon className={cn('h-4 w-4', cfg.color)} />
        <span className="text-xs font-medium text-foreground">{cfg.label} Candidates</span>
        <Badge variant="outline" className="text-[10px] ml-auto">{items.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1 ml-5">
        <p className="text-[10px] text-muted-foreground mb-1.5">{cfg.description}</p>
        {items.slice(0, 10).map(({ resource, classification }) => {
          const isPromoted = promoted.has(resource.id);
          return (
            <div
              key={resource.id}
              className={cn(
                'flex items-start gap-2 p-2 rounded border text-xs transition-colors',
                isPromoted
                  ? 'border-status-green/30 bg-status-green/5'
                  : 'border-border bg-background'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {isPromoted && <CheckCircle2 className="h-3 w-3 text-status-green shrink-0" />}
                  <span className="font-medium text-foreground truncate">{resource.title}</span>
                  <Badge className={cn('text-[9px] shrink-0', CONFIDENCE_BADGE[classification.confidence])}>
                    {classification.confidence.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{classification.reason}</p>
                {classification.detectedUseCase && (
                  <Badge variant="outline" className="text-[9px] mt-1">{classification.detectedUseCase}</Badge>
                )}
                {classification.signals.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 italic">
                    {classification.signals.join(' · ')}
                  </p>
                )}
              </div>
              {!isPromoted && (
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => onPromote(resource, role, classification)}
                  >
                    <Icon className={cn('h-3 w-3', cfg.color)} />
                    Promote
                  </Button>
                  {role !== 'reference' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] text-muted-foreground"
                      onClick={() => onPromote(resource, 'reference', classification)}
                    >
                      Keep as Ref
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length > 10 && (
          <p className="text-[10px] text-muted-foreground text-center py-1">
            + {items.length - 10} more
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
