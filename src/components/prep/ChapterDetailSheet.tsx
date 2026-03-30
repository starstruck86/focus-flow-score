/**
 * ChapterDetailSheet — shows knowledge items within a chapter
 */

import { useMemo, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, CheckCircle2, Clock, AlertTriangle, Eye, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKnowledgeItems, useUpdateKnowledgeItem, type KnowledgeItem } from '@/hooks/useKnowledgeItems';

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
}

export function ChapterDetailSheet({ chapter, open, onOpenChange, onSelectItem, onPractice }: Props) {
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

  const handleActivate = (item: KnowledgeItem) => {
    update.mutate({
      id: item.id,
      active: true,
      status: 'active',
    });
  };

  const handleApprove = (item: KnowledgeItem) => {
    update.mutate({
      id: item.id,
      status: 'approved',
    });
  };

  const handleDeactivate = (item: KnowledgeItem) => {
    update.mutate({
      id: item.id,
      active: false,
      status: 'approved',
    });
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
                Practice with Dave
              </Button>
            )}
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{items.length} items</span>
            <span>·</span>
            <span className="text-emerald-600">{activeCount} active</span>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-100px)]">
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
                      onActivate={() => handleActivate(item)}
                      onApprove={() => handleApprove(item)}
                      onDeactivate={() => handleDeactivate(item)}
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

function KnowledgeCard({ item, onSelect, onActivate, onApprove, onDeactivate }: {
  item: KnowledgeItem;
  onSelect: () => void;
  onActivate: () => void;
  onApprove: () => void;
  onDeactivate: () => void;
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

  return (
    <div
      className="p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
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
          </div>
          <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
          {item.tactic_summary && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.tactic_summary}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
        {!item.active && item.status !== 'active' && (
          <>
            {item.status === 'extracted' || item.status === 'review_needed' ? (
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={onApprove}>
                Approve
              </Button>
            ) : null}
            <Button size="sm" className="h-7 text-[10px] gap-1" onClick={onActivate}>
              <CheckCircle2 className="h-3 w-3" />
              Activate
            </Button>
          </>
        )}
        {item.active && (
          <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={onDeactivate}>
            Deactivate
          </Button>
        )}
      </div>
    </div>
  );
}
