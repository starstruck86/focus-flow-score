import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ExternalLink, Search, Copy, FileText, BookOpen, Target, FolderOpen, File,
  Link2, Plus, Trash2, Pencil, Upload, Check, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useAllResourceLinks,
  useAddResourceLink,
  useUpdateResourceLink,
  useDeleteResourceLink,
  detectUrlMeta,
  isValidUrl,
  type ResourceCategory,
  type ResourceLink,
} from '@/hooks/useResourceLinks';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';

const CATEGORY_META: Record<ResourceCategory, { label: string; icon: React.ElementType; color: string }> = {
  template: { label: 'Template', icon: FileText, color: 'bg-primary/10 text-primary' },
  framework: { label: 'Framework', icon: Target, color: 'bg-status-yellow/10 text-status-yellow' },
  playbook: { label: 'Playbook', icon: BookOpen, color: 'bg-status-green/10 text-status-green' },
  reference: { label: 'Reference', icon: FolderOpen, color: 'bg-accent text-accent-foreground' },
  other: { label: 'Other', icon: File, color: 'bg-muted text-muted-foreground' },
};

interface ResourceLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResourceLibraryModal({ open, onOpenChange }: ResourceLibraryModalProps) {
  const { data: links = [], isLoading } = useAllResourceLinks();
  const addMutation = useAddResourceLink();
  const updateMutation = useUpdateResourceLink();
  const deleteMutation = useDeleteResourceLink();
  const { accounts, opportunities } = useStore();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<ResourceCategory | 'all'>('all');
  const [activeTab, setActiveTab] = useState<string>('browse');

  // Single add form
  const [addUrl, setAddUrl] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addCategory, setAddCategory] = useState<ResourceCategory>('template');
  const [addNotes, setAddNotes] = useState('');

  // Bulk add
  const [bulkText, setBulkText] = useState('');
  const [bulkCategory, setBulkCategory] = useState<ResourceCategory>('reference');

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCategory, setEditCategory] = useState<ResourceCategory>('template');
  const [editNotes, setEditNotes] = useState('');

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const resetAddForm = () => { setAddUrl(''); setAddLabel(''); setAddCategory('template'); setAddNotes(''); };

  const handleUrlChange = (url: string) => {
    setAddUrl(url);
    if (url.trim() && isValidUrl(url.trim()) && !addLabel.trim()) {
      const meta = detectUrlMeta(url.trim());
      setAddLabel(meta.suggestedLabel);
      setAddCategory(meta.suggestedCategory);
    }
  };

  const handleAddSingle = () => {
    if (!addUrl.trim() || !isValidUrl(addUrl.trim())) {
      toast.error('Enter a valid URL');
      return;
    }
    const finalLabel = addLabel.trim() || detectUrlMeta(addUrl.trim()).suggestedLabel;
    addMutation.mutate(
      { url: addUrl.trim(), label: finalLabel, category: addCategory, notes: addNotes.trim() || null, account_id: null, opportunity_id: null, renewal_id: null },
      {
        onSuccess: () => { toast.success('Resource added'); resetAddForm(); setActiveTab('browse'); },
        onError: () => toast.error('Failed to add'),
      },
    );
  };

  const handleBulkAdd = () => {
    const urls = bulkText
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => isValidUrl(s));

    if (urls.length === 0) {
      toast.error('No valid URLs found. Paste one URL per line.');
      return;
    }

    let added = 0;
    let failed = 0;
    const total = urls.length;

    urls.forEach(url => {
      const meta = detectUrlMeta(url);
      addMutation.mutate(
        { url, label: meta.suggestedLabel, category: bulkCategory, notes: null, account_id: null, opportunity_id: null, renewal_id: null },
        {
          onSuccess: () => {
            added++;
            if (added + failed === total) {
              toast.success(`Added ${added} resource${added !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}`);
              setBulkText('');
              setActiveTab('browse');
            }
          },
          onError: () => {
            failed++;
            if (added + failed === total) {
              toast.success(`Added ${added}, ${failed} failed`);
            }
          },
        },
      );
    });
  };

  const startEdit = (link: ResourceLink) => {
    setEditingId(link.id);
    setEditLabel(link.label);
    setEditCategory(link.category);
    setEditNotes(link.notes || '');
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateMutation.mutate(
      { id: editingId, label: editLabel.trim() || 'Untitled', category: editCategory, notes: editNotes.trim() || null },
      { onSuccess: () => { toast.success('Updated'); setEditingId(null); }, onError: () => toast.error('Failed to update') },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, {
      onSuccess: () => { toast.success('Removed'); setDeleteTarget(null); },
    });
  };

  const filtered = links.filter(l => {
    if (filterCategory !== 'all' && l.category !== filterCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return l.label.toLowerCase().includes(q) || l.url.toLowerCase().includes(q) || (l.notes || '').toLowerCase().includes(q);
    }
    return true;
  });

  const grouped = filtered.reduce((acc, link) => {
    const cat = link.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(link);
    return acc;
  }, {} as Record<string, typeof links>);

  const getRecordName = (link: typeof links[0]) => {
    if (link.account_id) return accounts.find(a => a.id === link.account_id)?.name ?? null;
    if (link.opportunity_id) return opportunities.find(o => o.id === link.opportunity_id)?.name ?? null;
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Resource Library
          </DialogTitle>
          <DialogDescription>Add, organize, and reference your templates, frameworks, and playbooks.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="browse" className="text-xs">Browse ({links.length})</TabsTrigger>
            <TabsTrigger value="add" className="text-xs gap-1"><Plus className="h-3 w-3" /> Add</TabsTrigger>
            <TabsTrigger value="bulk" className="text-xs gap-1"><Upload className="h-3 w-3" /> Bulk Add</TabsTrigger>
          </TabsList>

          {/* ── Browse Tab ── */}
          <TabsContent value="browse" className="flex-1 flex flex-col min-h-0 mt-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Filter resources…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>

            <div className="flex gap-1 flex-wrap">
              <Badge variant={filterCategory === 'all' ? 'default' : 'outline'} className="cursor-pointer text-xs" onClick={() => setFilterCategory('all')}>
                All ({links.length})
              </Badge>
              {Object.entries(CATEGORY_META).map(([key, meta]) => {
                const count = links.filter(l => l.category === key).length;
                if (count === 0) return null;
                return (
                  <Badge
                    key={key}
                    variant={filterCategory === key ? 'default' : 'outline'}
                    className={cn('cursor-pointer text-xs', filterCategory !== key && meta.color)}
                    onClick={() => setFilterCategory(key as ResourceCategory)}
                  >
                    {meta.label} ({count})
                  </Badge>
                );
              })}
            </div>

            <ScrollArea className="flex-1 -mx-2 px-2">
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {links.length === 0 ? 'No resources yet.' : 'No results match your filter.'}
                  </p>
                  {links.length === 0 && (
                    <Button variant="outline" size="sm" onClick={() => setActiveTab('add')} className="gap-1">
                      <Plus className="h-3 w-3" /> Add your first resource
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3 py-1">
                  {Object.entries(grouped).map(([cat, catLinks]) => {
                    const meta = CATEGORY_META[cat as ResourceCategory] || CATEGORY_META.other;
                    const CatIcon = meta.icon;
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <CatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{meta.label}s</p>
                        </div>
                        <div className="space-y-1">
                          {catLinks.map(link => {
                            const recordName = getRecordName(link);
                            const isEditing = editingId === link.id;

                            if (isEditing) {
                              return (
                                <div key={link.id} className="rounded-md border border-primary/30 bg-accent/20 p-2 space-y-2">
                                  <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="Label" className="h-8 text-sm" />
                                  <div className="flex gap-2">
                                    <Select value={editCategory} onValueChange={v => setEditCategory(v as ResourceCategory)}>
                                      <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        {Object.entries(CATEGORY_META).map(([k, m]) => (
                                          <SelectItem key={k} value={k}><span className="flex items-center gap-1"><m.icon className="h-3 w-3" /> {m.label}</span></SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes (optional)" className="h-8 text-xs" />
                                  <div className="flex gap-1 justify-end">
                                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                                      <X className="h-3 w-3 mr-1" /> Cancel
                                    </Button>
                                    <Button size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={updateMutation.isPending}>
                                      <Check className="h-3 w-3 mr-1" /> Save
                                    </Button>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={link.id} className="group flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-3 py-2 hover:bg-accent/30 transition-colors">
                                <div className="flex-1 min-w-0">
                                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-foreground hover:underline truncate block">
                                    {link.label || 'Untitled'}
                                  </a>
                                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                    {recordName && <span>📌 {recordName}</span>}
                                    {link.notes && <span className="truncate">• {link.notes}</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { navigator.clipboard.writeText(link.url); toast.success('Copied'); }}>
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => startEdit(link)}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDeleteTarget(link.id)}>
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-6 w-6 items-center justify-center">
                                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* ── Add Single Tab ── */}
          <TabsContent value="add" className="mt-3 space-y-3">
            <div>
              <Label className="text-xs">URL</Label>
              <Input placeholder="https://docs.google.com/…" value={addUrl} onChange={e => handleUrlChange(e.target.value)} className="mt-1" autoFocus />
            </div>
            <div>
              <Label className="text-xs">Label</Label>
              <Input placeholder="e.g. Discovery Call Template" value={addLabel} onChange={e => setAddLabel(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={addCategory} onValueChange={v => setAddCategory(v as ResourceCategory)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-1.5"><m.icon className="h-3 w-3" /> {m.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea placeholder="When to use this resource…" value={addNotes} onChange={e => setAddNotes(e.target.value)} className="mt-1" rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={resetAddForm}>Clear</Button>
              <Button onClick={handleAddSingle} disabled={addMutation.isPending || !addUrl.trim()}>
                {addMutation.isPending ? 'Adding…' : 'Add Resource'}
              </Button>
            </div>
          </TabsContent>

          {/* ── Bulk Add Tab ── */}
          <TabsContent value="bulk" className="mt-3 space-y-3">
            <div>
              <Label className="text-xs">Paste URLs (one per line)</Label>
              <Textarea
                placeholder={"https://docs.google.com/document/d/...\nhttps://notion.so/my-playbook\nhttps://miro.com/board/..."}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                className="mt-1 font-mono text-xs"
                rows={6}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {bulkText.split(/[\n,]+/).filter(s => isValidUrl(s.trim())).length} valid URL{bulkText.split(/[\n,]+/).filter(s => isValidUrl(s.trim())).length !== 1 ? 's' : ''} detected
              </p>
            </div>
            <div>
              <Label className="text-xs">Category for all</Label>
              <Select value={bulkCategory} onValueChange={v => setBulkCategory(v as ResourceCategory)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-1.5"><m.icon className="h-3 w-3" /> {m.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setBulkText('')}>Clear</Button>
              <Button onClick={handleBulkAdd} disabled={addMutation.isPending || !bulkText.trim()}>
                {addMutation.isPending ? 'Adding…' : 'Add All'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this resource?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently remove the link from your library.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
