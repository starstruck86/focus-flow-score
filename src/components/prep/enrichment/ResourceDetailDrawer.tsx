/**
 * Resource Detail Drawer — Full inline editor with diagnostics and actions.
 * Parts 3 + 4 of the Enrichment Operator Console.
 * Mobile: renders as full-screen sheet with grouped actions.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  X, Save, Zap, RotateCcw, FileText, ExternalLink, Trash2,
  Bookmark, SkipForward, Ban, ShieldOff, Play, Wrench,
  Loader2, CheckCircle2, AlertTriangle, Copy, Unlock, ArrowLeft, Eye, MoreHorizontal,
  ChevronDown, ChevronRight, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { ContentViewer } from '../ContentViewer';
import { isFixEligible, fixResourceStateFromContent, FIX_RESOURCE_INVALIDATION_KEYS } from '@/lib/fixResourceState';
import { resolveResourceWithManualInput, type RecoveryMode } from '@/lib/manualRecoveryResolver';
import type { VerifiedResource } from '@/lib/enrichmentVerification';
import { mapVerifiedToBucket, BUCKET_META } from './types';
import { classifyQuarantine, getQuarantineSubClass, shouldAutoRelease } from '@/lib/quarantineClassification';

interface Props {
  resource: VerifiedResource;
  onClose: () => void;
  onResourceUpdated: () => void;
}

type ActionMode = 'paste_transcript' | 'paste_content' | 'alt_url' | null;

export function ResourceDetailDrawer({ resource: r, onClose, onResourceUpdated }: Props) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [title, setTitle] = useState(r.title);
  const [url, setUrl] = useState(r.url ?? '');
  const [description, setDescription] = useState('');
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [actionInput, setActionInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showContentViewer, setShowContentViewer] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [diagOpen, setDiagOpen] = useState(!isMobile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, []);

  const bucket = mapVerifiedToBucket(r);
  const bucketMeta = BUCKET_META[bucket];
  const hasContent = (r.contentLength ?? 0) > 0 || (r as any).manual_content_present === true || (r as any).content_length > 0;
  const canFix = isFixEligible({
    content_length: (r as any).contentLength,
    manual_content_present: (r as any).manual_content_present,
    content: (r as any).content,
    enrichment_status: r.enrichmentStatusLabel === 'deep_enriched' ? 'deep_enriched' : (r as any).enrichment_status ?? r.enrichmentStatusLabel,
    manual_input_required: (r as any).manual_input_required,
    recovery_queue_bucket: (r as any).recovery_queue_bucket,
    failure_reason: r.failureReason,
    recovery_status: (r as any).recovery_status,
    last_quality_score: (r as any).qualityScore ?? (r as any).last_quality_score,
  });

  const invalidateAll = useCallback(() => {
    FIX_RESOURCE_INVALIDATION_KEYS.forEach(key => {
      qc.invalidateQueries({ queryKey: key });
    });
    qc.invalidateQueries({ queryKey: ['audio-jobs-map'] });
    onResourceUpdated();
  }, [qc, onResourceUpdated]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!currentUserId) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isZip = ext === 'zip';
      const isTranscript = ['vtt', 'srt'].includes(ext);
      const mode: RecoveryMode = isZip ? 'upload_notion_zip' : isTranscript ? 'upload_transcript' : 'upload_content';
      const result = await resolveResourceWithManualInput({
        mode,
        resourceId: r.id,
        userId: currentUserId,
        file,
      });
      if (result.success) {
        toast.success(isZip ? 'Notion export processed — content imported and enrichment started' : result.message);
        invalidateAll();
        onClose();
      } else {
        toast.error(result.message);
      }
    } catch (e: any) {
      toast.error(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }, [r.id, currentUserId, invalidateAll, onClose]);

  const saveFields = useCallback(async () => {
    setSaving(true);
    try {
      const updates: Record<string, any> = { last_status_change_at: new Date().toISOString() };
      if (title !== r.title) updates.title = title;
      if (url !== (r.url ?? '')) updates.file_url = url || null;
      if (description) updates.description = description;
      await supabase.from('resources').update(updates).eq('id', r.id);
      toast.success('Saved');
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }, [r, title, url, description, invalidateAll]);

  const runAction = useCallback(async (action: string) => {
    setActiveAction(action);
    try {
      switch (action) {
        case 'fix_resource': {
          const result = await fixResourceStateFromContent(r.id, currentUserId, { triggerReEnrich: true });
          if (result.success) {
            toast.success(result.message);
            invalidateAll();
            onClose();
          } else {
            toast.error(result.message);
          }
          break;
        }
        case 'save': {
          await saveFields();
          break;
        }
        case 'save_reenrich': {
          await saveFields();
          await invokeEnrichResource({ resource_id: r.id, force: true }, { componentName: 'ResourceDetailDrawer', timeoutMs: 60000 });
          toast.success('Re-enrichment started');
          break;
        }
        case 'save_rescore': {
          await saveFields();
          toast.success('Saved — score will update on next verification');
          break;
        }
        case 'submit_transcript':
        case 'submit_content': {
          if (!actionInput.trim()) return;
          await supabase.from('resources').update({
            content: actionInput.trim(),
            content_length: actionInput.trim().length,
            content_status: 'full',
            manual_content_present: true,
            resolution_method: action === 'submit_transcript' ? 'manual_transcript_paste' : 'manual_paste',
            extraction_method: action === 'submit_transcript' ? 'manual_transcript_paste' : 'manual_paste',
            enrichment_status: 'not_enriched',
            failure_reason: null,
            failure_count: 0,
            manual_input_required: false,
            recovery_status: 'pending_reprocess',
            recovery_reason: null,
            next_best_action: null,
            last_recovery_error: null,
            platform_status: null,
            recovery_queue_bucket: null,
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          await invokeEnrichResource({ resource_id: r.id, force: true }, { componentName: 'ResourceDetailDrawer', timeoutMs: 60000 });
          setActionMode(null);
          setActionInput('');
          toast.success('Content saved & re-enrichment started');
          invalidateAll();
          onClose();
          break;
        }
        case 'submit_alt_url': {
          if (!actionInput.trim()) return;
          await supabase.from('resources').update({
            file_url: actionInput.trim(),
            enrichment_status: 'not_enriched',
            failure_reason: null,
            failure_count: 0,
            manual_input_required: false,
            recovery_status: 'pending_retry',
            recovery_reason: null,
            next_best_action: null,
            last_recovery_error: null,
            platform_status: null,
            recovery_queue_bucket: null,
            resolution_method: 'alternate_url',
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          await invokeEnrichResource({ resource_id: r.id, force: true }, { componentName: 'ResourceDetailDrawer', timeoutMs: 60000 });
          setActionMode(null);
          setActionInput('');
          toast.success('URL updated & re-enrichment started');
          break;
        }
        case 'clear_content': {
          await supabase.from('resources').update({
            content: '',
            content_length: 0,
            manual_content_present: false,
            enrichment_status: 'not_enriched',
            failure_reason: null,
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          toast.success('Content cleared — ready for re-enrichment');
          break;
        }
        case 'reset_ready': {
          await supabase.from('resources').update({
            enrichment_status: 'not_enriched',
            failure_reason: null,
            failure_count: 0,
            manual_input_required: false,
            recovery_queue_bucket: null,
            recovery_reason: null,
            next_best_action: null,
            last_recovery_error: null,
            platform_status: null,
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          toast.success('Reset to ready');
          break;
        }
        case 'accept_metadata': {
          await supabase.from('resources').update({
            enrichment_status: 'deep_enriched',
            failure_reason: null,
            failure_count: 0,
            last_quality_tier: 'metadata_only',
            enriched_at: new Date().toISOString(),
            last_status_change_at: new Date().toISOString(),
            recovery_status: 'resolved_metadata_only',
            recovery_queue_bucket: null,
            resolution_method: 'metadata_only',
            extraction_method: 'metadata_only',
            manual_input_required: false,
            next_best_action: null,
            last_recovery_error: null,
            platform_status: null,
          } as any).eq('id', r.id);
          toast.success('Accepted as metadata-only');
          break;
        }
        case 'park': {
          await supabase.from('resources').update({
            failure_reason: 'Parked for later — operator deferred',
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          toast.success('Parked for later');
          break;
        }
        case 'quarantine': {
          await supabase.from('resources').update({
            enrichment_status: 'quarantined',
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          toast.success('Quarantined');
          break;
        }
        case 'unquarantine': {
          if (!confirm('Remove from quarantine? This resource will become eligible for enrichment again.')) return;
          await supabase.from('resources').update({
            enrichment_status: 'not_enriched',
            failure_reason: null,
            failure_count: 0,
            manual_input_required: false,
            recovery_queue_bucket: null,
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          toast.success('Removed from quarantine');
          break;
        }
        case 'retry_enrich': {
          await supabase.from('resources').update({
            enrichment_status: 'not_enriched',
            failure_reason: null,
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          await invokeEnrichResource({ resource_id: r.id, force: true }, { componentName: 'ResourceDetailDrawer', timeoutMs: 60000 });
          toast.success('Re-enrichment started');
          break;
        }
      }
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message || 'Action failed');
    } finally {
      setActiveAction(null);
    }
  }, [r, saveFields, actionInput, invalidateAll, onClose]);

  const ActionBtn = ({ action, label, icon, variant = 'outline', disabled = false }: {
    action: string; label: string; icon: React.ReactNode; variant?: 'outline' | 'default' | 'destructive' | 'ghost'; disabled?: boolean;
  }) => (
    <Button
      size="sm" variant={variant}
      className={cn('gap-1.5', isMobile ? 'h-11 text-sm justify-start min-h-[44px]' : 'h-7 text-[10px]')}
      disabled={!!activeAction || disabled}
      onClick={() => runAction(action)}
    >
      {activeAction === action ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </Button>
  );

  // ── Drawer inner content ──
  const drawerContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background z-10">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isMobile && (
            <Button variant="ghost" size="sm" className="h-11 w-11 p-0 shrink-0 min-h-[44px] min-w-[44px]" onClick={onClose}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{r.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge variant="outline" className="text-[9px]">{r.subtypeLabel}</Badge>
              <Badge className={cn('text-[9px]', bucketMeta.color === 'text-status-green' ? 'bg-status-green/15 text-status-green' : bucketMeta.color === 'text-destructive' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground')}>
                {bucketMeta.label}
              </Badge>
              {/* Resolution badge */}
              {((r as any).manual_content_present || (r as any).resolution_method) && (
                <Badge className="text-[9px] bg-primary/15 text-primary border-primary/30">
                  {(r as any).resolution_method === 'metadata_only' ? 'Metadata Only' :
                   (r as any).resolution_method === 'manual_transcript_paste' ? 'Manual Transcript' :
                   (r as any).resolution_method === 'manual_paste' ? 'Manual Content' :
                   (r as any).resolution_method === 'transcript_upload' ? 'Uploaded Transcript' :
                   (r as any).resolution_method === 'content_upload' ? 'Uploaded Content' :
                   (r as any).resolution_method === 'alternate_url' ? 'Alternate URL' :
                   (r as any).resolution_method === 'fixed_from_existing_content' ? 'Fixed From Existing Content' :
                   'Manual Recovery'}
                </Badge>
              )}
            </div>
          </div>
        </div>
        {!isMobile && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className={cn('space-y-4', isMobile ? 'p-4 pb-32' : 'p-4')}>
          {/* Diagnostics — collapsible on mobile */}
          <Collapsible open={diagOpen} onOpenChange={setDiagOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 w-full text-left">
                {diagOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Diagnostics</p>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1.5 mt-1.5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <DiagRow label="Resource ID" value={r.id.slice(0, 8) + '…'} copyable={r.id} />
                  <DiagRow label="Score" value={`${r.qualityScore}/100`} />
                  <DiagRow label="Quality Tier" value={r.qualityTier} />
                  <DiagRow label="Status" value={r.enrichmentStatusLabel} />
                  <DiagRow label="Enrichability" value={r.enrichability} />
                  <DiagRow label="Content Length" value={`${r.contentLength} chars`} />
                  <DiagRow label="Failure Count" value={String(r.failureCount)} />
                  <DiagRow label="Enrichment Ver" value={String(r.enrichmentVersion)} />
                  {r.audioJobStatus && <DiagRow label="Audio Job" value={r.audioJobStatus} />}
                  {r.transcriptMode && <DiagRow label="Transcript Mode" value={r.transcriptMode} />}
                  {r.enrichedAt && <DiagRow label="Enriched At" value={new Date(r.enrichedAt).toLocaleDateString()} />}
                  {r.lastAttemptAt && <DiagRow label="Last Attempt" value={new Date(r.lastAttemptAt).toLocaleDateString()} />}
                </div>
                {r.failureReason && (
                  <div className="rounded bg-destructive/5 border border-destructive/20 px-2 py-1.5">
                    <p className="text-[10px] text-destructive">{r.failureReason}</p>
                  </div>
                )}
                <div className="rounded bg-muted px-2 py-1.5 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground"><strong>Root cause:</strong> {r.rootCauseCategory}</p>
                  <p className="text-[10px] text-muted-foreground"><strong>Why not complete:</strong> {r.whyNotComplete}</p>
                  <p className="text-[10px] text-muted-foreground"><strong>Next action:</strong> {r.recommendedAction}</p>
                  {r.requiredBuild && (
                    <p className="text-[10px] text-destructive"><strong>Required build:</strong> {r.requiredBuild.description}</p>
                  )}
                </div>
                {r.contradictions.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-medium text-destructive">Contradictions:</p>
                    {r.contradictions.map((c, i) => (
                      <p key={i} className="text-[10px] text-destructive/80">• {c.description}</p>
                    ))}
                  </div>
                )}
                {/* Quarantine Info */}
                {r.quarantined && (() => {
                  const qMeta = classifyQuarantine(r);
                  const subClass = getQuarantineSubClass(qMeta);
                  const canRelease = shouldAutoRelease(r);
                  return (
                    <div className="rounded bg-destructive/5 border border-destructive/20 px-2 py-1.5 space-y-1">
                      <p className="text-[10px] font-medium text-destructive">Quarantine Details</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                        <DiagRow label="Type" value={qMeta.reasonType.replace(/_/g, ' ')} />
                        <DiagRow label="Classification" value={subClass.replace(/_/g, ' ')} />
                        <DiagRow label="By System" value={qMeta.quarantinedBySystem ? 'Yes' : 'No'} />
                        <DiagRow label="By Operator" value={qMeta.quarantinedByOperator ? 'Yes' : 'No'} />
                        <DiagRow label="Locked" value={qMeta.quarantineLocked ? 'Yes' : 'No'} />
                        <DiagRow label="Valid" value={qMeta.isValid ? 'Yes' : 'No'} />
                      </div>
                      {canRelease && (
                        <div className="flex items-center gap-2 pt-1">
                          <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary border-primary/20">
                            Invalid quarantine: eligible for automatic retry
                          </Badge>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Editable fields */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Edit Resource</p>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">Title</label>
              <Input value={title} onChange={e => setTitle(e.target.value)} className={cn('text-xs', isMobile ? 'h-11' : 'h-7')} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">URL</label>
              <Input value={url} onChange={e => setUrl(e.target.value)} className={cn('text-xs', isMobile ? 'h-11' : 'h-7')} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">Description / Notes</label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} className="text-xs min-h-[50px]" placeholder="Operator notes…" />
            </div>
          </div>

          <Separator />

          {/* ── Actions (grouped) ── */}
          <div className="space-y-3">
            {/* Primary */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Primary</p>
              <div className={cn('flex flex-wrap gap-1.5', isMobile && 'flex-col')}>
                {canFix && (
                  <ActionBtn action="fix_resource" label={activeAction === 'fix_resource' ? 'Fixing…' : 'Fix Resource'} icon={<Wrench className="h-3 w-3" />} variant="default" />
                )}
                <ActionBtn action="save_reenrich" label="Save & Re-enrich" icon={<Zap className="h-3 w-3" />} variant={canFix ? 'outline' : 'default'} />
                <ActionBtn action="save" label="Save" icon={<Save className="h-3 w-3" />} />
              </div>
            </div>

            {/* Content */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Content</p>
              <div className={cn('flex flex-wrap gap-1.5', isMobile && 'flex-col')}>
                {hasContent && (
                  <Button size="sm" variant="outline" className={cn('gap-1.5', isMobile ? 'h-11 text-sm justify-start min-h-[44px]' : 'h-7 text-[10px]')} onClick={() => setShowContentViewer(true)}>
                    <Eye className="h-3 w-3" /> View Content
                  </Button>
                )}
                <Button size="sm" variant="outline" className={cn('gap-1.5', isMobile ? 'h-11 text-sm justify-start min-h-[44px]' : 'h-7 text-[10px]')} onClick={() => setActionMode('paste_transcript')}>
                  <FileText className="h-3 w-3" /> Paste Transcript
                </Button>
                <Button size="sm" variant="outline" className={cn('gap-1.5', isMobile ? 'h-11 text-sm justify-start min-h-[44px]' : 'h-7 text-[10px]')} onClick={() => setActionMode('paste_content')}>
                  <FileText className="h-3 w-3" /> Paste Content
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('gap-1.5', isMobile ? 'h-11 text-sm justify-start min-h-[44px]' : 'h-7 text-[10px]')}
                  disabled={uploading || !!activeAction}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  Upload File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.txt,.md,.csv,.vtt,.srt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            {/* Advanced */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Advanced</p>
              <div className={cn('flex flex-wrap gap-1.5', isMobile && 'flex-col')}>
                <Button size="sm" variant="outline" className={cn('gap-1.5', isMobile ? 'h-11 text-sm justify-start min-h-[44px]' : 'h-7 text-[10px]')} onClick={() => setActionMode('alt_url')}>
                  <ExternalLink className="h-3 w-3" /> Alt URL
                </Button>
                <ActionBtn action="accept_metadata" label="Metadata Only" icon={<Bookmark className="h-3 w-3" />} />
                <ActionBtn action="reset_ready" label="Reset to Ready" icon={<RotateCcw className="h-3 w-3" />} />
                <ActionBtn action="retry_enrich" label="Retry Enrichment" icon={<Play className="h-3 w-3" />} />
              </div>
            </div>

            {/* Danger zone */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-destructive/70 uppercase tracking-wider">Danger</p>
              <div className={cn('flex flex-wrap gap-1.5', isMobile && 'flex-col')}>
                <ActionBtn action="clear_content" label="Clear Content" icon={<Trash2 className="h-3 w-3" />} variant="destructive" />
                <ActionBtn action="park" label="Park" icon={<SkipForward className="h-3 w-3" />} />
                {r.quarantined ? (
                  <ActionBtn action="unquarantine" label="Remove Quarantine" icon={<ShieldOff className="h-3 w-3" />} variant="destructive" />
                ) : (
                  <ActionBtn action="quarantine" label="Quarantine" icon={<Ban className="h-3 w-3" />} variant="destructive" />
                )}
              </div>
            </div>
          </div>

          {/* Inline input area */}
          {actionMode && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground">
                  {actionMode === 'paste_transcript' ? 'Paste Transcript' : actionMode === 'paste_content' ? 'Paste Content' : 'Alternate URL'}
                </p>
                {actionMode === 'alt_url' ? (
                  <Input value={actionInput} onChange={e => setActionInput(e.target.value)} placeholder="https://…" className={cn('text-xs', isMobile ? 'h-11' : 'h-7')} autoFocus />
                ) : (
                  <Textarea value={actionInput} onChange={e => setActionInput(e.target.value)}
                    placeholder={actionMode === 'paste_transcript' ? 'Paste full transcript…' : 'Paste content…'}
                    className="text-xs min-h-[80px]" autoFocus />
                )}
                {actionInput && (
                  <p className="text-[10px] text-muted-foreground">
                    {actionMode === 'alt_url' ? actionInput.trim() : `${actionInput.split(/\s+/).filter(Boolean).length} words`}
                  </p>
                )}
                <div className="flex gap-1.5">
                  <Button size="sm" className={cn('gap-1.5', isMobile ? 'h-11 text-sm min-h-[44px]' : 'h-7 text-[10px]')} disabled={!actionInput.trim() || !!activeAction}
                    onClick={() => runAction(actionMode === 'paste_transcript' ? 'submit_transcript' : actionMode === 'paste_content' ? 'submit_content' : 'submit_alt_url')}>
                    {activeAction ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Submit & Re-enrich
                  </Button>
                  <Button size="sm" variant="ghost" className={cn(isMobile ? 'h-11 text-sm min-h-[44px]' : 'h-7 text-[10px]')} onClick={() => { setActionMode(null); setActionInput(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Mobile sticky primary action */}
      {isMobile && (
        <div className="sticky bottom-0 px-4 py-3 border-t border-border bg-background safe-area-pb">
          {canFix ? (
            <Button className="w-full h-12 text-sm gap-2 min-h-[48px]" disabled={!!activeAction} onClick={() => runAction('fix_resource')}>
              {activeAction === 'fix_resource' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              {activeAction === 'fix_resource' ? 'Fixing…' : 'Fix Resource'}
            </Button>
          ) : (
            <Button className="w-full h-12 text-sm gap-2 min-h-[48px]" disabled={!!activeAction} onClick={() => runAction('save_reenrich')}>
              {activeAction === 'save_reenrich' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Save & Re-enrich
            </Button>
          )}
        </div>
      )}

      {/* Content Viewer */}
      <ContentViewer
        resource={{ id: r.id, title: r.title, content: '', content_length: r.contentLength, updated_at: (r as any).lastAttemptAt || r.enrichedAt || '', resolution_method: (r as any).resolution_method, extraction_method: (r as any).extraction_method, manual_content_present: (r as any).manual_content_present } as any}
        open={showContentViewer}
        onOpenChange={setShowContentViewer}
      />
    </>
  );

  // Mobile: render as full-screen bottom sheet
  if (isMobile) {
    return (
      <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent side="bottom" className="h-[95vh] p-0 flex flex-col rounded-t-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>{r.title}</SheetTitle>
          </SheetHeader>
          {/* Drag handle */}
          <div className="flex justify-center py-2 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          {drawerContent}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: inline panel
  return (
    <div className="border-l border-border bg-background flex flex-col h-full">
      {drawerContent}
    </div>
  );
}

function DiagRow({ label, value, copyable }: { label: string; value: string; copyable?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground flex items-center gap-0.5">
        {value}
        {copyable && (
          <button onClick={() => { navigator.clipboard.writeText(copyable); toast.success('Copied'); }} className="text-muted-foreground hover:text-foreground">
            <Copy className="h-2.5 w-2.5" />
          </button>
        )}
      </span>
    </div>
  );
}
