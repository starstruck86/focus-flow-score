/**
 * Cluster Review Panel — main cleanup surface for near-duplicate resource clusters.
 * Shows cluster members, similarity scores, best candidates, and bulk resolution.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronDown, ChevronRight, Layers, Crown, Star, Zap,
  Trash2, FileText, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  clusterByContent,
  type ContentCluster,
  generateSmartSnippet,
  routeByContent,
} from '@/lib/contentSignature';

interface ClusterReviewPanelProps {
  resources: Array<{ id: string; title: string; content: string }>;
  onResolved?: () => void;
}

export function ClusterReviewPanel({ resources, onResolved }: ClusterReviewPanelProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(true);
  const [resolvedClusters, setResolvedClusters] = useState<Set<string>>(new Set());

  const clusters = useMemo(() => {
    if (resources.length < 2) return [];
    return clusterByContent(resources, 0.5);
  }, [resources]);

  const activeClusters = useMemo(() =>
    clusters.filter(c => !resolvedClusters.has(c.id)),
    [clusters, resolvedClusters]
  );

  const handleResolveCluster = useCallback((clusterId: string) => {
    setResolvedClusters(prev => new Set(prev).add(clusterId));
    onResolved?.();
  }, [onResolved]);

  const handlePromoteBest = useCallback(async (
    cluster: ContentCluster,
    role: 'template' | 'example' | 'tactic',
    candidateId: string,
  ) => {
    if (!user) return;
    const member = cluster.members.find(m => m.id === candidateId);
    if (!member) return;

    const route = routeByContent(member.content)[0];
    const snippet = member.content.slice(0, 5000);

    if (role === 'template') {
      await supabase.from('execution_templates' as any).insert({
        user_id: user.id,
        title: member.title,
        body: snippet,
        template_type: 'email',
        output_type: 'custom',
        template_origin: 'promoted_from_cluster',
        source_resource_id: member.id,
        status: 'active',
        created_by_user: false,
        tags: [],
      } as any);
      toast.success(`Promoted "${member.title}" as template`);
    } else if (role === 'example') {
      await supabase.from('execution_outputs').insert({
        user_id: user.id,
        title: member.title,
        content: snippet,
        output_type: 'custom',
        is_strong_example: true,
      });
      toast.success(`Promoted "${member.title}" as example`);
    }

    // Mark other members as reference
    const otherIds = cluster.members
      .filter(m => m.id !== candidateId)
      .map(m => m.id);

    if (otherIds.length > 0) {
      await supabase.from('resources')
        .update({ content_classification: 'reference' } as any)
        .in('id', otherIds);
    }

    handleResolveCluster(cluster.id);
  }, [user, handleResolveCluster]);

  const handleDismissCluster = useCallback(async (cluster: ContentCluster) => {
    const ids = cluster.members.map(m => m.id);
    await supabase.from('resources')
      .update({ content_classification: 'reference' } as any)
      .in('id', ids);
    handleResolveCluster(cluster.id);
    toast.success(`Cluster resolved — ${ids.length} resources marked as reference`);
  }, [handleResolveCluster]);

  if (activeClusters.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-primary/20 rounded-lg bg-primary/5">
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-primary/10 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-primary" />}
        <Layers className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">Content Clusters</span>
        <Badge variant="outline" className="text-[10px] ml-auto bg-primary/15 text-primary border-primary/30">
          {activeClusters.length} clusters · {activeClusters.reduce((s, c) => s + c.members.length, 0)} resources
        </Badge>
      </CollapsibleTrigger>

      <CollapsibleContent className="px-3 pb-3 space-y-3">
        <p className="text-[10px] text-muted-foreground">
          Near-duplicate resources grouped by content similarity. Promote the best candidate and resolve the rest.
        </p>

        {activeClusters.map(cluster => (
          <div key={cluster.id} className="rounded-md border border-border bg-card p-2.5 space-y-2">
            {/* Cluster header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {cluster.members.length} members
                </Badge>
                {cluster.bestTemplate && (
                  <Badge variant="outline" className="text-[10px] border-primary/30 bg-primary/10">
                    <Crown className="h-2.5 w-2.5 mr-1" /> Best Template: {Math.round(cluster.bestTemplate.score * 100)}%
                  </Badge>
                )}
                {cluster.bestExample && (
                  <Badge variant="outline" className="text-[10px] border-status-green/30 bg-status-green/10">
                    <Star className="h-2.5 w-2.5 mr-1" /> Best Example: {Math.round(cluster.bestExample.score * 100)}%
                  </Badge>
                )}
                {cluster.bestTactic && (
                  <Badge variant="outline" className="text-[10px] border-status-yellow/30 bg-status-yellow/10">
                    <Zap className="h-2.5 w-2.5 mr-1" /> Best Tactic: {Math.round(cluster.bestTactic.score * 100)}%
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] gap-1 text-muted-foreground"
                onClick={() => handleDismissCluster(cluster)}
              >
                <Trash2 className="h-3 w-3" /> All Reference
              </Button>
            </div>

            {/* Members */}
            <div className="space-y-1">
              {cluster.members.map(member => {
                const route = routeByContent(member.content)[0];
                const snippet = generateSmartSnippet(member.content, route, 150);
                const isBestTpl = cluster.bestTemplate?.id === member.id;
                const isBestEx = cluster.bestExample?.id === member.id;
                const isBestTac = cluster.bestTactic?.id === member.id;

                return (
                  <div
                    key={member.id}
                    className={cn(
                      'p-2 rounded border text-xs',
                      (isBestTpl || isBestEx || isBestTac)
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-border bg-muted/30'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-foreground truncate">{member.title}</span>
                          <Badge variant="outline" className="text-[9px]">{route}</Badge>
                          {member.similarity < 1 && (
                            <Badge variant="outline" className="text-[9px] text-muted-foreground">
                              {Math.round(member.similarity * 100)}% sim
                            </Badge>
                          )}
                          {isBestTpl && <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30">★ Template</Badge>}
                          {isBestEx && <Badge className="text-[9px] bg-status-green/20 text-status-green border-status-green/30">★ Example</Badge>}
                          {isBestTac && <Badge className="text-[9px] bg-status-yellow/20 text-status-yellow border-status-yellow/30">★ Tactic</Badge>}
                        </div>
                        {snippet && (
                          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 italic border-l-2 border-border pl-2">
                            {snippet}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {isBestTpl && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1"
                            onClick={() => handlePromoteBest(cluster, 'template', member.id)}
                          >
                            <Crown className="h-3 w-3" /> Promote
                          </Button>
                        )}
                        {isBestEx && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1"
                            onClick={() => handlePromoteBest(cluster, 'example', member.id)}
                          >
                            <Star className="h-3 w-3" /> Promote
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
