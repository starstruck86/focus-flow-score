import { useState, useEffect } from 'react';
import {
  ExternalLink, Plus, Trash2, FileText, BookOpen, Target, FolderOpen, File,
  Copy, Pencil, Link2, AlertTriangle, Presentation, Sheet, FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useResourceLinksForRecord,
  useAddResourceLink,
  useUpdateResourceLink,
  useDeleteResourceLink,
  detectUrlMeta,
  isValidUrl,
  type ResourceCategory,
  type ResourceLink,
} from '@/hooks/useResourceLinks';

const CATEGORY_META: Record<ResourceCategory, { label: string; icon: React.ElementType; color: string }> = {
  template: { label: 'Template', icon: FileText, color: 'bg-primary/10 text-primary' },
  framework: { label: 'Framework', icon: Target, color: 'bg-status-yellow/10 text-status-yellow' },
  playbook: { label: 'Playbook', icon: BookOpen, color: 'bg-status-green/10 text-status-green' },
  reference: { label: 'Reference', icon: FolderOpen, color: 'bg-accent text-accent-foreground' },
  other: { label: 'Other', icon: File, color: 'bg-muted text-muted-foreground' },
};

const DOC_TYPE_ICONS: Record<string, React.ElementType> = {
  'google-doc': FileText,
  'google-sheet': FileSpreadsheet,
  'google-slides': Presentation,
  'google-form': Sheet,
  'google-drive': FolderOpen,
  'notion': BookOpen,
  'figma': Pencil,
};

interface ResourceLinksPanelProps {
  recordType: 'account' | 'opportunity' | 'renewal';
  recordId?: string;
  parentAccountId?: string;
  compact?: boolean;
}

export function ResourceLinksPanel({ recordType, recordId, parentAccountId, compact }: ResourceLinksPanelProps) {
  const { data: links = [], isLoading } = useResourceLinksForRecord(recordType, recordId, parentAccountId);
  const addMutation = useAddResourceLink();
  const updateMutation = useUpdateResourceLink();
  const deleteMutation = useDeleteResourceLink();

  const [showAdd, setShowAdd] = useState(false);
  const [editingLink, setEditingLink] = useState<ResourceLink | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Form state
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<ResourceCategory>('template');
  const [notes, setNotes] = useState('');
  const [urlError, setUrlError] = useState('');

  // Auto-detect URL metadata
  useEffect(() => {
    if (!url.trim()) { setUrlError(''); return; }
    if (!isValidUrl(url.trim())) {
      setUrlError('Enter a valid URL starting with https://');
      return;
    }
    setUrlError('');
    // Only auto-fill if label is empty (user hasn't typed anything)
    if (!label.trim() && !editingLink) {
      const meta = detectUrlMeta(url.trim());
      setLabel(meta.suggestedLabel);
      setCategory(meta.suggestedCategory);
    }
  }, [url]);

  const resetForm = () => { setUrl(''); setLabel(''); setCategory('template'); setNotes(''); setUrlError(''); setEditingLink(null); };

  const openEdit = (link: ResourceLink) => {
    setEditingLink(link);
    setUrl(link.url);
    setLabel(link.label);
    setCategory(link.category as ResourceCategory);
    setNotes(link.notes || '');
    setShowAdd(true);
  };

  const handleSave = () => {
    if (!url.trim() || !isValidUrl(url.trim())) { toast.error('Please enter a valid URL'); return; }

    const finalLabel = label.trim() || detectUrlMeta(url.trim()).suggestedLabel;

    if (editingLink) {
      updateMutation.mutate({
        id: editingLink.id,
        url: url.trim(),
        label: finalLabel,
        category,
        notes: notes.trim() || null,
      }, {
        onSuccess: () => { toast.success('Link updated'); resetForm(); setShowAdd(false); },
        onError: () => toast.error('Failed to update'),
      });
    } else {
      const linkData: any = {
        url: url.trim(),
        label: finalLabel,
        category,
        notes: notes.trim() || null,
        account_id: recordType === 'account' ? recordId : null,
        opportunity_id: recordType === 'opportunity' ? recordId : null,
        renewal_id: recordType === 'renewal' ? recordId : null,
      };
      addMutation.mutate(linkData, {
        onSuccess: () => { toast.success('Link saved'); resetForm(); setShowAdd(false); },
        onError: () => toast.error('Failed to save link'),
      });
    }
  };

  const handleCopy = (linkUrl: string) => {
    navigator.clipboard.writeText(linkUrl);
    toast.success('Link copied to clipboard');
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, {
      onSuccess: () => { toast.success('Link removed'); setDeleteTarget(null); },
    });
  };

  if (!recordId) return null;

  const directLinks = links.filter((l: any) => !l._inherited);
  const inheritedLinks = links.filter((l: any) => l._inherited);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          Resources & Templates
          {links.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">
              {links.length}
            </Badge>
          )}
        </h4>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { resetForm(); setShowAdd(true); }}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : links.length === 0 ? (
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="w-full text-xs text-muted-foreground italic border border-dashed border-border/50 rounded-md py-3 hover:bg-accent/20 transition-colors cursor-pointer"
        >
          + Add Google Drive links to templates, frameworks, or playbooks
        </button>
      ) : (
        <div className="space-y-1">
          {directLinks.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              onCopy={handleCopy}
              onEdit={openEdit}
              onDelete={(id) => setDeleteTarget(id)}
            />
          ))}
          {inheritedLinks.length > 0 && (
            <>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider pt-1">From Account</p>
              {inheritedLinks.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  inherited
                  onCopy={handleCopy}
                  onEdit={openEdit}
                  onDelete={(id) => setDeleteTarget(id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) resetForm(); setShowAdd(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLink ? 'Edit Resource Link' : 'Add Resource Link'}</DialogTitle>
            <DialogDescription>Paste a Google Drive, Notion, or any URL to reference later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">URL</Label>
              <Input
                placeholder="https://docs.google.com/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={cn("mt-1", urlError && "border-destructive")}
                autoFocus
              />
              {urlError && <p className="text-[11px] text-destructive mt-1">{urlError}</p>}
            </div>
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                placeholder="e.g. Discovery Call Template"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as ResourceCategory)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_META).map(([key, meta]) => {
                      const Icon = meta.icon;
                      return (
                        <SelectItem key={key} value={key}>
                          <span className="flex items-center gap-1.5">
                            <Icon className="h-3 w-3" /> {meta.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                placeholder="When to use this resource…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowAdd(false); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={addMutation.isPending || updateMutation.isPending || !!urlError}>
              {(addMutation.isPending || updateMutation.isPending) ? 'Saving…' : editingLink ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this resource link?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the link. You can always re-add it later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Link Row component ---
function LinkRow({ link, inherited, onCopy, onEdit, onDelete }: {
  link: ResourceLink;
  inherited?: boolean;
  onCopy: (url: string) => void;
  onEdit: (link: ResourceLink) => void;
  onDelete: (id: string) => void;
}) {
  const meta = CATEGORY_META[link.category as ResourceCategory] || CATEGORY_META.other;
  const urlMeta = detectUrlMeta(link.url);
  const DocIcon = DOC_TYPE_ICONS[urlMeta.docType] || meta.icon;

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
        inherited
          ? "border-dashed border-border/40 bg-muted/20"
          : "border-border/50 bg-card/50 hover:bg-accent/30"
      )}
    >
      <DocIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 truncate text-xs font-medium text-foreground hover:underline"
        title={link.notes || link.url}
      >
        {link.label || 'Untitled'}
      </a>
      {link.notes && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-muted-foreground cursor-help">📝</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">{link.notes}</TooltipContent>
        </Tooltip>
      )}
      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 shrink-0', meta.color)}>
        {meta.label}
      </Badge>

      {/* Actions - show on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => onCopy(link.url)} title="Copy link">
          <Copy className="h-3 w-3 text-muted-foreground" />
        </Button>
        {!inherited && (
          <>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => onEdit(link)} title="Edit">
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => onDelete(link.id)} title="Remove">
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </>
        )}
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-5 w-5 items-center justify-center">
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </a>
      </div>
    </div>
  );
}
