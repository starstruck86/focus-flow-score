import { useState } from 'react';
import { ExternalLink, Plus, Trash2, FileText, BookOpen, Target, FolderOpen, File } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useResourceLinksForRecord,
  useAddResourceLink,
  useDeleteResourceLink,
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

interface ResourceLinksPanelProps {
  recordType: 'account' | 'opportunity' | 'renewal';
  recordId?: string;
  compact?: boolean;
}

export function ResourceLinksPanel({ recordType, recordId, compact }: ResourceLinksPanelProps) {
  const { data: links = [], isLoading } = useResourceLinksForRecord(recordType, recordId);
  const addMutation = useAddResourceLink();
  const deleteMutation = useDeleteResourceLink();
  const [showAdd, setShowAdd] = useState(false);

  // Add form state
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<ResourceCategory>('template');
  const [notes, setNotes] = useState('');

  const resetForm = () => { setUrl(''); setLabel(''); setCategory('template'); setNotes(''); };

  const handleAdd = () => {
    if (!url.trim()) { toast.error('URL is required'); return; }
    const linkData: any = {
      url: url.trim(),
      label: label.trim() || extractLabelFromUrl(url),
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
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success('Link removed'),
    });
  };

  if (!recordId) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          Resources & Templates
        </h4>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setShowAdd(true)}>
          <Plus className="h-3 w-3" /> Add Link
        </Button>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : links.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No resources linked yet. Add Google Drive links to templates, frameworks, or playbooks.</p>
      ) : (
        <div className="space-y-1.5">
          {links.map((link) => {
            const meta = CATEGORY_META[link.category as ResourceCategory] || CATEGORY_META.other;
            const Icon = meta.icon;
            return (
              <div
                key={link.id}
                className="group flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-2.5 py-1.5 hover:bg-accent/30 transition-colors"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-xs font-medium text-foreground hover:underline"
                  title={link.notes || link.url}
                >
                  {link.label || 'Untitled'}
                </a>
                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', meta.color)}>
                  {meta.label}
                </Badge>
                <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                  onClick={() => handleDelete(link.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Link Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Resource Link</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">URL (Google Drive, Notion, etc.)</Label>
              <Input
                placeholder="https://docs.google.com/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-1"
              />
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
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ResourceCategory)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_META).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button onClick={handleAdd} disabled={addMutation.isPending}>
              {addMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function extractLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes('google.com')) return 'Google Drive Link';
    if (u.hostname.includes('notion')) return 'Notion Link';
    return u.hostname.replace('www.', '');
  } catch {
    return 'Link';
  }
}
