/**
 * Resource Detail Drawer — Full inline editor with diagnostics and actions.
 * Parts 3 + 4 of the Enrichment Operator Console.
 */
import { useState, useCallback } from 'react';
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
import {
  X, Save, Zap, RotateCcw, FileText, ExternalLink, Trash2,
  Bookmark, SkipForward, Ban, ShieldOff, Play, Wrench,
  Loader2, CheckCircle2, AlertTriangle, Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VerifiedResource } from '@/lib/enrichmentVerification';
import { mapVerifiedToBucket, BUCKET_META } from './types';

interface Props {
  resource: VerifiedResource;
  onClose: () => void;
  onResourceUpdated: () => void;
}

type ActionMode = 'paste_transcript' | 'paste_content' | 'alt_url' | null;

export function ResourceDetailDrawer({ resource: r, onClose, onResourceUpdated }: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(r.title);
  const [url, setUrl] = useState(r.url ?? '');
  const [description, setDescription] = useState('');
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [actionInput, setActionInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const bucket = mapVerifiedToBucket(r);
  const bucketMeta = BUCKET_META[bucket];

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['resources'] });
    qc.invalidateQueries({ queryKey: ['all-resources'] });
    qc.invalidateQueries({ queryKey: ['audio-jobs-map'] });
    onResourceUpdated();
  }, [qc, onResourceUpdated]);

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
            enrichment_status: 'not_enriched',
            failure_reason: null,
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          await invokeEnrichResource({ resource_id: r.id, force: true }, { componentName: 'ResourceDetailDrawer', timeoutMs: 60000 });
          setActionMode(null);
          setActionInput('');
          toast.success('Content saved & re-enrichment started');
          break;
        }
        case 'submit_alt_url': {
          if (!actionInput.trim()) return;
          await supabase.from('resources').update({
            file_url: actionInput.trim(),
            enrichment_status: 'not_enriched',
            failure_reason: null,
            failure_count: 0,
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
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          toast.success('Reset to ready');
          break;
        }
        case 'accept_metadata': {
          await supabase.from('resources').update({
            enrichment_status: 'deep_enriched',
            failure_reason: null,
            last_quality_tier: 'metadata_only',
            enriched_at: new Date().toISOString(),
            last_status_change_at: new Date().toISOString(),
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
            last_status_change_at: new Date().toISOString(),
          } as any).eq('id', r.id);
          toast.success('Removed from quarantine');
          break;
        }
        case 'retry_enrich': {
          // Reset status so the edge function doesn't skip it
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
  }, [r, saveFields, actionInput, invalidateAll]);

  const ActionBtn = ({ action, label, icon, variant = 'outline', disabled = false }: {
    action: string; label: string; icon: React.ReactNode; variant?: 'outline' | 'default' | 'destructive' | 'ghost'; disabled?: boolean;
  }) => (
    <Button
      size="sm" variant={variant}
      className="h-7 text-[10px] gap-1"
      disabled={!!activeAction || disabled}
      onClick={() => runAction(action)}
    >
      {activeAction === action ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </Button>
  );

  return (
    <div className="border-l border-border bg-background flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{r.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge variant="outline" className="text-[9px]">{r.subtypeLabel}</Badge>
            <Badge className={cn('text-[9px]', bucketMeta.color === 'text-status-green' ? 'bg-status-green/15 text-status-green' : bucketMeta.color === 'text-destructive' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground')}>
              {bucketMeta.label}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Diagnostics */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Diagnostics</p>
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
          </div>

          <Separator />

          {/* Editable fields */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Edit Resource</p>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">Title</label>
              <Input value={title} onChange={e => setTitle(e.target.value)} className="h-7 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">URL</label>
              <Input value={url} onChange={e => setUrl(e.target.value)} className="h-7 text-xs" placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">Description / Notes</label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} className="text-xs min-h-[50px]" placeholder="Operator notes…" />
            </div>
          </div>

          <Separator />

          {/* Primary actions */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</p>
            <div className="flex flex-wrap gap-1.5">
              <ActionBtn action="save" label="Save" icon={<Save className="h-3 w-3" />} />
              <ActionBtn action="save_reenrich" label="Save & Re-enrich" icon={<Zap className="h-3 w-3" />} variant="default" />
              <ActionBtn action="save_rescore" label="Save & Re-score" icon={<RotateCcw className="h-3 w-3" />} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => setActionMode('paste_transcript')}>
                <FileText className="h-3 w-3" /> Paste Transcript
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => setActionMode('paste_content')}>
                <FileText className="h-3 w-3" /> Paste Content
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => setActionMode('alt_url')}>
                <ExternalLink className="h-3 w-3" /> Alt URL
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <ActionBtn action="clear_content" label="Clear Content" icon={<Trash2 className="h-3 w-3" />} />
              <ActionBtn action="reset_ready" label="Reset to Ready" icon={<RotateCcw className="h-3 w-3" />} />
              <ActionBtn action="accept_metadata" label="Accept Metadata" icon={<Bookmark className="h-3 w-3" />} />
              <ActionBtn action="park" label="Park" icon={<SkipForward className="h-3 w-3" />} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <ActionBtn action="retry_enrich" label="Retry Enrichment" icon={<Play className="h-3 w-3" />} />
              {r.quarantined ? (
                <ActionBtn action="unquarantine" label="Remove Quarantine" icon={<ShieldOff className="h-3 w-3" />} variant="destructive" />
              ) : (
                <ActionBtn action="quarantine" label="Quarantine" icon={<Ban className="h-3 w-3" />} variant="destructive" />
              )}
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
                  <Input value={actionInput} onChange={e => setActionInput(e.target.value)} placeholder="https://…" className="h-7 text-xs" autoFocus />
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
                  <Button size="sm" className="h-7 text-[10px] gap-1" disabled={!actionInput.trim() || !!activeAction}
                    onClick={() => runAction(actionMode === 'paste_transcript' ? 'submit_transcript' : actionMode === 'paste_content' ? 'submit_content' : 'submit_alt_url')}>
                    {activeAction ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Submit & Re-enrich
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => { setActionMode(null); setActionInput(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
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
