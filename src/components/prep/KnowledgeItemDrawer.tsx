/**
 * KnowledgeItemDrawer — detailed view/edit of a single knowledge item
 * with one-click approve+activate and tactic-specific practice
 */

import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  CheckCircle2, Play, Trash2, ExternalLink, Save, Zap, X,
} from 'lucide-react';
import {
  useKnowledgeItems,
  useUpdateKnowledgeItem,
  useDeleteKnowledgeItem,
  type KnowledgeItem,
} from '@/hooks/useKnowledgeItems';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { groupTagsByDimension, getDimensionLabel, getDimensionColor } from '@/lib/resourceTags';
import { cn } from '@/lib/utils';
interface Props {
  itemId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KnowledgeItemDrawer({ itemId, open, onOpenChange }: Props) {
  const { data: items = [] } = useKnowledgeItems();
  const update = useUpdateKnowledgeItem();
  const deleteItem = useDeleteKnowledgeItem();
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const item = items.find(i => i.id === itemId);

  const [form, setForm] = useState({
    title: '',
    tactic_summary: '',
    why_it_matters: '',
    when_to_use: '',
    when_not_to_use: '',
    example_usage: '',
    chapter: '',
    sub_chapter: '',
    knowledge_type: 'skill' as string,
  });

  useEffect(() => {
    if (item) {
      setForm({
        title: item.title,
        tactic_summary: item.tactic_summary || '',
        why_it_matters: item.why_it_matters || '',
        when_to_use: item.when_to_use || '',
        when_not_to_use: item.when_not_to_use || '',
        example_usage: item.example_usage || '',
        chapter: item.chapter,
        sub_chapter: item.sub_chapter || '',
        knowledge_type: item.knowledge_type,
      });
    }
  }, [item]);

  if (!item) return null;

  const handleSave = () => {
    update.mutate({
      id: item.id,
      ...form,
      sub_chapter: form.sub_chapter || null,
      user_edited: true,
    } as any);
    toast.success('Knowledge item updated');
  };

  const handleApproveActivate = () => {
    update.mutate({ id: item.id, active: true, status: 'active' });
    toast.success(`"${item.title}" approved + activated — now available to Dave`);
  };

  const handleDeactivate = () => {
    update.mutate({ id: item.id, active: false, status: 'approved' });
    toast.info('Knowledge item deactivated');
  };

  const handleDelete = () => {
    deleteItem.mutate(item.id);
    onOpenChange(false);
  };

  const handlePracticeTactic = () => {
    window.dispatchEvent(new CustomEvent('dave-start-roleplay', {
      detail: { chapter: item.chapter, knowledgeItemId: item.id },
    }));
    toast.success(`🎯 Practice focused on: "${item.title}"`);
  };

  const handlePracticeChapter = () => {
    window.dispatchEvent(new CustomEvent('dave-start-roleplay', {
      detail: { chapter: item.chapter },
    }));
  };

  const chapterLabel = item.chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0">
          <SheetHeader className="p-4 pb-2 border-b border-border">
            <SheetTitle className="text-sm">Knowledge Item</SheetTitle>
            <div className="flex gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[9px]">{item.status}</Badge>
              <Badge variant="outline" className="text-[9px]">{item.knowledge_type}</Badge>
              <Badge variant="outline" className="text-[9px]">{chapterLabel}</Badge>
              {item.competitor_name && (
                <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive">vs {item.competitor_name}</Badge>
              )}
              {item.active && (
                <Badge className="text-[9px] bg-emerald-500/10 text-emerald-600 border-0">Active</Badge>
              )}
            </div>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-90px)]">
            <div className="p-4 space-y-4">
              {/* Title */}
              <div className="space-y-1.5">
                <Label className="text-xs">Title</Label>
                <Input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="text-sm"
                />
              </div>

              {/* Type + Chapter */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Type</Label>
                  <Select value={form.knowledge_type} onValueChange={v => setForm(f => ({ ...f, knowledge_type: v }))}>
                    <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skill">Skill</SelectItem>
                      <SelectItem value="product">Product</SelectItem>
                      <SelectItem value="competitive">Competitive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Chapter</Label>
                  <Select value={form.chapter} onValueChange={v => setForm(f => ({ ...f, chapter: v }))}>
                    <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['cold_calling','discovery','objection_handling','negotiation','competitors','personas','messaging','closing','stakeholder_navigation','expansion'].map(ch => (
                        <SelectItem key={ch} value={ch}>{ch.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Sub-chapter */}
              <div className="space-y-1.5">
                <Label className="text-xs">Sub-chapter (optional)</Label>
                <Input
                  value={form.sub_chapter}
                  onChange={e => setForm(f => ({ ...f, sub_chapter: e.target.value }))}
                  placeholder="e.g. openers, pricing_traps"
                  className="text-xs"
                />
              </div>

              <Separator />

              {/* Tactic summary */}
              <div className="space-y-1.5">
                <Label className="text-xs">Tactic Summary</Label>
                <Textarea
                  value={form.tactic_summary}
                  onChange={e => setForm(f => ({ ...f, tactic_summary: e.target.value }))}
                  rows={3} className="text-xs"
                />
              </div>

              {/* Why it matters */}
              <div className="space-y-1.5">
                <Label className="text-xs">Why It Matters</Label>
                <Textarea
                  value={form.why_it_matters}
                  onChange={e => setForm(f => ({ ...f, why_it_matters: e.target.value }))}
                  rows={2} className="text-xs"
                />
              </div>

              {/* When to use */}
              <div className="space-y-1.5">
                <Label className="text-xs">When to Use</Label>
                <Textarea
                  value={form.when_to_use}
                  onChange={e => setForm(f => ({ ...f, when_to_use: e.target.value }))}
                  rows={2} className="text-xs"
                />
              </div>

              {/* When NOT to use */}
              <div className="space-y-1.5">
                <Label className="text-xs">When NOT to Use</Label>
                <Textarea
                  value={form.when_not_to_use}
                  onChange={e => setForm(f => ({ ...f, when_not_to_use: e.target.value }))}
                  rows={2} className="text-xs"
                />
              </div>

              {/* Example usage */}
              <div className="space-y-1.5">
                <Label className="text-xs">Example / Talk Track</Label>
                <Textarea
                  value={form.example_usage}
                  onChange={e => setForm(f => ({ ...f, example_usage: e.target.value }))}
                  rows={2} className="text-xs"
                />
              </div>

              {/* Tags */}
              {item.tags && item.tags.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Tags</Label>
                  <div className="flex flex-wrap gap-1">
                    {(() => {
                      const groups = groupTagsByDimension(item.tags);
                      const elements: React.ReactNode[] = [];
                      groups.forEach((vals, dim) => {
                        vals.forEach(v => {
                          elements.push(
                            <Badge
                              key={`${dim}:${v}`}
                              variant="outline"
                              className={cn('text-[9px] h-5 px-1.5 gap-0.5', getDimensionColor(dim))}
                            >
                              {getDimensionLabel(dim)}: {v.replace(/_/g, ' ')}
                              <button
                                className="ml-0.5 hover:text-destructive"
                                onClick={() => {
                                  const newTags = item.tags.filter(t => t !== `${dim}:${v}`);
                                  update.mutate({ id: item.id, tags: newTags } as any);
                                }}
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </Badge>
                          );
                        });
                      });
                      // Also show non-structured tags
                      item.tags.filter(t => !t.includes(':')).forEach(t => {
                        elements.push(
                          <Badge key={t} variant="outline" className="text-[9px] h-5 px-1.5">{t}</Badge>
                        );
                      });
                      return elements;
                    })()}
                  </div>
                </div>
              )}

              <Separator />

              {/* Meta */}
              <div className="text-[10px] text-muted-foreground space-y-1">
                <p>Confidence: {(item.confidence_score * 100).toFixed(0)}%</p>
                <p>Created: {new Date(item.created_at).toLocaleDateString()}</p>
                {item.source_resource_id && (
                  <p className="flex items-center gap-1">
                    Source: <ExternalLink className="h-2.5 w-2.5 inline" /> {item.source_resource_id.slice(0, 8)}
                  </p>
                )}
              </div>

              {/* Activation provenance */}
              {item.active && (item as any).activation_metadata && (() => {
                const meta = (item as any).activation_metadata;
                return (
                  <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 space-y-1">
                    <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {meta.activation_source === 'auto_pipeline' ? 'Auto-Activated by Pipeline' : 'Manually Activated'}
                    </p>
                    {meta.activation_reason && (
                      <p className="text-[10px] text-muted-foreground">Why: {meta.activation_reason}</p>
                    )}
                    {meta.activation_timestamp && (
                      <p className="text-[10px] text-muted-foreground">
                        When: {new Date(meta.activation_timestamp).toLocaleString()}
                      </p>
                    )}
                    {meta.activation_rule_version && (
                      <p className="text-[10px] text-muted-foreground">Rule v{meta.activation_rule_version}</p>
                    )}
                  </div>
                );
              })()}

              <Separator />

              {/* Actions */}
              <div className="space-y-2">
                <Button className="w-full h-11 gap-2" onClick={handleSave}>
                  <Save className="h-4 w-4" />
                  Save Changes
                </Button>

                {!item.active ? (
                  <Button
                    variant="outline"
                    className="w-full h-11 gap-2 text-emerald-600 border-emerald-600/30"
                    onClick={handleApproveActivate}
                  >
                    <Zap className="h-4 w-4" />
                    Approve + Activate
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full h-11 gap-2" onClick={handleDeactivate}>
                    Deactivate
                  </Button>
                )}

                {item.active && (
                  <div className="space-y-2">
                    <Button variant="outline" className="w-full h-11 gap-2 border-primary/30 text-primary" onClick={handlePracticeTactic}>
                      <Play className="h-4 w-4" />
                      Practice This Tactic
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center">
                      🎯 Roleplay will focus on "{item.title}" — Dave tests whether you can execute this specific tactic
                    </p>

                    <Button variant="ghost" className="w-full h-9 gap-2 text-xs text-muted-foreground" onClick={handlePracticeChapter}>
                      <Play className="h-3 w-3" />
                      Practice Full {chapterLabel} Chapter
                    </Button>
                  </div>
                )}

                <Button variant="destructive" className="w-full h-11 gap-2" onClick={() => setDeleteConfirm(true)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete knowledge item?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
