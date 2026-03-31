/**
 * Resource Failure Review Queue — shows resource-level pipeline failures
 * with root causes, remediation paths, and quick actions.
 * 
 * Features:
 * - Content preview snippet per row
 * - Dedup check before promotion
 * - Persisted resolutions (survive refresh)
 * - Reversible resolutions (reopen dismissed/promoted/referenced)
 * - Resolution history
 * - Differentiated Retry vs Strict Retry
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  ChevronDown, ChevronRight, AlertOctagon, RotateCcw,
  FileText, Trash2, ArrowRight, Filter, Wand2,
  Crown, Star, Undo2, History, AlertTriangle, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

// ── Types ──────────────────────────────────────────────────

export type TerminalState =
  | 'operationalized' | 'operationalized_partial'
  | 'needs_review' | 'reference_supporting' | 'reference_needs_judgment'
  | 'reference_low_leverage' | 'content_missing';

export interface ResourceDiagnosis {
  resource_id: string;
  title: string;
  route: string;
  terminal_state: TerminalState;
  failure_reasons: string[];
  retryable: boolean;
  recommended_fix: string;
  priority: 'high' | 'medium' | 'low';
  human_review_required: boolean;
  assets_created: {
    knowledge_items: number;
    knowledge_activated: number;
    templates: number;
    examples: number;
  };
  trust_failures: string[];
  most_similar_existing?: string;
  content_snippet?: string;
}

interface ResolvedDiagnosis {
  resource_id: string;
  title: string;
  resolution_action: string;
  resolution_notes: string;
  resolved_at: string;
}

interface ResourceFailureQueueProps {
  diagnoses: ResourceDiagnosis[];
  runId?: string | null;
  onRerunResource?: (resourceId: string) => void;
  onRerunStrict?: (resourceId: string) => void;
}

// ── Labels ─────────────────────────────────────────────────

const FAILURE_LABELS: Record<string, string> = {
  missing_content: 'Missing Content',
  extraction_returned_zero: 'No Actions Found',
  extraction_too_generic: 'Too Generic',
  trust_failed_specificity: 'Not Specific',
  trust_failed_actionability: 'Not Actionable',
  trust_failed_distinctness: 'Too Similar',
  trust_failed_use_case_clarity: 'Unclear Use Case',
  trust_failed_phrasing_quality: 'AI-Sounding',
  duplicate_template: 'Duplicate Template',
  duplicate_example: 'Duplicate Example',
  duplicate_knowledge: 'Duplicate Knowledge',
  routed_reference_only: 'Reference Only',
  stale_blocker_state: 'Stale / Stuck',
  malformed_source: 'Bad Source',
  template_incomplete: 'Incomplete Template',
  example_not_strong_enough: 'Weak Example',
  tactic_not_atomic: 'Too Broad',
  extraction_error: 'Extraction Error',
};

const STATE_LABELS: Record<string, string> = {
  operationalized_partial: 'Partial Success',
  needs_review: 'Needs Review',
  reference_supporting: 'Reference — Supporting',
  reference_needs_judgment: 'Reference — Needs Judgment',
  reference_low_leverage: 'Reference — Low Leverage',
  content_missing: 'Missing Content',
};

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-destructive/15 text-destructive border-destructive/30',
  medium: 'bg-status-yellow/15 text-status-yellow border-status-yellow/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const RESOLUTION_LABELS: Record<string, string> = {
  dismissed: 'Dismissed',
  marked_reference: 'Marked Reference',
  promoted_template: 'Promoted Template',
  promoted_example: 'Promoted Example',
  retry_requested: 'Retry Requested',
  strict_retry_requested: 'Strict Retry Requested',
};

type FailureFilter = string;

// ── Persist resolution action ──────────────────────────────

async function persistResolution(
  resourceId: string,
  action: string,
  notes: string,
) {
  const { data: diags } = await supabase
    .from('pipeline_diagnoses')
    .select('id')
    .eq('resource_id', resourceId)
    .eq('resolution_status', 'unresolved')
    .order('created_at', { ascending: false })
    .limit(1);

  if (diags && diags.length > 0) {
    await supabase.from('pipeline_diagnoses').update({
      resolution_status: 'resolved',
      resolution_action: action,
      resolution_notes: notes,
      resolved_at: new Date().toISOString(),
    } as any).eq('id', (diags[0] as any).id);
  }
}

async function reopenResolution(resourceId: string) {
  const { data: diags } = await supabase
    .from('pipeline_diagnoses')
    .select('id')
    .eq('resource_id', resourceId)
    .eq('resolution_status', 'resolved')
    .order('resolved_at', { ascending: false })
    .limit(1);

  if (diags && diags.length > 0) {
    await supabase.from('pipeline_diagnoses').update({
      resolution_status: 'unresolved',
      resolution_action: null,
      resolution_notes: null,
      resolved_at: null,
    } as any).eq('id', (diags[0] as any).id);
  }
}

// ── Content-based dedup & smart snippets ───────────────────

import { contentSimilarity, generateSmartSnippet } from '@/lib/contentSignature';
import { TransformationPreviewDialog } from './TransformationPreviewDialog';

// ── Component ──────────────────────────────────────────────

export function ResourceFailureQueue({ diagnoses, runId, onRerunResource, onRerunStrict }: ResourceFailureQueueProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [filters, setFilters] = useState<Set<FailureFilter>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [resolvedItems, setResolvedItems] = useState<ResolvedDiagnosis[]>([]);
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  const [dupWarning, setDupWarning] = useState<{
    diagnosis: ResourceDiagnosis;
    type: 'template' | 'example';
    similar: { id: string; title: string; content: string; similarity: number }[];
  } | null>(null);
  const [transformPreview, setTransformPreview] = useState<{
    diagnosis: ResourceDiagnosis;
    type: 'template' | 'example';
    originalContent: string;
    resourceData: any;
  } | null>(null);

  // Fetch smart preview snippets (route-aware)
  useEffect(() => {
    const ids = diagnoses.map(d => d.resource_id).filter(id => !snippets[id]);
    if (ids.length === 0) return;
    const fetchSnippets = async () => {
      const { data } = await supabase
        .from('resources')
        .select('id, content, title')
        .in('id', ids.slice(0, 50));
      if (data) {
        const newSnippets: Record<string, string> = {};
        for (const r of data) {
          const content = (r as any).content || '';
          const diag = diagnoses.find(d => d.resource_id === r.id);
          const route = diag?.route?.split(', ')[0] || 'reference';
          newSnippets[r.id] = generateSmartSnippet(content, route, 200);
        }
        setSnippets(prev => ({ ...prev, ...newSnippets }));
      }
    };
    fetchSnippets();
  }, [diagnoses]);

  // Show needs_review, content_missing, and operationalized_partial
  const failedDiagnoses = useMemo(() =>
    diagnoses.filter(d =>
      ['needs_review', 'content_missing', 'operationalized_partial'].includes(d.terminal_state) &&
      !resolved.has(d.resource_id)
    ),
    [diagnoses, resolved]
  );

  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of failedDiagnoses) {
      for (const r of d.failure_reasons) {
        counts[r] = (counts[r] || 0) + 1;
      }
    }
    return counts;
  }, [failedDiagnoses]);

  const filteredDiagnoses = useMemo(() => {
    if (filters.size === 0) return failedDiagnoses;
    return failedDiagnoses.filter(d =>
      d.failure_reasons.some(r => filters.has(r))
    );
  }, [failedDiagnoses, filters]);

  const toggleFilter = useCallback((reason: string) => {
    setFilters(prev => {
      const next = new Set(prev);
      next.has(reason) ? next.delete(reason) : next.add(reason);
      return next;
    });
  }, []);

  // ── Resolution handlers ──────────────────────────────────

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['resources'] });
    qc.invalidateQueries({ queryKey: ['pipeline-diagnoses'] });
  }, [qc]);

  const handleMarkReference = useCallback(async (resourceId: string) => {
    await supabase.from('resources').update({ content_classification: 'reference' } as any).eq('id', resourceId);
    await persistResolution(resourceId, 'marked_reference', 'Marked as reference material');
    setResolved(prev => new Set(prev).add(resourceId));
    invalidateAll();
    toast.success('Marked as reference');
  }, [invalidateAll]);

  const checkDuplicatesBeforePromotion = useCallback(async (
    d: ResourceDiagnosis,
    type: 'template' | 'example',
  ): Promise<boolean> => {
    if (!user) return false;

    // Fetch source resource content for content-based comparison
    const { data: sourceRes } = await supabase
      .from('resources')
      .select('content')
      .eq('id', d.resource_id)
      .single();
    const sourceContent = (sourceRes as any)?.content || '';

    // Fetch existing assets with content for content-based dedup
    const table = type === 'template' ? 'execution_templates' : 'execution_outputs';
    const contentField = type === 'template' ? 'body' : 'content';
    const { data: existing } = await supabase
      .from(table as any)
      .select(`id, title, ${contentField}`)
      .eq('user_id', user.id)
      .limit(200);

    if (!existing || existing.length === 0) return true;

    const similar = (existing as any[])
      .map(e => ({
        id: e.id,
        title: e.title,
        content: (e[contentField] || '').slice(0, 200),
        similarity: contentSimilarity(sourceContent, e[contentField] || ''),
      }))
      .filter(e => e.similarity > 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    if (similar.length > 0) {
      setDupWarning({ diagnosis: d, type, similar });
      return false;
    }
    return true;
  }, [user]);

  const handlePromoteTemplate = useCallback(async (d: ResourceDiagnosis, skipDupCheck = false) => {
    if (!user) return;

    if (!skipDupCheck) {
      const canProceed = await checkDuplicatesBeforePromotion(d, 'template');
      if (!canProceed) return;
    }

    const { data: resource } = await supabase
      .from('resources')
      .select('id, title, content, tags, resource_type')
      .eq('id', d.resource_id)
      .single();

    if (!resource || !resource.content) {
      toast.error('Cannot promote: resource content not found');
      return;
    }

    // Show transformation preview instead of directly inserting
    setTransformPreview({
      diagnosis: d,
      type: 'template',
      originalContent: resource.content as string,
      resourceData: resource,
    });
  }, [user, checkDuplicatesBeforePromotion]);

  const handlePromoteExample = useCallback(async (d: ResourceDiagnosis, skipDupCheck = false) => {
    if (!user) return;

    if (!skipDupCheck) {
      const canProceed = await checkDuplicatesBeforePromotion(d, 'example');
      if (!canProceed) return;
    }

    const { data: resource } = await supabase
      .from('resources')
      .select('id, title, content, tags')
      .eq('id', d.resource_id)
      .single();

    if (!resource || !resource.content) {
      toast.error('Cannot promote: resource content not found');
      return;
    }

    // Show transformation preview instead of directly inserting
    setTransformPreview({
      diagnosis: d,
      type: 'example',
      originalContent: resource.content as string,
      resourceData: resource,
    });
  }, [user, checkDuplicatesBeforePromotion]);

  const handleConfirmTransformation = useCallback(async (shapedContent: string) => {
    if (!user || !transformPreview) return;
    const { diagnosis: d, type, resourceData: resource } = transformPreview;

    let assetId: string | undefined;

    if (type === 'template') {
      const { data } = await supabase.from('execution_templates' as any).insert({
        user_id: user.id,
        title: resource.title,
        body: shapedContent,
        template_type: 'email',
        output_type: 'custom',
        template_origin: 'promoted_from_resource',
        source_resource_id: resource.id,
        status: 'active',
        created_by_user: false,
        tags: (resource as any).tags || [],
      } as any).select('id').single();
      assetId = (data as any)?.id;
      await persistResolution(d.resource_id, 'promoted_template', `Promoted as template from "${resource.title}"`);
      toast.success('Promoted as template');
    } else {
      const { data } = await supabase.from('execution_outputs').insert({
        user_id: user.id,
        title: resource.title,
        content: shapedContent.slice(0, 5000),
        output_type: 'custom',
        is_strong_example: true,
      }).select('id').single();
      assetId = data?.id;
      await persistResolution(d.resource_id, 'promoted_example', `Promoted as example from "${resource.title}"`);
      toast.success('Promoted as example');
    }

    // Persist provenance for audit trail
    const transformResult = type === 'template'
      ? (await import('@/lib/contentSignature')).shapeAsTemplate(resource.content || '')
      : (await import('@/lib/contentSignature')).shapeAsExample(resource.content || '');

    await supabase.from('asset_provenance').insert({
      user_id: user.id,
      asset_type: type,
      asset_id: assetId || 'unknown',
      source_resource_id: resource.id,
      source_segment_index: null,
      source_char_range: null,
      source_heading: null,
      transformed_content: shapedContent,
      removed_lines: transformResult.removedLines,
      high_risk_removals: transformResult.highRiskRemovals,
      original_content: resource.content || '',
    } as any);

    setResolved(prev => new Set(prev).add(d.resource_id));
    setTransformPreview(null);
    invalidateAll();
  }, [user, transformPreview, invalidateAll]);

  const handleDismiss = useCallback(async (resourceId: string) => {
    await persistResolution(resourceId, 'dismissed', 'Dismissed by user');
    setResolved(prev => new Set(prev).add(resourceId));
    invalidateAll();
    toast.success('Dismissed — will not resurface');
  }, [invalidateAll]);

  const handleRetry = useCallback(async (resourceId: string) => {
    await persistResolution(resourceId, 'retry_requested', 'Standard retry requested');
    setResolved(prev => new Set(prev).add(resourceId));
    if (onRerunResource) onRerunResource(resourceId);
  }, [onRerunResource]);

  const handleStrictRetry = useCallback(async (resourceId: string) => {
    await persistResolution(resourceId, 'strict_retry_requested', 'Strict retry: different prompt, chunking, model');
    setResolved(prev => new Set(prev).add(resourceId));
    if (onRerunStrict) onRerunStrict(resourceId);
  }, [onRerunStrict]);

  // ── Resolution history ───────────────────────────────────

  const loadResolutionHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('pipeline_diagnoses')
      .select('resource_id, resolution_action, resolution_notes, resolved_at')
      .eq('user_id', user.id)
      .eq('resolution_status', 'resolved')
      .order('resolved_at', { ascending: false })
      .limit(50);

    if (data) {
      // Fetch resource titles
      const ids = (data as any[]).map(d => d.resource_id);
      const { data: resources } = await supabase
        .from('resources')
        .select('id, title')
        .in('id', ids);
      const titleMap = new Map((resources || []).map((r: any) => [r.id, r.title]));

      setResolvedItems((data as any[]).map(d => ({
        resource_id: d.resource_id,
        title: titleMap.get(d.resource_id) || d.resource_id,
        resolution_action: d.resolution_action,
        resolution_notes: d.resolution_notes || '',
        resolved_at: d.resolved_at,
      })));
    }
    setShowHistory(true);
  }, [user]);

  const handleReopen = useCallback(async (resourceId: string) => {
    await reopenResolution(resourceId);
    setResolved(prev => {
      const next = new Set(prev);
      next.delete(resourceId);
      return next;
    });
    setResolvedItems(prev => prev.filter(i => i.resource_id !== resourceId));
    invalidateAll();
    toast.success('Reopened — resource will appear in queue again');
  }, [invalidateAll]);

  if (failedDiagnoses.length === 0 && resolvedItems.length === 0 && !showHistory) return null;

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen} className="border border-destructive/20 rounded-lg bg-destructive/5">
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-destructive/10 transition-colors">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-destructive" /> : <ChevronRight className="h-3.5 w-3.5 text-destructive" />}
          <AlertOctagon className="h-4 w-4 text-destructive" />
          <span className="text-xs font-semibold text-foreground">Resource Failures — Needs Fix</span>
          <Badge variant="outline" className="text-[10px] ml-auto bg-destructive/15 text-destructive border-destructive/30">
            {filteredDiagnoses.length}{filters.size > 0 ? ` / ${failedDiagnoses.length}` : ''}
          </Badge>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              Actions are persisted. Resolved items can be reopened from history.
            </p>
            <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={loadResolutionHistory}>
              <History className="h-3 w-3" /> History
            </Button>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-1">
            {Object.entries(reasonCounts)
              .sort(([,a], [,b]) => b - a)
              .slice(0, 8)
              .map(([reason, count]) => {
                const isActive = filters.has(reason);
                return (
                  <Button
                    key={reason}
                    size="sm"
                    variant={isActive ? 'default' : 'outline'}
                    className={cn('h-6 text-[10px] gap-1', !isActive && 'opacity-70')}
                    onClick={() => toggleFilter(reason)}
                  >
                    <Filter className="h-2.5 w-2.5" />
                    {FAILURE_LABELS[reason] || reason} ({count})
                  </Button>
                );
              })}
            {filters.size > 0 && (
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground" onClick={() => setFilters(new Set())}>
                Clear
              </Button>
            )}
          </div>

          {/* Resource rows */}
          {filteredDiagnoses.slice(0, 30).map(d => {
            const snippet = snippets[d.resource_id];
            return (
              <div key={d.resource_id} className="p-2.5 rounded-md border border-border bg-card text-xs space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground">{d.title}</span>
                      <Badge variant="outline" className={cn('text-[9px]', PRIORITY_BADGE[d.priority])}>
                        {d.priority}
                      </Badge>
                      {d.terminal_state !== 'needs_review' && (
                        <Badge variant="outline" className="text-[9px]">
                          {STATE_LABELS[d.terminal_state] || d.terminal_state}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[9px]">
                        {d.route || 'unrouted'}
                      </Badge>
                    </div>

                    {/* Content preview snippet */}
                    {snippet && (
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 italic border-l-2 border-border pl-2">
                        {snippet}{snippet.length >= 200 ? '…' : ''}
                      </p>
                    )}

                    {/* Failure reasons */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.failure_reasons.map(r => (
                        <Badge key={r} variant="outline" className="text-[9px] border-destructive/30 bg-destructive/5 text-destructive">
                          {FAILURE_LABELS[r] || r}
                        </Badge>
                      ))}
                    </div>

                    {/* Similar existing */}
                    {d.most_similar_existing && (
                      <p className="text-[10px] text-status-yellow mt-0.5">
                        Similar to: &ldquo;{d.most_similar_existing}&rdquo;
                      </p>
                    )}

                    {/* Assets created (partial success) */}
                    {(d.assets_created.knowledge_items > 0 || d.assets_created.templates > 0 || d.assets_created.examples > 0) && (
                      <p className="text-[10px] text-status-green mt-0.5">
                        Partial: {d.assets_created.knowledge_items > 0 ? `${d.assets_created.knowledge_items} KI (${d.assets_created.knowledge_activated} active)` : ''}
                        {d.assets_created.templates > 0 ? ` · ${d.assets_created.templates} template` : ''}
                        {d.assets_created.examples > 0 ? ` · ${d.assets_created.examples} example` : ''}
                      </p>
                    )}

                    {/* Remediation */}
                    <div className="mt-1.5 p-1.5 rounded bg-muted/50 border border-border">
                      <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                        <ArrowRight className="h-2.5 w-2.5 mt-0.5 shrink-0 text-primary" />
                        <span>{d.recommended_fix.split(' | ')[0]}</span>
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {d.retryable && onRerunResource && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => handleRetry(d.resource_id)} title="Standard retry — same extraction strategy">
                        <RotateCcw className="h-3 w-3" /> Retry
                      </Button>
                    )}
                    {d.retryable && onRerunStrict && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 border-primary/30" onClick={() => handleStrictRetry(d.resource_id)} title="Strict retry — different prompt, chunking, model, higher quality bar">
                        <Wand2 className="h-3 w-3 text-primary" /> Strict
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => handlePromoteTemplate(d)}>
                      <Crown className="h-3 w-3" /> Template
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => handlePromoteExample(d)}>
                      <Star className="h-3 w-3" /> Example
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => handleMarkReference(d.resource_id)}>
                      <FileText className="h-3 w-3" /> Reference
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={() => handleDismiss(d.resource_id)}>
                      <Trash2 className="h-3 w-3" /> Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredDiagnoses.length > 30 && (
            <p className="text-[10px] text-muted-foreground text-center py-1">+ {filteredDiagnoses.length - 30} more</p>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Duplicate warning dialog */}
      {dupWarning && (
        <Dialog open onOpenChange={() => setDupWarning(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-status-yellow" />
                Similar {dupWarning.type === 'template' ? 'Templates' : 'Examples'} Found
              </DialogTitle>
              <DialogDescription className="text-xs">
                Before creating a new {dupWarning.type} from &ldquo;{dupWarning.diagnosis.title}&rdquo;, review these existing assets with similar content:
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {dupWarning.similar.map(s => (
                <div key={s.id} className="p-2 rounded border border-border bg-muted/30 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground truncate flex-1">{s.title}</p>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {Math.round(s.similarity * 100)}% content match
                    </Badge>
                  </div>
                  {s.content && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2 italic border-l-2 border-border pl-2">
                      {s.content}…
                    </p>
                  )}
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setDupWarning(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  const dw = dupWarning;
                  setDupWarning(null);
                  if (dw.type === 'template') {
                    handlePromoteTemplate(dw.diagnosis, true);
                  } else {
                    handlePromoteExample(dw.diagnosis, true);
                  }
                }}
              >
                Create Anyway
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Resolution history dialog */}
      {showHistory && (
        <Dialog open onOpenChange={() => setShowHistory(false)}>
          <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                Resolution History
              </DialogTitle>
              <DialogDescription className="text-xs">
                Previously resolved diagnoses. Reopen any to put it back in the review queue.
              </DialogDescription>
            </DialogHeader>
            {resolvedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No resolved items yet.</p>
            ) : (
              <div className="space-y-1.5">
                {resolvedItems.map(item => (
                  <div key={`${item.resource_id}-${item.resolved_at}`} className="p-2 rounded border border-border bg-card text-xs flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{item.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[9px]">
                          {RESOLUTION_LABELS[item.resolution_action] || item.resolution_action}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(item.resolved_at).toLocaleDateString()}
                        </span>
                      </div>
                      {item.resolution_notes && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{item.resolution_notes}</p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 shrink-0" onClick={() => handleReopen(item.resource_id)}>
                      <Undo2 className="h-3 w-3" /> Reopen
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Transformation preview dialog */}
      {transformPreview && (
        <TransformationPreviewDialog
          open
          onOpenChange={(open) => { if (!open) setTransformPreview(null); }}
          originalContent={transformPreview.originalContent}
          title={transformPreview.resourceData.title}
          type={transformPreview.type}
          onConfirm={handleConfirmTransformation}
        />
      )}
    </>
  );
}
