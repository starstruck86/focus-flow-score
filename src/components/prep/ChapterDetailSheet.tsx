/**
 * ChapterDetailSheet — shows knowledge items within a chapter
 * with approve+activate quick action and tactic-specific practice
 */

import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, CheckCircle2, Clock, AlertTriangle, Eye, Sparkles, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKnowledgeItems, useUpdateKnowledgeItem, type KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { toast } from 'sonner';
import { FrameworkBadge } from '@/components/knowledge/FrameworkBadge';

const CHAPTER_LABELS: Record<string, string> = {
  cold_calling: 'Cold Calling',
  discovery: 'Discovery',
  objection_handling: 'Objection Handling',
  negotiation: 'Negotiation',
  competitors: 'Competitors',
  personas: 'Personas',
  messaging: 'Messaging',
  closing: 'Closing',
  stakeholder_navigation: 'Stakeholder Navigation',
  expansion: 'Expansion',
};

interface Props {
  chapter: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectItem: (id: string) => void;
  onPractice: (chapter: string) => void;
  onPracticeTactic?: (chapter: string, knowledgeItemId: string) => void;
}

export function ChapterDetailSheet({ chapter, open, onOpenChange, onSelectItem, onPractice, onPracticeTactic }: Props) {
  const { data: items = [] } = useKnowledgeItems(chapter ?? undefined);
  const update = useUpdateKnowledgeItem();

  const grouped = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>();
    for (const item of items) {
      const key = item.sub_chapter || 'general';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()].sort((a, b) => {
      const activeA = a[1].filter(i => i.active).length;
      const activeB = b[1].filter(i => i.active).length;
      return activeB - activeA;
    });
  }, [items]);

  if (!chapter) return null;

  const activeCount = items.filter(i => i.active).length;
  const contextCount = items.filter(i => i.active && i.applies_to_contexts?.length > 0).length;
  const lastUpdated = items.length > 0
    ? items.reduce((latest, i) => i.updated_at > latest ? i.updated_at : latest, items[0].updated_at)
    : null;
  const competitorNames = [...new Set(items.filter(i => i.competitor_name).map(i => i.competitor_name!))];

  const handleApproveActivate = (item: KnowledgeItem) => {
    update.mutate({ id: item.id, active: true, status: 'active' });
    toast.success(`"${item.title}" approved + activated`);
  };

  const handleActivate = (item: KnowledgeItem) => {
    update.mutate({ id: item.id, active: true, status: 'active' });
  };

  const handleDeactivate = (item: KnowledgeItem) => {
    update.mutate({ id: item.id, active: false, status: 'approved' });
  };

  const handlePracticeTactic = (item: KnowledgeItem) => {
    if (onPracticeTactic) {
      onPracticeTactic(item.chapter, item.id);
    } else {
      window.dispatchEvent(new CustomEvent('dave-start-roleplay', {
        detail: { chapter: item.chapter, knowledgeItemId: item.id },
      }));
      toast.success(`🎯 Practice focused on: "${item.title}"`);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        <SheetHeader className="p-4 pb-2 border-b border-border">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">{CHAPTER_LABELS[chapter] || chapter}</SheetTitle>
            {activeCount > 0 && (
              <Button size="sm" className="gap-1.5 h-8" onClick={() => onPractice(chapter)}>
                <Play className="h-3 w-3" />
                Practice Chapter
              </Button>
            )}
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
            <span>{items.length} items</span>
            <span>·</span>
            <span className="text-emerald-600">{activeCount} active</span>
            {contextCount > 0 && (
              <>
                <span>·</span>
                <span>{contextCount} available to Dave</span>
              </>
            )}
            {lastUpdated && (
              <>
                <span>·</span>
                <span>Updated {new Date(lastUpdated).toLocaleDateString()}</span>
              </>
            )}
          </div>
          {competitorNames.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Competitors: {competitorNames.join(', ')}
            </p>
          )}

          {/* Knowledge grounding indicator */}
          {activeCount > 0 && (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-primary">
              <CheckCircle2 className="h-3 w-3" />
              <span>Dave will use {activeCount} active items when you practice this chapter</span>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-130px)]">
          <div className="p-4 space-y-4">
            {grouped.length === 0 && (
              <div className="text-center py-8">
                <Sparkles className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No knowledge items in this chapter yet</p>
                <p className="text-xs text-muted-foreground mt-1">Extract knowledge from your resources to populate this playbook</p>
              </div>
            )}

            {grouped.map(([subChapter, subItems]) => (
              <div key={subChapter}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {subChapter.replace(/_/g, ' ')}
                </h3>
                <div className="space-y-2">
                  {subItems.map(item => (
                    <KnowledgeCard
                      key={item.id}
                      item={item}
                      onSelect={() => onSelectItem(item.id)}
                      onApproveActivate={() => handleApproveActivate(item)}
                      onActivate={() => handleActivate(item)}
                      onDeactivate={() => handleDeactivate(item)}
                      onPracticeTactic={() => handlePracticeTactic(item)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function KnowledgeCard({ item, onSelect, onApproveActivate, onActivate, onDeactivate, onPracticeTactic }: {
  item: KnowledgeItem;
  onSelect: () => void;
  onApproveActivate: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onPracticeTactic: () => void;
}) {
  const statusConfig = {
    extracted: { label: 'Extracted', color: 'bg-blue-500/10 text-blue-600', icon: Eye },
    review_needed: { label: 'Review', color: 'bg-status-yellow/10 text-status-yellow', icon: AlertTriangle },
    approved: { label: 'Approved', color: 'bg-emerald-500/10 text-emerald-600', icon: CheckCircle2 },
    active: { label: 'Active', color: 'bg-emerald-500/10 text-emerald-600', icon: CheckCircle2 },
    stale: { label: 'Stale', color: 'bg-orange-500/10 text-orange-600', icon: Clock },
  };

  const config = statusConfig[item.status] || statusConfig.extracted;
  const StatusIcon = config.icon;
  const isHighConfidence = item.confidence_score >= 0.7;
  const canQuickActivate = !item.active && (item.status === 'extracted' || item.status === 'review_needed' || item.status === 'approved');

  return (
    <div
      className="p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Badge className={cn('text-[9px] h-4 px-1.5 border-0', config.color)}>
              <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
              {config.label}
            </Badge>
            <Badge variant="outline" className="text-[9px] h-4 px-1.5">
              {item.knowledge_type}
            </Badge>
            {item.competitor_name && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-destructive/30 text-destructive">
                vs {item.competitor_name}
              </Badge>
            )}
            {isHighConfidence && canQuickActivate && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-emerald-500/30 text-emerald-600">
                high confidence
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <FrameworkBadge who={item.who} framework={item.framework} />
          </div>
          {item.tactic_summary && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.tactic_summary}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
        {canQuickActivate && (
          <Button size="sm" className="h-7 text-[10px] gap-1" onClick={onApproveActivate}>
            <Zap className="h-3 w-3" />
            {isHighConfidence ? 'Approve + Activate' : 'Activate'}
          </Button>
        )}
        {item.active && (
          <>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={onPracticeTactic}>
              <Play className="h-3 w-3" />
              Practice This Tactic
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={onDeactivate}>
              Deactivate
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
