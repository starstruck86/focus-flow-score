/**
 * Trust Review Queue — reviewable backlog of extracted-but-not-activated items.
 *
 * Shows items that failed one or more trust gates, with:
 *  - trust score + failed gates
 *  - most similar existing item (if distinctness failed)
 *  - detected use case / chapter / example
 *  - one-click: activate, edit→activate, merge, discard
 *  - queue-level filters by failed gate
 */

import { useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertTriangle, ChevronDown, ChevronRight, CheckCircle2,
  Edit3, Merge, Trash2, Zap, Filter, ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useKnowledgeItems,
  useUpdateKnowledgeItem,
  useDeleteKnowledgeItem,
  type KnowledgeItem,
} from '@/hooks/useKnowledgeItems';
import { validateTrust, type TrustValidation } from '@/lib/trustValidation';
import { toast } from 'sonner';

// ── Gate filter types ──────────────────────────────────────

type GateFilter = 'specificity' | 'actionability' | 'distinctness' | 'use_case_clarity' | 'phrasing_quality';

const GATE_LABELS: Record<GateFilter, string> = {
  specificity: 'Specificity',
  actionability: 'Actionability',
  distinctness: 'Distinctness',
  use_case_clarity: 'Use-case Clarity',
  phrasing_quality: 'Phrasing Quality',
};

const GATE_COLORS: Record<GateFilter, string> = {
  specificity: 'text-orange-500',
  actionability: 'text-red-500',
  distinctness: 'text-amber-500',
  use_case_clarity: 'text-blue-500',
  phrasing_quality: 'text-purple-500',
};

// ── Component ──────────────────────────────────────────────

interface ReviewableItem {
  item: KnowledgeItem;
  trust: TrustValidation;
}

export function TrustReviewQueue() {
  const { data: allItems = [] } = useKnowledgeItems();
  const updateItem = useUpdateKnowledgeItem();
  const deleteItem = useDeleteKnowledgeItem();

  const [gateFilters, setGateFilters] = useState<Set<GateFilter>>(new Set());
  const [open, setOpen] = useState(true);
  const [editDialog, setEditDialog] = useState<KnowledgeItem | null>(null);
  const [editFields, setEditFields] = useState({ title: '', tactic_summary: '', when_to_use: '', example_usage: '' });
  const [mergeDialog, setMergeDialog] = useState<KnowledgeItem | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');

  // Items in review: not active, status is review_needed or extracted
  const reviewItems = useMemo(() => {
    const existing = allItems
      .filter(i => i.active)
      .map(i => ({ title: i.title, tactic_summary: i.tactic_summary }));

    const candidates = allItems.filter(
      i => !i.active && (i.status === 'review_needed' || i.status === 'extracted')
    );

    const withTrust: ReviewableItem[] = candidates.map(item => ({
      item,
      trust: validateTrust(
        {
          title: item.title,
          tactic_summary: item.tactic_summary,
          when_to_use: item.when_to_use,
          example_usage: item.example_usage,
          chapter: item.chapter,
        },
        existing,
      ),
    }));

    // Sort by overall trust score ascending (worst first = most actionable)
    withTrust.sort((a, b) => a.trust.overall - b.trust.overall);
    return withTrust;
  }, [allItems]);

  // Apply gate filters
  const filteredItems = useMemo(() => {
    if (gateFilters.size === 0) return reviewItems;
    return reviewItems.filter(({ trust }) =>
      [...gateFilters].some(gate => trust.failedGates.includes(gate))
    );
  }, [reviewItems, gateFilters]);

  // Gate counts for filter chips
  const gateCounts = useMemo(() => {
    const counts: Record<GateFilter, number> = {
      specificity: 0, actionability: 0, distinctness: 0,
      use_case_clarity: 0, phrasing_quality: 0,
    };
    for (const { trust } of reviewItems) {
      for (const gate of trust.failedGates) {
        if (gate in counts) counts[gate as GateFilter]++;
      }
    }
    return counts;
  }, [reviewItems]);

  // ── Actions ──────────────────────────────────────────────

  const handleActivate = useCallback(async (item: KnowledgeItem) => {
    await updateItem.mutateAsync({ id: item.id, status: 'active' as any, active: true });
    toast.success(`"${item.title}" activated`);
  }, [updateItem]);

  const handleDiscard = useCallback(async (item: KnowledgeItem) => {
    await deleteItem.mutateAsync(item.id);
  }, [deleteItem]);

  const openEditDialog = useCallback((item: KnowledgeItem) => {
    setEditFields({
      title: item.title,
      tactic_summary: item.tactic_summary || '',
      when_to_use: item.when_to_use || '',
      example_usage: item.example_usage || '',
    });
    setEditDialog(item);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editDialog) return;
    await updateItem.mutateAsync({
      id: editDialog.id,
      title: editFields.title,
      tactic_summary: editFields.tactic_summary,
      when_to_use: editFields.when_to_use,
      example_usage: editFields.example_usage,
      status: 'active' as any,
      active: true,
      user_edited: true,
    });
    setEditDialog(null);
    toast.success(`"${editFields.title}" edited & activated`);
  }, [editDialog, editFields, updateItem]);

  const openMergeDialog = useCallback((item: KnowledgeItem) => {
    setMergeTargetId('');
    setMergeDialog(item);
  }, []);

  const handleMerge = useCallback(async () => {
    if (!mergeDialog || !mergeTargetId) return;
    const target = allItems.find(i => i.id === mergeTargetId);
    if (!target) { toast.error('Target item not found'); return; }

    // Merge: append example + when_to_use into target, delete source
    const mergedSummary = [target.tactic_summary, mergeDialog.tactic_summary].filter(Boolean).join('\n\n');
    const mergedExample = [target.example_usage, mergeDialog.example_usage].filter(Boolean).join('\n---\n');
    const mergedWhen = [target.when_to_use, mergeDialog.when_to_use].filter(Boolean).join('; ');

    await updateItem.mutateAsync({
      id: target.id,
      tactic_summary: mergedSummary,
      example_usage: mergedExample,
      when_to_use: mergedWhen,
    });
    await deleteItem.mutateAsync(mergeDialog.id);
    setMergeDialog(null);
    toast.success(`Merged into "${target.title}"`);
  }, [mergeDialog, mergeTargetId, allItems, updateItem, deleteItem]);

  const toggleGateFilter = useCallback((gate: GateFilter) => {
    setGateFilters(prev => {
      const next = new Set(prev);
      next.has(gate) ? next.delete(gate) : next.add(gate);
      return next;
    });
  }, []);

  if (reviewItems.length === 0) return null;

  // Merge target candidates: active items similar to the merge source
  const mergeTargets = mergeDialog
    ? allItems.filter(i => i.active && i.id !== mergeDialog.id).slice(0, 50)
    : [];

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen} className="border border-status-yellow/30 rounded-lg bg-status-yellow/5">
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-status-yellow/10 transition-colors">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-status-yellow" /> : <ChevronRight className="h-3.5 w-3.5 text-status-yellow" />}
          <ShieldAlert className="h-4 w-4 text-status-yellow" />
          <span className="text-xs font-semibold text-foreground">Needs Review — Trust Validation</span>
          <Badge variant="outline" className="text-[10px] ml-auto bg-status-yellow/15 text-status-yellow border-status-yellow/30">
            {filteredItems.length}{gateFilters.size > 0 ? ` / ${reviewItems.length}` : ''}
          </Badge>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Items extracted but not activated — failed one or more trust gates. Review to activate, edit, merge, or discard.
          </p>

          {/* Gate filter chips */}
          <div className="flex flex-wrap gap-1">
            {(Object.keys(GATE_LABELS) as GateFilter[]).map(gate => {
              const count = gateCounts[gate];
              if (count === 0) return null;
              const isActive = gateFilters.has(gate);
              return (
                <Button
                  key={gate}
                  size="sm"
                  variant={isActive ? 'default' : 'outline'}
                  className={cn('h-6 text-[10px] gap-1', !isActive && 'opacity-70')}
                  onClick={() => toggleGateFilter(gate)}
                >
                  <Filter className="h-2.5 w-2.5" />
                  {GATE_LABELS[gate]} ({count})
                </Button>
              );
            })}
            {gateFilters.size > 0 && (
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground" onClick={() => setGateFilters(new Set())}>
                Clear
              </Button>
            )}
          </div>

          {/* Items */}
          {filteredItems.slice(0, 30).map(({ item, trust }) => (
            <ReviewItemRow
              key={item.id}
              item={item}
              trust={trust}
              onActivate={() => handleActivate(item)}
              onEdit={() => openEditDialog(item)}
              onMerge={() => openMergeDialog(item)}
              onDiscard={() => handleDiscard(item)}
            />
          ))}
          {filteredItems.length > 30 && (
            <p className="text-[10px] text-muted-foreground text-center py-1">+ {filteredItems.length - 30} more</p>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Edit dialog */}
      {editDialog && (
        <Dialog open onOpenChange={() => setEditDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <Edit3 className="h-4 w-4" /> Edit & Activate
              </DialogTitle>
              <DialogDescription className="text-xs">
                Fix failed gates, then activate.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Title</label>
                <Input
                  value={editFields.title}
                  onChange={e => setEditFields(f => ({ ...f, title: e.target.value }))}
                  className="text-xs h-8"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">What to do (action)</label>
                <Textarea
                  value={editFields.tactic_summary}
                  onChange={e => setEditFields(f => ({ ...f, tactic_summary: e.target.value }))}
                  className="text-xs min-h-[60px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">When to use</label>
                <Textarea
                  value={editFields.when_to_use}
                  onChange={e => setEditFields(f => ({ ...f, when_to_use: e.target.value }))}
                  className="text-xs min-h-[40px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Example phrasing</label>
                <Textarea
                  value={editFields.example_usage}
                  onChange={e => setEditFields(f => ({ ...f, example_usage: e.target.value }))}
                  className="text-xs min-h-[40px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setEditDialog(null)}>Cancel</Button>
              <Button size="sm" className="gap-1" onClick={handleSaveEdit} disabled={updateItem.isPending}>
                <CheckCircle2 className="h-3 w-3" /> Save & Activate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Merge dialog */}
      {mergeDialog && (
        <Dialog open onOpenChange={() => setMergeDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <Merge className="h-4 w-4" /> Merge into Existing
              </DialogTitle>
              <DialogDescription className="text-xs">
                Merge "{mergeDialog.title}" into an existing active item.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {mergeTargets.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active items to merge into.</p>
              ) : (
                mergeTargets.map(target => (
                  <button
                    key={target.id}
                    className={cn(
                      'w-full text-left p-2.5 rounded-md border text-xs transition-colors',
                      mergeTargetId === target.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:bg-muted/50'
                    )}
                    onClick={() => setMergeTargetId(target.id)}
                  >
                    <p className="font-medium text-foreground">{target.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{target.tactic_summary}</p>
                  </button>
                ))
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setMergeDialog(null)}>Cancel</Button>
              <Button size="sm" className="gap-1" onClick={handleMerge} disabled={!mergeTargetId || updateItem.isPending}>
                <Merge className="h-3 w-3" /> Merge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── Review Item Row ────────────────────────────────────────

function ReviewItemRow({ item, trust, onActivate, onEdit, onMerge, onDiscard }: {
  item: KnowledgeItem;
  trust: TrustValidation;
  onActivate: () => void;
  onEdit: () => void;
  onMerge: () => void;
  onDiscard: () => void;
}) {
  const scorePercent = Math.round(trust.overall * 100);
  const scoreColor = scorePercent >= 60 ? 'text-status-green' : scorePercent >= 35 ? 'text-status-yellow' : 'text-destructive';

  return (
    <div className="p-2.5 rounded-md border border-border bg-card text-xs space-y-1.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-foreground">{item.title}</span>
            <Badge variant="outline" className={cn('text-[9px]', scoreColor)}>
              {scorePercent}%
            </Badge>
            <Badge variant="outline" className="text-[9px]">
              {item.chapter.replace(/_/g, ' ')}
            </Badge>
          </div>

          {/* Failed gates */}
          <div className="flex flex-wrap gap-1 mt-1">
            {trust.failedGates.map(gate => (
              <Badge
                key={gate}
                variant="outline"
                className={cn('text-[9px] border-destructive/30 bg-destructive/5', GATE_COLORS[gate as GateFilter] || 'text-destructive')}
              >
                ✗ {GATE_LABELS[gate as GateFilter] || gate}
              </Badge>
            ))}
            {trust.passed && (
              <Badge variant="outline" className="text-[9px] border-status-green/30 bg-status-green/5 text-status-green">
                All gates passed
              </Badge>
            )}
          </div>

          {/* Most similar if distinctness failed */}
          {trust.distinctness.mostSimilar && (
            <p className="text-[10px] text-status-yellow mt-0.5 flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              Similar to: "{trust.distinctness.mostSimilar}"
            </p>
          )}

          {/* Source resource */}
          {item.source_resource_id && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Source: {item.source_resource_id.slice(0, 8)}…
            </p>
          )}

          {/* Use case / example preview */}
          {item.when_to_use && (
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
              When: {item.when_to_use}
            </p>
          )}
          {item.example_usage && (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-1 italic">
              Ex: {item.example_usage}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onActivate}>
            <Zap className="h-3 w-3 text-amber-500" /> Activate
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onEdit}>
            <Edit3 className="h-3 w-3" /> Edit
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onMerge}>
            <Merge className="h-3 w-3" /> Merge
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-destructive hover:text-destructive" onClick={onDiscard}>
            <Trash2 className="h-3 w-3" /> Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
