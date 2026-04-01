/**
 * KnowledgeItemDrawer — detailed view/edit of a single knowledge item
 * rendered as a structured tactical play, not a short snippet
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
  Target, Brain, Lightbulb, ListChecks, Unlock, AlertTriangle,
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
  const [editing, setEditing] = useState(false);

  const item = items.find(i => i.id === itemId);

  const [form, setForm] = useState({
    title: '',
    tactic_summary: '',
    why_it_matters: '',
    when_to_use: '',
    when_not_to_use: '',
    example_usage: '',
    macro_situation: '',
    micro_strategy: '',
    how_to_execute: '',
    what_this_unlocks: '',
    chapter: '',
    sub_chapter: '',
    knowledge_type: 'skill' as string,
    who: '',
    framework: '',
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
        macro_situation: item.macro_situation || '',
        micro_strategy: item.micro_strategy || '',
        how_to_execute: item.how_to_execute || '',
        what_this_unlocks: item.what_this_unlocks || '',
        chapter: item.chapter,
        sub_chapter: item.sub_chapter || '',
        knowledge_type: item.knowledge_type,
        who: item.who || '',
        framework: item.framework || '',
      });
      setEditing(false);
    }
  }, [item]);

  if (!item) return null;

  const handleSave = () => {
    update.mutate({
      id: item.id,
      ...form,
      sub_chapter: form.sub_chapter || null,
      macro_situation: form.macro_situation || null,
      micro_strategy: form.micro_strategy || null,
      how_to_execute: form.how_to_execute || null,
      what_this_unlocks: form.what_this_unlocks || null,
      user_edited: true,
    } as any);
    setEditing(false);
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

  const chapterLabel = item.chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Structured read-only block for a play field
  const PlayField = ({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | null; color: string }) => {
    if (!value && !editing) return null;
    return (
      <div className={cn('rounded-lg border p-3 space-y-1.5', color)}>
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
        </div>
        {editing ? (
          <Textarea
            value={form[label.toLowerCase().replace(/ /g, '_') as keyof typeof form] || ''}
            onChange={e => setForm(f => ({ ...f, [label.toLowerCase().replace(/ /g, '_')]: e.target.value }))}
            rows={3} className="text-xs mt-1"
          />
        ) : (
          <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">{value}</p>
        )}
      </div>
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0">
          <SheetHeader className="p-4 pb-2 border-b border-border">
            <div className="flex items-start justify-between">
              <div>
                <SheetTitle className="text-sm">Tactical Play</SheetTitle>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  <Badge variant="outline" className="text-[9px]">{item.status}</Badge>
                  <Badge variant="outline" className="text-[9px]">{item.knowledge_type}</Badge>
                  <Badge variant="outline" className="text-[9px]">{chapterLabel}</Badge>
                  {item.framework && (
                    <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">{item.framework}</Badge>
                  )}
                  {item.who && (
                    <Badge variant="outline" className="text-[9px]">{item.who}</Badge>
                  )}
                  {item.active && (
                    <Badge className="text-[9px] bg-emerald-500/10 text-emerald-600 border-0">Active</Badge>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel' : 'Edit'}
              </Button>
            </div>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-90px)]">
            <div className="p-4 space-y-3">
              {/* Title */}
              {editing ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Title</Label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="text-sm font-medium" />
                </div>
              ) : (
                <h3 className="text-sm font-semibold leading-tight">{item.title}</h3>
              )}

              {/* Summary */}
              {(item.tactic_summary || editing) && (
                <div className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/30 pl-3">
                  {editing ? (
                    <Textarea value={form.tactic_summary} onChange={e => setForm(f => ({ ...f, tactic_summary: e.target.value }))} rows={2} className="text-xs" />
                  ) : (
                    item.tactic_summary
                  )}
                </div>
              )}

              <Separator />

              {/* Structured play fields */}
              <PlayField icon={Target} label="Macro Situation" value={item.macro_situation} color="border-blue-200/50 dark:border-blue-800/30 bg-blue-50/30 dark:bg-blue-950/10" />
              <PlayField icon={Brain} label="Micro Strategy" value={item.micro_strategy} color="border-violet-200/50 dark:border-violet-800/30 bg-violet-50/30 dark:bg-violet-950/10" />
              <PlayField icon={Lightbulb} label="Why It Matters" value={item.why_it_matters} color="border-amber-200/50 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/10" />
              <PlayField icon={ListChecks} label="How To Execute" value={item.how_to_execute} color="border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/30 dark:bg-emerald-950/10" />
              <PlayField icon={Unlock} label="What This Unlocks" value={item.what_this_unlocks} color="border-cyan-200/50 dark:border-cyan-800/30 bg-cyan-50/30 dark:bg-cyan-950/10" />

              {/* When to use / not use */}
              {(item.when_to_use || editing) && (
                <div className="rounded-lg border border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/30 dark:bg-emerald-950/10 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-xs font-semibold uppercase tracking-wide">When to Use</span>
                  </div>
                  {editing ? (
                    <Textarea value={form.when_to_use} onChange={e => setForm(f => ({ ...f, when_to_use: e.target.value }))} rows={2} className="text-xs" />
                  ) : (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{item.when_to_use}</p>
                  )}
                </div>
              )}

              {(item.when_not_to_use || editing) && (
                <div className="rounded-lg border border-red-200/50 dark:border-red-800/30 bg-red-50/30 dark:bg-red-950/10 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                    <span className="text-xs font-semibold uppercase tracking-wide">When NOT to Use</span>
                  </div>
                  {editing ? (
                    <Textarea value={form.when_not_to_use} onChange={e => setForm(f => ({ ...f, when_not_to_use: e.target.value }))} rows={2} className="text-xs" />
                  ) : (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{item.when_not_to_use}</p>
                  )}
                </div>
              )}

              {/* Example / Talk Track */}
              {(item.example_usage || editing) && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Play className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Example / Talk Track</span>
                  </div>
                  {editing ? (
                    <Textarea value={form.example_usage} onChange={e => setForm(f => ({ ...f, example_usage: e.target.value }))} rows={3} className="text-xs" />
                  ) : (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap italic">{item.example_usage}</p>
                  )}
                </div>
              )}

              {/* Edit-only: metadata fields */}
              {editing && (
                <>
                  <Separator />
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
                          {['cold_calling','discovery','objection_handling','negotiation','competitors','personas','messaging','closing','stakeholder_navigation','expansion','demo','follow_up'].map(ch => (
                            <SelectItem key={ch} value={ch}>{ch.replace(/_/g, ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Who</Label>
                      <Input value={form.who} onChange={e => setForm(f => ({ ...f, who: e.target.value }))} className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Framework</Label>
                      <Input value={form.framework} onChange={e => setForm(f => ({ ...f, framework: e.target.value }))} className="text-xs" />
                    </div>
                  </div>
                </>
              )}

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
                            <Badge key={`${dim}:${v}`} variant="outline" className={cn('text-[9px] h-5 px-1.5 gap-0.5', getDimensionColor(dim))}>
                              {getDimensionLabel(dim)}: {v.replace(/_/g, ' ')}
                              {editing && (
                                <button className="ml-0.5 hover:text-destructive" onClick={() => {
                                  const newTags = item.tags.filter(t => t !== `${dim}:${v}`);
                                  update.mutate({ id: item.id, tags: newTags } as any);
                                }}>
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </Badge>
                          );
                        });
                      });
                      item.tags.filter(t => !t.includes(':')).forEach(t => {
                        elements.push(<Badge key={t} variant="outline" className="text-[9px] h-5 px-1.5">{t}</Badge>);
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
                    {meta.activation_reason && <p className="text-[10px] text-muted-foreground">Why: {meta.activation_reason}</p>}
                    {meta.activation_timestamp && <p className="text-[10px] text-muted-foreground">When: {new Date(meta.activation_timestamp).toLocaleString()}</p>}
                  </div>
                );
              })()}

              <Separator />

              {/* Actions */}
              <div className="space-y-2">
                {editing && (
                  <Button className="w-full h-11 gap-2" onClick={handleSave}>
                    <Save className="h-4 w-4" /> Save Changes
                  </Button>
                )}

                {!item.active ? (
                  <Button variant="outline" className="w-full h-11 gap-2 text-emerald-600 border-emerald-600/30" onClick={handleApproveActivate}>
                    <Zap className="h-4 w-4" /> Approve + Activate
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full h-11 gap-2" onClick={handleDeactivate}>
                    Deactivate
                  </Button>
                )}

                {item.active && (
                  <div className="space-y-2">
                    <Button variant="outline" className="w-full h-11 gap-2 border-primary/30 text-primary" onClick={handlePracticeTactic}>
                      <Play className="h-4 w-4" /> Practice This Play
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center">
                      🎯 Roleplay will test whether you can execute "{item.title}"
                    </p>
                  </div>
                )}

                <Button variant="destructive" className="w-full h-11 gap-2" onClick={() => setDeleteConfirm(true)}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this tactical play?</AlertDialogTitle>
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
