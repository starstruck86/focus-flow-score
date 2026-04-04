/**
 * CollectionBrowser — Browse and manage resource collections.
 * Shows collection list with rollup stats, and collection detail view.
 */
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  FolderOpen, Plus, ChevronRight, CheckCircle2,
  AlertTriangle, TrendingUp, Trash2, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useCollections, useCollectionMembers, useCreateCollection, useDeleteCollection, type ResourceCollection } from '@/hooks/useCollections';
import { deriveReadiness } from '@/lib/resourceSignal';
import type { Resource } from '@/hooks/useResources';

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  onFilterByCollection: (collectionId: string | null) => void;
  activeCollectionId: string | null;
}

export function CollectionBrowser({ resources, lifecycleMap, onFilterByCollection, activeCollectionId }: Props) {
  const { data: collections = [] } = useCollections();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const createCollection = useCreateCollection();
  const deleteCollection = useDeleteCollection();

  // Compute rollups per collection using parent title matching
  const collectionRollups = useMemo(() => {
    const rollups = new Map<string, { total: number; ready: number; improving: number; blocked: number; needsAttention: number }>();
    
    for (const col of collections) {
      const matching = resources.filter(r => {
        // Match by tag or by title prefix
        const tags = (r as any).tags as string[] | null;
        if (tags?.includes(col.name)) return true;
        if (r.title.startsWith(col.name + ' > ')) return true;
        return false;
      });

      const stats = { total: matching.length, ready: 0, improving: 0, blocked: 0, needsAttention: 0 };
      for (const r of matching) {
        const lc = lifecycleMap.get(r.id);
        const { readiness } = deriveReadiness(lc, r);
        if (readiness === 'ready') stats.ready++;
        else if (readiness === 'improving') stats.improving++;
        else { stats.blocked++; stats.needsAttention++; }
        if (r.enrichment_status === 'failed') stats.needsAttention++;
      }
      rollups.set(col.id, stats);
    }
    return rollups;
  }, [collections, resources, lifecycleMap]);

  // Also detect implicit collections from title prefixes (Course > Lesson pattern)
  const implicitCollections = useMemo(() => {
    const parents = new Map<string, number>();
    for (const r of resources) {
      const idx = r.title.indexOf(' > ');
      if (idx > 0) {
        const parent = r.title.slice(0, idx);
        parents.set(parent, (parents.get(parent) ?? 0) + 1);
      }
    }
    // Only show implicit groups with 2+ children that aren't already in explicit collections
    const explicitNames = new Set(collections.map(c => c.name));
    return Array.from(parents.entries())
      .filter(([name, count]) => count >= 2 && !explicitNames.has(name))
      .sort((a, b) => b[1] - a[1]);
  }, [resources, collections]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createCollection.mutateAsync({ name: newName.trim() });
      toast.success(`Collection "${newName.trim()}" created`);
      setNewName('');
      setShowCreate(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <FolderOpen className="h-3.5 w-3.5" />
          Collections
        </h4>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New
        </Button>
      </div>

      <div className="space-y-1">
        {/* All Resources */}
        <button
          onClick={() => onFilterByCollection(null)}
          className={cn(
            'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors',
            !activeCollectionId ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground',
          )}
        >
          <span className="flex-1 text-left">All Resources</span>
          <span className="text-muted-foreground">{resources.length}</span>
        </button>

        {/* Explicit collections */}
        {collections.map(col => {
          const stats = collectionRollups.get(col.id);
          return (
            <button
              key={col.id}
              onClick={() => onFilterByCollection(col.id)}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors group',
                activeCollectionId === col.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground',
              )}
            >
              <span className="flex-1 text-left truncate">{col.name}</span>
              {stats && (
                <div className="flex items-center gap-1 shrink-0">
                  {stats.ready > 0 && <span className="text-[9px] text-emerald-600">{stats.ready}✓</span>}
                  {stats.blocked > 0 && <span className="text-[9px] text-destructive">{stats.blocked}!</span>}
                  <span className="text-[9px] text-muted-foreground">{stats.total}</span>
                </div>
              )}
              <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          );
        })}

        {/* Implicit parent groups */}
        {implicitCollections.map(([name, count]) => (
          <button
            key={name}
            onClick={() => onFilterByCollection(`implicit:${name}`)}
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors',
              activeCollectionId === `implicit:${name}` ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground',
            )}
          >
            <span className="flex-1 text-left truncate">{name}</span>
            <Badge variant="outline" className="text-[8px] h-4">{count} items</Badge>
          </button>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Collection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Collection name"
              className="text-sm"
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
