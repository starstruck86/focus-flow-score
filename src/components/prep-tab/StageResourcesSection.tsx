/**
 * Keystone & Supporting Resources section for each Prep stage.
 * Renders keystone resources prominently, supporting resources below,
 * and a lightweight "Manage Resources" dialog.
 */
import { useState } from 'react';
import { useStageResources, type StageResource } from '@/hooks/useStageResources';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Gem, FileText, Plus, Star, StarOff, X, Search, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  stageId: string;
  stageLabel: string;
}

export function StageResourcesSection({ stageId, stageLabel }: Props) {
  const {
    keystoneResources, supportingResources, isLoading,
    addResource, removeResource, toggleKeystone,
  } = useStageResources(stageId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading resources…
      </div>
    );
  }

  const hasAny = keystoneResources.length > 0 || supportingResources.length > 0;

  return (
    <div className="space-y-4">
      {/* ── Keystone Resources ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Gem className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Keystone Resources
            </h3>
          </div>
          <ManageResourcesDialog stageId={stageId} stageLabel={stageLabel} />
        </div>
        <p className="text-[10px] text-muted-foreground -mt-1">
          Your foundational frameworks for this stage
        </p>

        {keystoneResources.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-primary/20 bg-primary/[0.02] p-4 text-center">
            <p className="text-xs text-muted-foreground">
              Select 1–3 Keystone Resources to define your approach for this stage
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {keystoneResources.map(r => (
              <KeystoneCard
                key={r.id}
                resource={r}
                onRemoveKeystone={() => toggleKeystone.mutate({ resourceId: r.resource_id, isKeystone: false })}
                onRemove={() => removeResource.mutate(r.resource_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Supporting Resources ── */}
      {(supportingResources.length > 0 || hasAny) && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Supporting Tactics & Strategy
            </h3>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1">
            Additional plays, optimizations, and variations
          </p>

          {supportingResources.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic py-1">
              No supporting resources yet — add from Manage Resources
            </p>
          ) : (
            <div className="grid gap-1.5">
              {supportingResources.map(r => (
                <SupportingRow
                  key={r.id}
                  resource={r}
                  onPromoteKeystone={() => toggleKeystone.mutate({ resourceId: r.resource_id, isKeystone: true })}
                  onRemove={() => removeResource.mutate(r.resource_id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Keystone card — prominent ─── */
function KeystoneCard({
  resource, onRemoveKeystone, onRemove,
}: { resource: StageResource; onRemoveKeystone: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border-2 border-primary/30 bg-primary/[0.04] p-3 relative group">
      <Gem className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-foreground leading-tight line-clamp-1">
          {resource.resource_title}
        </span>
        {resource.resource_type && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 mt-1">
            {resource.resource_type}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onRemoveKeystone}
          title="Move to Supporting"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <StarOff className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRemove}
          title="Remove from stage"
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Supporting row — compact ─── */
function SupportingRow({
  resource, onPromoteKeystone, onRemove,
}: { resource: StageResource; onPromoteKeystone: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 group">
      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-foreground flex-1 min-w-0 truncate">
        {resource.resource_title}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onPromoteKeystone}
          title="Promote to Keystone"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary"
        >
          <Star className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRemove}
          title="Remove from stage"
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Manage Resources dialog ─── */
function ManageResourcesDialog({ stageId, stageLabel }: { stageId: string; stageLabel: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { stageResources, addResource, removeResource, toggleKeystone } = useStageResources(stageId);
  const associatedIds = new Set(stageResources.map(r => r.resource_id));

  const { data: allResources = [], isLoading } = useQuery({
    queryKey: ['all-resources-for-stage', user?.id, search],
    enabled: !!user && open,
    queryFn: async () => {
      let q = supabase
        .from('resources')
        .select('id, title, source_type, content_type')
        .eq('user_id', user!.id)
        .order('title')
        .limit(50);
      if (search.trim()) {
        q = q.ilike('title', `%${search.trim()}%`);
      }
      const { data } = await q;
      return data || [];
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground">
          <Plus className="h-3 w-3" /> Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Resources — {stageLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search resources…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        <ScrollArea className="max-h-[340px]">
          <div className="space-y-1 pr-2">
            {isLoading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && allResources.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No resources found</p>
            )}
            {allResources.map(r => {
              const isAssociated = associatedIds.has(r.id);
              const stageRes = stageResources.find(sr => sr.resource_id === r.id);
              const isKS = stageRes?.is_keystone || false;

              return (
                <div
                  key={r.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors',
                    isAssociated
                      ? 'bg-primary/5 border border-primary/20'
                      : 'hover:bg-accent/40'
                  )}
                >
                  <span className="flex-1 min-w-0 truncate text-foreground">
                    {r.title || 'Untitled'}
                  </span>
                  {r.content_type && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0">
                      {r.content_type}
                    </Badge>
                  )}

                  {isAssociated ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleKeystone.mutate({ resourceId: r.id, isKeystone: !isKS })}
                        title={isKS ? 'Remove Keystone' : 'Make Keystone'}
                        className={cn(
                          'p-1 rounded transition-colors',
                          isKS ? 'text-primary hover:text-primary/70' : 'text-muted-foreground hover:text-primary'
                        )}
                      >
                        {isKS ? <Star className="h-3.5 w-3.5 fill-primary" /> : <Star className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => removeResource.mutate(r.id)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2 shrink-0"
                      onClick={() => addResource.mutate(r.id)}
                    >
                      <Plus className="h-3 w-3 mr-0.5" /> Add
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
