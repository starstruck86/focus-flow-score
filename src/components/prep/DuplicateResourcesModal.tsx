import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Check, Trash2, Link2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResourceDuplicates, type ResourceDuplicateGroup } from '@/hooks/useResourceDuplicates';
import { useDeleteResource } from '@/hooks/useResources';

function DuplicateGroup({ group }: { group: ResourceDuplicateGroup }) {
  const [keepId, setKeepId] = useState(group.items[0].id);
  const deleteResource = useDeleteResource();

  const handleDeleteDuplicates = () => {
    group.items.filter(i => i.id !== keepId).forEach(i => deleteResource.mutate(i.id));
  };

  return (
    <div className="border border-status-yellow/30 bg-status-yellow/5 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-status-yellow" />
          <span className="text-xs font-medium">{group.items.length} duplicates</span>
          <Badge variant="outline" className="text-[10px]">{group.matchType === 'url' ? 'Same URL' : 'Similar title'}</Badge>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleDeleteDuplicates}
          disabled={deleteResource.isPending}>
          <Trash2 className="h-3 w-3" /> Remove duplicates
        </Button>
      </div>
      {group.items.map(item => (
        <label key={item.id}
          className={cn(
            "flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors",
            keepId === item.id ? "border-primary bg-primary/5" : "border-border/50 hover:border-border"
          )}
        >
          <input type="radio" name={group.key} checked={keepId === item.id}
            onChange={() => setKeepId(item.id)} className="accent-[hsl(var(--primary))]" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium truncate block">{item.title}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground capitalize">{item.resource_type}</span>
              <span className="text-[10px] text-muted-foreground">{new Date(item.updated_at).toLocaleDateString()}</span>
              {item.file_url?.startsWith('http') && <Link2 className="h-2.5 w-2.5 text-muted-foreground" />}
            </div>
          </div>
          {keepId === item.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
        </label>
      ))}
    </div>
  );
}

export function DuplicateResourcesModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { groups } = useResourceDuplicates();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Find Duplicates
            {groups.length > 0 && <Badge variant="destructive" className="text-[10px]">{groups.length}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {groups.length === 0 ? (
          <div className="text-center py-8">
            <Check className="h-8 w-8 text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No duplicates found — your library is clean!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map(g => <DuplicateGroup key={g.key} group={g} />)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
