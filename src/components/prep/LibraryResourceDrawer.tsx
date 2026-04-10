/**
 * LibraryResourceDrawer — Detail sheet for resources.
 * Surfaces: Lifecycle stage, blocked reason, next action, View Content, Fix CTAs.
 * Uses canonical lifecycle for stage display.
 */
import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Eye, FolderTree, Wrench, Edit3, Loader2, Trash2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCanonicalLifecycle, STAGE_COLORS } from '@/hooks/useCanonicalLifecycle';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ContentViewer } from '@/components/prep/ContentViewer';
import { isNotionZipResource, splitNotionImport } from '@/lib/notionZipSplitter';
import { isNotionSourceArchive, isNotionDirectImport, getImportGroupId, deleteImportGroupChildren, deleteJunkNotionChildren } from '@/lib/notionDirectImporter';
import { isFixEligible, fixResourceStateFromContent, fixNotionResourcesWithContent, FIX_RESOURCE_INVALIDATION_KEYS } from '@/lib/fixResourceState';
import { deriveProcessingState } from '@/lib/processingState';
import { deriveResourceTruth } from '@/lib/resourceTruthState';
import type { Resource } from '@/hooks/useResources';

const RESOLUTION_LABELS: Record<string, string> = {
  metadata_only: 'Metadata Only',
  manual_transcript_paste: 'Manual Transcript',
  manual_paste: 'Manual Content',
  transcript_upload: 'Uploaded Transcript',
  content_upload: 'Uploaded Content',
  alternate_url: 'Alternate URL',
  fixed_from_existing_content: 'Fixed From Content',
  manual_content: 'Manual Content',
  notion_zip_import: 'Notion ZIP Import',
  notion_zip_split: 'Notion Split',
  notion_zip_source: 'Notion Source (Archived)',
};

interface Props {
  resource: Resource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
  onResourceUpdated?: () => void;
}

function isNotionSource(resource: any): boolean {
  const rm = resource?.resolution_method;
  const em = resource?.extraction_method;
  if (rm === 'notion_zip_split' || em === 'notion_zip_split') return false;
  return (
    rm === 'notion_zip_import' ||
    rm === 'notion_zip_source' ||
    em === 'notion_zip_import' ||
    em === 'notion_zip_source' ||
    (resource?.content_length ?? 0) > 100_000 ||
    isNotionZipResource(resource)
  );
}

export function LibraryResourceDrawer({ resource, open, onOpenChange, onEdit, onResourceUpdated }: Props) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showContentViewer, setShowContentViewer] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitProgress, setSplitProgress] = useState('');
  const [fixing, setFixing] = useState(false);
  const [deletingJunk, setDeletingJunk] = useState(false);
  const [fixingAll, setFixingAll] = useState(false);
  const [hydrated, setHydrated] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Fetch full resource row on open so eligibility checks have all fields
  useEffect(() => {
    if (!open || !resource?.id) {
      setHydrated(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (supabase as any)
      .from('resources')
      .select('*')
      .eq('id', resource.id)
      .single()
      .then(({ data }: any) => {
        if (!cancelled) setHydrated(data ?? null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, resource?.id]);

  // Use hydrated row when available, fall back to prop
  const r = (hydrated ?? resource) as any;
  const contentLength = r.content_length ?? 0;
  const rm = r.resolution_method;
  const em = r.extraction_method;
  const resLabel = rm ? (RESOLUTION_LABELS[rm] || rm.replace(/_/g, ' ')) : null;
  const ps = deriveProcessingState(r);
  const hasContent = contentLength > 0 || r.manual_content_present;
  const showNotionCTA = isNotionSource(r);
  const showFixCTA = !loading && isFixEligible(r);
  const isArchive = isNotionSourceArchive(r);
  const showDeleteJunkCTA = !loading && (isArchive || isNotionSource(r));

  const handleSplit = async () => {
    if (!user?.id) return;
    setSplitting(true);
    setSplitProgress('Parsing sections…');
    try {
      const result = await splitNotionImport(r.id, user.id, (msg) => setSplitProgress(msg));
      toast.success(`Split into ${result.resourcesCreated} resources`);
      FIX_RESOURCE_INVALIDATION_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
      onResourceUpdated?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Split failed');
    } finally {
      setSplitting(false);
      setSplitProgress('');
    }
  };

  const handleFix = async () => {
    if (!user?.id) return;
    setFixing(true);
    try {
      const result = await fixResourceStateFromContent(r.id, user.id, { triggerReEnrich: true });
      if (result.success) {
        toast.success(result.message);
        FIX_RESOURCE_INVALIDATION_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
        onResourceUpdated?.();
      } else {
        toast.error(result.message);
      }
    } catch (e: any) {
      toast.error(e.message || 'Fix failed');
    } finally {
      setFixing(false);
    }
  };
  const handleDeleteJunk = async () => {
    if (!user?.id) return;
    const groupId = getImportGroupId(r);
    if (!confirm('Delete junk Notion resources from this import? Valid resources will be preserved.')) return;
    setDeletingJunk(true);
    try {
      const result = await deleteJunkNotionChildren(user.id, groupId);
      if (result.errors.length > 0) {
        toast.error(`Partial cleanup: ${result.errors[0]}`);
      } else {
        toast.success(`Deleted ${result.deleted} junk Notion resources, preserved ${result.preserved} valid`);
      }
      FIX_RESOURCE_INVALIDATION_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
      onResourceUpdated?.();
    } catch (e: any) {
      toast.error(e.message || 'Cleanup failed');
    } finally {
      setDeletingJunk(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={cn(
            'p-0 flex flex-col',
            isMobile ? 'h-[92vh] rounded-t-2xl' : 'sm:max-w-md',
          )}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{r.title}</SheetTitle>
          </SheetHeader>

          {/* Drag handle on mobile */}
          {isMobile && (
            <div className="flex justify-center py-2 shrink-0">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
          )}

          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <Button variant="ghost" size="sm" className="h-11 w-11 p-0 shrink-0" onClick={() => onOpenChange(false)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">{r.title}</h2>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {resLabel && (
                  <Badge className="text-[9px] bg-primary/15 text-primary border-primary/30">{resLabel}</Badge>
                )}
                {contentLength > 0 && (
                  <Badge variant="outline" className="text-[9px]">{contentLength.toLocaleString()} chars</Badge>
                )}
                <Badge variant="outline" className="text-[9px]">{ps.label}</Badge>
              </div>
            </div>
          </div>

          {/* Loading skeleton while hydrating */}
          {loading && (
            <div className="px-4 pt-3 space-y-2 shrink-0">
              <Skeleton className="h-11 w-full rounded-md" />
              <Skeleton className="h-11 w-full rounded-md" />
              <Skeleton className="h-4 w-2/3 rounded" />
            </div>
          )}

          {/* Notion Rebuild CTA — always above the fold */}
          {showNotionCTA && (
            <div className="px-4 pt-3 shrink-0">
              <Button
                className={cn(
                  'w-full min-h-[44px] gap-2',
                  contentLength > 100_000 ? 'bg-primary text-primary-foreground' : '',
                )}
                variant={contentLength > 100_000 ? 'default' : 'outline'}
                onClick={handleSplit}
                disabled={splitting}
              >
                {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderTree className="h-4 w-4" />}
                {splitting ? splitProgress : 'Rebuild Notion Import'}
              </Button>
            </div>
          )}

          {/* Fix Resource CTA */}
          {showFixCTA && (
            <div className="px-4 pt-2 shrink-0">
              <Button
                className="w-full min-h-[44px] gap-2"
                variant="outline"
                onClick={handleFix}
                disabled={fixing}
              >
                {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                {fixing ? 'Fixing…' : 'Fix Resource'}
              </Button>
            </div>
          )}

          {/* Delete Junk Notion Resources CTA */}
          {showDeleteJunkCTA && (
            <div className="px-4 pt-2 shrink-0 space-y-2">
              <Button
                className="w-full min-h-[44px] gap-2"
                variant="outline"
                onClick={handleDeleteJunk}
                disabled={deletingJunk}
              >
                {deletingJunk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deletingJunk ? 'Cleaning up…' : 'Delete Junk Notion Resources'}
              </Button>
              {/* Fix All Notion Resources */}
              <Button
                className="w-full min-h-[44px] gap-2"
                variant="outline"
                onClick={async () => {
                  if (!user?.id) return;
                  setFixingAll(true);
                  try {
                    const result = await fixNotionResourcesWithContent(user.id, { triggerReEnrich: true });
                    toast.success(`Fixed ${result.fixed} Notion resources — content activated and scored`);
                    FIX_RESOURCE_INVALIDATION_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
                    onResourceUpdated?.();
                  } catch (e: any) {
                    toast.error(e.message || 'Fix failed');
                  } finally {
                    setFixingAll(false);
                  }
                }}
                disabled={fixingAll}
              >
                {fixingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                {fixingAll ? 'Fixing all Notion resources…' : 'Fix All Notion Resources'}
              </Button>
              {isArchive && (
                <Button
                  className="w-full min-h-[44px] gap-2"
                  variant="destructive"
                  onClick={async () => {
                    const groupId = getImportGroupId(r);
                    if (!groupId || !user?.id) return;
                    if (!confirm('Delete ALL generated resources from this Notion import? This cannot be undone.')) return;
                    try {
                      const result = await deleteImportGroupChildren(groupId, user.id);
                      if (result.errors.length > 0) {
                        toast.error(`Partial: ${result.errors[0]}`);
                      } else {
                        toast.success(`Deleted ${result.deleted} generated resources`);
                      }
                      FIX_RESOURCE_INVALIDATION_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
                      onResourceUpdated?.();
                    } catch (e: any) {
                      toast.error(e.message || 'Delete failed');
                    }
                  }}
                  disabled={deletingJunk}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete All Generated Resources
                </Button>
              )}
            </div>
          )}

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-3">
              {/* ── Lifecycle Status Panel ── */}
              <LifecyclePanel resourceId={r.id} resource={r} />

              {/* View Content */}
              {hasContent && (
                <Button
                  variant="outline"
                  className="w-full min-h-[44px] gap-2 justify-start"
                  onClick={() => setShowContentViewer(true)}
                >
                  <Eye className="h-4 w-4" />
                  View Content
                </Button>
              )}

              {/* Edit */}
              {onEdit && (
                <Button
                  variant="outline"
                  className="w-full min-h-[44px] gap-2 justify-start"
                  onClick={() => { onEdit(); onOpenChange(false); }}
                >
                  <Edit3 className="h-4 w-4" />
                  Edit Resource
                </Button>
              )}

              {/* Details */}
              <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
                {r.resource_type && <p>Type: {r.resource_type}</p>}
                {r.file_url && <p className="truncate">URL: {r.file_url}</p>}
                {rm && <p>Resolution: {resLabel || rm}</p>}
                {em && <p>Extraction: {em.replace(/_/g, ' ')}</p>}
                {r.updated_at && <p>Updated: {new Date(r.updated_at).toLocaleDateString()}</p>}
              </div>

              {/* Danger zone */}
              <div className="pt-2 border-t border-border space-y-2">
                <p className="text-[10px] font-semibold text-destructive/70 uppercase tracking-wider">Danger</p>
                <Button
                  variant="destructive"
                  className="w-full min-h-[44px] gap-2 justify-start"
                  onClick={async () => {
                    if (!confirm('Delete this resource? This cannot be undone.')) return;
                    try {
                      const { deleteResourceWithCleanup } = await import('@/lib/resourceDelete');
                      await deleteResourceWithCleanup(r.id);
                      toast.success('Resource deleted');
                      FIX_RESOURCE_INVALIDATION_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
                      onResourceUpdated?.();
                      onOpenChange(false);
                    } catch (e: any) {
                      toast.error(e.message || 'Delete failed');
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Resource
                </Button>
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Content Viewer */}
      {showContentViewer && (
        <ContentViewer
          resource={resource}
          open={showContentViewer}
          onOpenChange={setShowContentViewer}
        />
      )}
    </>
  );
}

// ── Lifecycle panel using canonical model ──────────────────
const HUMAN_STAGE_LABELS: Record<string, string> = {
  uploaded: 'Uploaded',
  content_ready: 'Content Ready',
  tagged: 'Tagged',
  knowledge_extracted: 'Knowledge Extracted',
  activated: 'Activated',
  operationalized: 'Ready to Use',
};

const HUMAN_BLOCKED_LABELS: Record<string, string> = {
  empty_content: 'Missing Content',
  placeholder_content: 'PDF Parse Incomplete',
  no_extraction: 'Transcript content exists — extraction not triggered',
  no_activation: 'Needs Activation',
  missing_contexts: 'Needs Context Repair',
  stale_blocker_state: 'Needs Review',
  none: 'None',
};

const BLOCKED_ACTIONS: Record<string, string> = {
  empty_content: 'Add content via enrichment or manual paste',
  placeholder_content: 'Retry PDF parsing to extract real content',
  no_extraction: 'Run knowledge extraction on this resource',
  no_activation: 'Activate extracted knowledge items',
  missing_contexts: 'Add context tags to active knowledge items',
  stale_blocker_state: 'Clear stale state and re-enrich',
  none: 'No action needed',
};

function LifecyclePanel({ resourceId, resource }: { resourceId: string; resource?: Resource }) {
  const { summary } = useCanonicalLifecycle();
  if (!summary) return null;

  const status = summary.resources.find(r => r.resource_id === resourceId);
  if (!status) return null;

  const stageLabel = HUMAN_STAGE_LABELS[status.canonical_stage] ?? status.canonical_stage;
  const blockedLabel = HUMAN_BLOCKED_LABELS[status.blocked_reason] ?? status.blocked_reason;
  const actionLabel = BLOCKED_ACTIONS[status.blocked_reason] ?? '';
  // Derive readiness from canonical truth — not lifecycle stage alone
  const lc = {
    stage: status.canonical_stage,
    blocked: status.blocked_reason,
    kiCount: status.knowledge_item_count,
    activeKi: status.active_ki_count,
    activeKiWithCtx: status.active_ki_with_context_count,
  };
  const truth = resource ? deriveResourceTruth(resource, lc) : null;
  const isReady = truth ? truth.is_ready : false;
  const isBlocked = truth ? !truth.is_ready && truth.all_blockers.length > 0 : status.blocked_reason !== 'none';

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2',
      isReady ? 'border-emerald-500/30 bg-emerald-500/5' : isBlocked ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-muted/30',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isReady ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : isBlocked ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <Info className="h-4 w-4 text-muted-foreground" />
          )}
          <span className={cn('text-xs font-semibold', STAGE_COLORS[status.canonical_stage])}>
            {stageLabel}
          </span>
        </div>
        <Badge variant="outline" className="text-[9px]">
          {status.knowledge_item_count} KI · {status.active_ki_count} active · {status.active_ki_with_context_count} w/ctx
        </Badge>
      </div>

      {isBlocked && (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Blocked by:</span> {blockedLabel}
          </p>
          <p className="text-primary/80 flex items-center gap-1">
            <span className="font-medium">Fix:</span> {actionLabel}
          </p>
        </div>
      )}

      {isReady && (
        <p className="text-[10px] text-emerald-600">
          This resource has active knowledge items with contexts — it's influencing prep, practice, and Dave.
        </p>
      )}
    </div>
  );
}
