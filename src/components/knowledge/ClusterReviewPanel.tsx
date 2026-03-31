/**
 * Cluster Review Panel — cluster-first cleanup surface.
 * Shows canonical winner, role recommendation, reasoning, demotions.
 * Clusters are the default cleanup workflow for duplicate-heavy backlogs.
 */

import { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronDown, ChevronRight, Layers, Crown, Star, Zap,
  Trash2, FileText, Check, ArrowDown, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  clusterByContent,
  resolveCluster,
  type ContentCluster,
  type ClusterResolution,
  type ContentRoute,
  generateSmartSnippet,
  routeByContent,
} from '@/lib/contentSignature';
import { TransformationPreviewDialog } from './TransformationPreviewDialog';

interface ClusterReviewPanelProps {
  resources: Array<{ id: string; title: string; content: string }>;
  onResolved?: () => void;
}

export function ClusterReviewPanel({ resources, onResolved }: ClusterReviewPanelProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(true);
  const [resolvedClusters, setResolvedClusters] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<ClusterResolution[]>([]);
  const [transformPreview, setTransformPreview] = useState<{
    cluster: ContentCluster;
    candidateId: string;
    role: 'template' | 'example';
    content: string;
    title: string;
  } | null>(null);

  const clusters = useMemo(() => {
    if (resources.length < 2) return [];
    return clusterByContent(resources, 0.5);
  }, [resources]);

  const activeClusters = useMemo(() =>
    clusters.filter(c => !resolvedClusters.has(c.id)),
    [clusters, resolvedClusters]
  );

  const markResolved = useCallback((clusterId: string, resolution?: ClusterResolution) => {
    setResolvedClusters(prev => new Set(prev).add(clusterId));
    if (resolution) setResolutions(prev => [...prev, resolution]);
    onResolved?.();
  }, [onResolved]);

  const handlePromoteCanonical = useCallback(async (
    cluster: ContentCluster,
    role: 'template' | 'example',
    candidateId: string,
  ) => {
    const member = cluster.members.find(m => m.id === candidateId);
    if (!member || !user) return;

    // Show transformation preview
    setTransformPreview({
      cluster,
      candidateId,
      role,
      content: member.content,
      title: member.title,
    });
  }, [user]);

  const handleConfirmTransformation = useCallback(async (shapedContent: string) => {
    if (!user || !transformPreview) return;
    const { cluster, candidateId, role } = transformPreview;
    const member = cluster.members.find(m => m.id === candidateId);
    if (!member) return;

    let assetId: string | undefined;

    if (role === 'template') {
      const { data } = await supabase.from('execution_templates' as any).insert({
        user_id: user.id,
        title: member.title,
        body: shapedContent.slice(0, 5000),
        template_type: 'email',
        output_type: 'custom',
        template_origin: 'promoted_from_cluster',
        source_resource_id: member.id,
        status: 'active',
        created_by_user: false,
        tags: [],
      } as any).select('id').single();
      assetId = (data as any)?.id;
    } else {
      const { data } = await supabase.from('execution_outputs').insert({
        user_id: user.id,
        title: member.title,
        content: shapedContent.slice(0, 5000),
        output_type: 'custom',
        is_strong_example: true,
      }).select('id').single();
      assetId = data?.id;
    }

    // Persist provenance
    const transformResult = role === 'template'
      ? (await import('@/lib/contentSignature')).shapeAsTemplate(member.content)
      : (await import('@/lib/contentSignature')).shapeAsExample(member.content);

    await supabase.from('asset_provenance').insert({
      user_id: user.id,
      asset_type: role,
      asset_id: assetId || 'unknown',
      source_resource_id: member.id,
      source_segment_index: null,
      source_char_range: null,
      source_heading: null,
      transformed_content: shapedContent,
      removed_lines: transformResult.removedLines,
      high_risk_removals: transformResult.highRiskRemovals,
      original_content: member.content,
    } as any);

    // Mark non-canonical members as reference
    const otherIds = cluster.members.filter(m => m.id !== candidateId).map(m => m.id);
    if (otherIds.length > 0) {
      await supabase.from('resources')
        .update({ content_classification: 'reference' } as any)
        .in('id', otherIds);
    }

    // Persist cluster resolution
    const resolution = resolveCluster(
      cluster, candidateId, role,
      `Promoted as ${role}. ${cluster.members.length - 1} duplicates demoted to reference.`
    );

    await supabase.from('cluster_resolutions').insert({
      user_id: user.id,
      cluster_id: cluster.id,
      canonical_resource_id: candidateId,
      canonical_role: role,
      reasoning: resolution.reasoning,
      demoted_members: resolution.demotedMembers,
      resolved_by: user.id,
    } as any);

    markResolved(cluster.id, resolution);
    setTransformPreview(null);
    toast.success(`Cluster resolved: "${member.title}" promoted as ${role}`);
  }, [user, transformPreview, markResolved]);

  const handleDismissCluster = useCallback(async (cluster: ContentCluster) => {
    if (!user) return;
    const ids = cluster.members.map(m => m.id);
    await supabase.from('resources')
      .update({ content_classification: 'reference' } as any)
      .in('id', ids);
    const resolution = resolveCluster(
      cluster, ids[0], 'reference',
      `All ${ids.length} members marked as reference.`
    );

    // Persist cluster resolution
    await supabase.from('cluster_resolutions').insert({
      user_id: user.id,
      cluster_id: cluster.id,
      canonical_resource_id: ids[0],
      canonical_role: 'reference',
      reasoning: resolution.reasoning,
      demoted_members: resolution.demotedMembers,
      resolved_by: user.id,
    } as any);

    markResolved(cluster.id, resolution);
    toast.success(`Cluster resolved — ${ids.length} resources marked as reference`);
  }, [user, markResolved]);

  if (activeClusters.length === 0 && resolutions.length === 0) return null;

  const ROLE_ICON = { template: Crown, example: Star, tactic: Zap, reference: FileText };
  const ROLE_COLOR = {
    template: 'text-primary border-primary/30 bg-primary/10',
    example: 'text-status-green border-status-green/30 bg-status-green/10',
    tactic: 'text-status-yellow border-status-yellow/30 bg-status-yellow/10',
    reference: 'text-muted-foreground border-border bg-muted/30',
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen} className="border border-primary/20 rounded-lg bg-primary/5">
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-primary/10 transition-colors">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-primary" />}
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">Cluster Cleanup</span>
          <Badge variant="outline" className="text-[10px] ml-auto bg-primary/15 text-primary border-primary/30">
            {activeClusters.length} active · {resolutions.length} resolved
          </Badge>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3 space-y-3">
          <p className="text-[10px] text-muted-foreground">
            Resolve clusters instead of individual resources. Promote the canonical winner and demote duplicates.
          </p>

          {activeClusters.map(cluster => {
            const canonicalMember = cluster.members.find(m => m.id === cluster.canonicalId);

            return (
              <div key={cluster.id} className="rounded-md border border-border bg-card p-2.5 space-y-2">
                {/* Cluster header with canonical recommendation */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {cluster.members.length} members
                    </Badge>
                    {cluster.canonicalRole && canonicalMember && (
                      <Badge variant="outline" className={cn('text-[10px]', ROLE_COLOR[cluster.canonicalRole])}>
                        <ShieldCheck className="h-2.5 w-2.5 mr-1" />
                        Recommended: {canonicalMember.title.slice(0, 30)} → {cluster.canonicalRole}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 text-[10px] gap-1 text-muted-foreground"
                    onClick={() => handleDismissCluster(cluster)}
                  >
                    <Trash2 className="h-3 w-3" /> All Reference
                  </Button>
                </div>

                {/* Canonical reasoning */}
                {cluster.canonicalReasoning && (
                  <p className="text-[10px] text-muted-foreground italic border-l-2 border-primary/30 pl-2">
                    Why: {cluster.canonicalReasoning}
                  </p>
                )}

                {/* Candidate scores */}
                <div className="flex gap-2 flex-wrap">
                  {cluster.bestTemplate && (
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className={cn('text-[10px]', ROLE_COLOR.template)}>
                        <Crown className="h-2.5 w-2.5 mr-1" /> Template: {Math.round(cluster.bestTemplate.score * 100)}%
                      </Badge>
                      <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5"
                        onClick={() => handlePromoteCanonical(cluster, 'template', cluster.bestTemplate!.id)}>
                        Promote
                      </Button>
                    </div>
                  )}
                  {cluster.bestExample && (
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className={cn('text-[10px]', ROLE_COLOR.example)}>
                        <Star className="h-2.5 w-2.5 mr-1" /> Example: {Math.round(cluster.bestExample.score * 100)}%
                      </Badge>
                      <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5"
                        onClick={() => handlePromoteCanonical(cluster, 'example', cluster.bestExample!.id)}>
                        Promote
                      </Button>
                    </div>
                  )}
                  {cluster.bestTactic && (
                    <Badge variant="outline" className={cn('text-[10px]', ROLE_COLOR.tactic)}>
                      <Zap className="h-2.5 w-2.5 mr-1" /> Tactic: {Math.round(cluster.bestTactic.score * 100)}%
                    </Badge>
                  )}
                </div>

                {/* Members */}
                <div className="space-y-1">
                  {cluster.members.map(member => {
                    const route = routeByContent(member.content)[0];
                    const snippet = generateSmartSnippet(member.content, route, 150);
                    const isCanonical = member.id === cluster.canonicalId;
                    const RoleIcon = ROLE_ICON[route] || FileText;

                    return (
                      <div
                        key={member.id}
                        className={cn(
                          'p-2 rounded border text-xs',
                          isCanonical
                            ? 'border-primary/30 bg-primary/5'
                            : 'border-border bg-muted/30'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isCanonical && <ShieldCheck className="h-3 w-3 text-primary" />}
                              <span className="font-medium text-foreground truncate">{member.title}</span>
                              <Badge variant="outline" className="text-[9px]">
                                <RoleIcon className="h-2 w-2 mr-0.5" />{route}
                              </Badge>
                              {member.similarity < 1 && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                  {Math.round(member.similarity * 100)}% sim
                                </Badge>
                              )}
                              {!isCanonical && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                  <ArrowDown className="h-2 w-2 mr-0.5" /> demoted
                                </Badge>
                              )}
                            </div>
                            {snippet && (
                              <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 italic border-l-2 border-border pl-2">
                                {snippet}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Resolved clusters summary */}
          {resolutions.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Check className="h-3 w-3" /> Resolved ({resolutions.length})
              </p>
              <div className="space-y-1">
                {resolutions.map(r => (
                  <div key={r.clusterId} className="text-[10px] text-muted-foreground flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">{r.canonicalRole}</Badge>
                    <span>{r.reasoning}</span>
                    <Badge variant="outline" className="text-[9px]">{r.demotedMembers.length} demoted</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Transformation preview for cluster promotion */}
      {transformPreview && (
        <TransformationPreviewDialog
          open
          onOpenChange={(open) => { if (!open) setTransformPreview(null); }}
          originalContent={transformPreview.content}
          title={transformPreview.title}
          type={transformPreview.role}
          onConfirm={handleConfirmTransformation}
        />
      )}
    </>
  );
}
