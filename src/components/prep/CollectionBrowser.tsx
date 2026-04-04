/**
 * CollectionBrowser — Browse explicit collections and implicit parent groups.
 * Clean separation: explicit collections (DB), implicit parents (title patterns), tags (metadata).
 * Each shows health rollups.
 */
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  FolderOpen, Plus, ChevronRight, CheckCircle2,
  AlertTriangle, TrendingUp, FolderTree, Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useCollections, useCreateCollection, type ResourceCollection } from '@/hooks/useCollections';
import { deriveReadiness } from '@/lib/resourceSignal';
import type { Resource } from '@/hooks/useResources';

interface HealthRollup {
  total: number;
  ready: number;
  improving: number;
  blocked: number;
  needsAttention: number;
}

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  onFilterByCollection: (collectionId: string | null) => void;
  activeCollectionId: string | null;
}

function computeRollup(
  matchingResources: Resource[],
  lifecycleMap: Map<string, any>,
): HealthRollup {
  const stats: HealthRollup = { total: matchingResources.length, ready: 0, improving: 0, blocked: 0, needsAttention: 0 };
  for (const r of matchingResources) {
    const lc = lifecycleMap.get(r.id);
    const { readiness } = deriveReadiness(lc, r);
    if (readiness === 'ready') stats.ready++;
    else if (readiness === 'improving') stats.improving++;
    else { stats.blocked++; stats.needsAttention++; }
    if (r.enrichment_status === 'failed') stats.needsAttention++;
  }
  return stats;
}

function RollupPills({ stats }: { stats: HealthRollup }) {
  if (stats.total === 0) return <span className="text-[9px] text-muted-foreground">0</span>;
  return (
    <div className="flex items-center gap-1 shrink-0">
      {stats.ready > 0 && (
        <span className="text-[9px] text-emerald-600 font-medium">{stats.ready}<CheckCircle2 className="inline h-2.5 w-2.5 ml-0.5" /></span>
      )}
      {stats.improving > 0 && (
        <span className="text-[9px] text-amber-600 font-medium">{stats.improving}<TrendingUp className="inline h-2.5 w-2.5 ml-0.5" /></span>
      )}
      {stats.blocked > 0 && (
        <span className="text-[9px] text-destructive font-medium">{stats.blocked}<AlertTriangle className="inline h-2.5 w-2.5 ml-0.5" /></span>
      )}
      <span className="text-[9px] text-muted-foreground">{stats.total}</span>
    </div>
  );
}

export function CollectionBrowser({ resources, lifecycleMap, onFilterByCollection, activeCollectionId }: Props) {
  const { data: collections = [] } = useCollections();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const createCollection = useCreateCollection();

  // Explicit collection rollups — match by title prefix or collection name in tags
  const collectionRollups = useMemo(() => {
    const rollups = new Map<string, HealthRollup>();
    for (const col of collections) {
      const matching = resources.filter(r => {
        const tags = (r as any).tags as string[] | null;
        if (tags?.includes(col.name)) return true;
        if (r.title.startsWith(col.name + ' > ')) return true;
        return false;
      });
      rollups.set(col.id, computeRollup(matching, lifecycleMap));
    }
    return rollups;
  }, [collections, resources, lifecycleMap]);

  // Implicit parent groups from "Parent > Child" title pattern
  const implicitGroups = useMemo(() => {
    const parents = new Map<string, Resource[]>();
    for (const r of resources) {
      const idx = r.title.indexOf(' > ');
      if (idx > 0) {
        const parent = r.title.slice(0, idx);
        if (!parents.has(parent)) parents.set(parent, []);
        parents.get(parent)!.push(r);
      }
    }
    const explicitNames = new Set(collections.map(c => c.name));
    return Array.from(parents.entries())
      .filter(([name, items]) => items.length >= 2 && !explicitNames.has(name))
      .map(([name, items]) => ({
        name,
        stats: computeRollup(items, lifecycleMap),
      }))
      .sort((a, b) => b.stats.total - a.stats.total);
  }, [resources, collections, lifecycleMap]);

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

  const hasCollections = collections.length > 0;
  const hasImplicit = implicitGroups.length > 0;

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

      <div className="space-y-0.5">
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

        {/* Explicit Collections section */}
        {hasCollections && (
          <div className="pt-1.5">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold px-2.5 pb-1 flex items-center gap-1">
              <FolderOpen className="h-2.5 w-2.5" /> Collections
            </p>
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
                  {stats && <RollupPills stats={stats} />}
                  <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        )}

        {/* Implicit parent groups section */}
        {hasImplicit && (
          <div className="pt-1.5">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold px-2.5 pb-1 flex items-center gap-1">
              <FolderTree className="h-2.5 w-2.5" /> Parent Groups
            </p>
            {implicitGroups.map(({ name, stats }) => (
              <button
                key={name}
                onClick={() => onFilterByCollection(`implicit:${name}`)}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors',
                  activeCollectionId === `implicit:${name}` ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground',
                )}
              >
                <span className="flex-1 text-left truncate">{name}</span>
                <RollupPills stats={stats} />
              </button>
            ))}
          </div>
        )}
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
