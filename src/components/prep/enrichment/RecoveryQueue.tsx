/**
 * Recovery Queue — Advanced resolution control center.
 * Shows strategy history, precise labels, deep extraction actions,
 * batch operations, and assisted resolution workflows.
 */
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  FileText, Lock, ExternalLink, Wrench, RotateCcw, ClipboardPaste,
  Eye, Search, Filter, ScanSearch, HandHelping, Link2, Upload, History,
  CheckSquare, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { triggerDeepExtraction, getAttemptHistory, type EnrichmentAttemptRecord } from '@/lib/advancedExtraction';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { VerifiedResource } from '@/lib/enrichmentVerification';

// ── Types ────────────────────────────────────────────────

type RecoveryFilter =
  | 'all'
  | 'deep_extraction'
  | 'assisted_resolution'
  | 'needs_transcript'
  | 'auth_gated'
  | 'alternate_url'
  | 'awaiting_input'
  | 'system_gap'
  | 'retryable';

interface RecoveryItem {
  resource: VerifiedResource;
  preciseLabel: string;
  recoveryReason: string;
  nextBestAction: string;
  recoveryBucket: RecoveryFilter;
  attemptCount: number;
  lastError: string | null;
  deepExtractionAvailable: boolean;
  platform: string | null;
}

// ── Classification ──────────────────────────────────────

const PLATFORM_SUBTYPES = ['zoom_recording', 'thinkific_lesson', 'auth_gated_community_page', 'google_drive_file', 'google_slides'];

function getPlatform(subtype: string): string | null {
  const map: Record<string, string> = {
    zoom_recording: 'zoom', thinkific_lesson: 'thinkific',
    auth_gated_community_page: 'circle', google_drive_file: 'google_drive',
    google_slides: 'google_slides',
  };
  return map[subtype] ?? null;
}

function classifyRecoveryItem(v: VerifiedResource): RecoveryItem | null {
  if (v.fixabilityBucket === 'truly_complete' || v.fixabilityBucket === 'true_unsupported') return null;

  const platform = getPlatform(v.subtype);
  const isPlatformResource = PLATFORM_SUBTYPES.includes(v.subtype);
  const deepAvailable = isPlatformResource && v.failureCount < 3;

  let recoveryBucket: RecoveryFilter = 'all';
  let preciseLabel = '';
  let recoveryReason = '';
  let nextBestAction = '';

  // Platform-specific with deep extraction available
  if (isPlatformResource && deepAvailable && !['auto_fix_now', 'retry_different_strategy', 'bad_scoring_state_bug', 'already_fixed_stale_ui', 'truly_complete'].includes(v.fixabilityBucket)) {
    recoveryBucket = 'deep_extraction';
    preciseLabel = `Try Deep Extraction (${platform})`;
    recoveryReason = `${v.subtypeLabel} — advanced platform-specific extraction available`;
    nextBestAction = 'Try Deep Extraction';
  } else if (v.fixabilityBucket === 'needs_transcript') {
    recoveryBucket = 'needs_transcript';
    preciseLabel = 'Needs Transcript';
    recoveryReason = 'Audio/video content — transcript not yet extracted';
    nextBestAction = deepAvailable ? 'Try Deep Extraction or paste transcript' : 'Paste transcript';
  } else if (v.fixabilityBucket === 'needs_access_auth') {
    recoveryBucket = 'auth_gated';
    preciseLabel = 'Requires Login';
    recoveryReason = 'Content behind authentication wall';
    nextBestAction = 'Paste content or provide access';
  } else if (v.fixabilityBucket === 'needs_alternate_source') {
    recoveryBucket = 'alternate_url';
    preciseLabel = 'Alternate URL Needed';
    recoveryReason = 'Source URL failed multiple times';
    nextBestAction = 'Provide an alternate URL';
  } else if (v.fixabilityBucket === 'needs_pasted_content') {
    recoveryBucket = 'awaiting_input';
    preciseLabel = 'Awaiting Manual Content';
    recoveryReason = 'Content could not be extracted automatically';
    nextBestAction = 'Paste content manually';
  } else if (v.resolutionType === 'system_gap') {
    recoveryBucket = 'system_gap';
    preciseLabel = 'System Gap';
    recoveryReason = v.rootCause || 'Requires system-level fix';
    nextBestAction = 'Provide content or wait for system fix';
  } else if (['auto_fix_now', 'retry_different_strategy', 'bad_scoring_state_bug', 'already_fixed_stale_ui'].includes(v.fixabilityBucket)) {
    recoveryBucket = 'retryable';
    preciseLabel = 'Auto-Retryable';
    recoveryReason = 'Can be retried automatically';
    nextBestAction = 'Retry enrichment';
  } else if (v.fixabilityBucket === 'needs_quarantine') {
    recoveryBucket = 'retryable';
    preciseLabel = 'Quarantine Review';
    recoveryReason = v.failureReason || 'Quarantined';
    nextBestAction = 'Review and retry or provide content';
  } else if (isPlatformResource && !deepAvailable) {
    recoveryBucket = 'assisted_resolution';
    preciseLabel = 'Assisted Resolution';
    recoveryReason = `${v.subtypeLabel} — deep extraction exhausted`;
    nextBestAction = 'Paste content, upload file, or provide alternate URL';
  } else {
    return null;
  }

  return {
    resource: v,
    preciseLabel,
    recoveryReason,
    nextBestAction,
    recoveryBucket,
    attemptCount: v.failureCount || 0,
    lastError: v.failureReason || null,
    deepExtractionAvailable: deepAvailable,
    platform,
  };
}

// ── Filter meta ─────────────────────────────────────────

const FILTER_META: Record<RecoveryFilter, { label: string; icon: React.ReactNode }> = {
  all: { label: 'All', icon: <Filter className="h-3 w-3" /> },
  deep_extraction: { label: 'Deep Extract', icon: <ScanSearch className="h-3 w-3" /> },
  assisted_resolution: { label: 'Assisted', icon: <HandHelping className="h-3 w-3" /> },
  needs_transcript: { label: 'Needs Transcript', icon: <FileText className="h-3 w-3" /> },
  auth_gated: { label: 'Auth Required', icon: <Lock className="h-3 w-3" /> },
  alternate_url: { label: 'Alt URL Needed', icon: <Link2 className="h-3 w-3" /> },
  awaiting_input: { label: 'Awaiting Input', icon: <ClipboardPaste className="h-3 w-3" /> },
  system_gap: { label: 'System Gap', icon: <Wrench className="h-3 w-3" /> },
  retryable: { label: 'Retryable', icon: <RotateCcw className="h-3 w-3" /> },
};

// ── Attempt History Panel ───────────────────────────────

function AttemptHistoryPanel({ attempts }: { attempts: EnrichmentAttemptRecord[] }) {
  if (!attempts.length) return <p className="text-[9px] text-muted-foreground italic">No attempt history recorded yet.</p>;
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-medium text-muted-foreground flex items-center gap-1"><History className="h-3 w-3" /> Strategy History</p>
      {attempts.slice(0, 5).map(a => (
        <div key={a.id} className="flex items-center gap-2 text-[9px]">
          <Badge variant={a.result === 'success' ? 'default' : a.result === 'failed' ? 'destructive' : 'secondary'} className="text-[7px] h-3">
            {a.result}
          </Badge>
          <span className="truncate">{a.strategy}</span>
          <span className="text-muted-foreground shrink-0">{new Date(a.started_at).toLocaleDateString()}</span>
          <div className="flex gap-1 ml-auto">
            {a.content_found && <Badge variant="outline" className="text-[6px] h-2.5">content</Badge>}
            {a.transcript_url_found && <Badge variant="outline" className="text-[6px] h-2.5">transcript</Badge>}
            {a.media_url_found && <Badge variant="outline" className="text-[6px] h-2.5">media</Badge>}
            {a.shell_rejected && <Badge variant="outline" className="text-[6px] h-2.5 border-destructive text-destructive">shell</Badge>}
            {a.runtime_config_found && <Badge variant="outline" className="text-[6px] h-2.5">runtime</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────

interface Props {
  resources: VerifiedResource[];
  onItemResolved: () => void;
}

export function RecoveryQueue({ resources, onItemResolved }: Props) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<RecoveryFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState('');
  const [alternateUrl, setAlternateUrl] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [attemptHistory, setAttemptHistory] = useState<Record<string, EnrichmentAttemptRecord[]>>({});

  const items = useMemo(() => {
    return resources
      .map(classifyRecoveryItem)
      .filter((item): item is RecoveryItem => item !== null)
      .filter(item => filter === 'all' || item.recoveryBucket === filter)
      .filter(item => !search || item.resource.title.toLowerCase().includes(search.toLowerCase()));
  }, [resources, filter, search]);

  const counts = useMemo(() => {
    const all = resources.map(classifyRecoveryItem).filter((i): i is RecoveryItem => i !== null);
    const c: Record<RecoveryFilter, number> = { all: all.length, deep_extraction: 0, assisted_resolution: 0, needs_transcript: 0, auth_gated: 0, alternate_url: 0, awaiting_input: 0, system_gap: 0, retryable: 0 };
    for (const item of all) c[item.recoveryBucket]++;
    return c;
  }, [resources]);

  // ── Load attempt history on expand ──
  const loadHistory = useCallback(async (resourceId: string) => {
    if (attemptHistory[resourceId]) return;
    const history = await getAttemptHistory(resourceId);
    setAttemptHistory(prev => ({ ...prev, [resourceId]: history }));
  }, [attemptHistory]);

  // ── Actions ──

  async function handleDeepExtraction(item: RecoveryItem) {
    if (!user?.id || !item.platform) return;
    setProcessing(item.resource.id);
    try {
      const result = await triggerDeepExtraction(item.resource.id, user.id, item.platform);
      if (result.success) {
        toast.success('Deep extraction initiated');
        onItemResolved();
      } else {
        toast.error(result.message);
      }
    } catch (e: any) {
      toast.error(`Deep extraction failed: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleRetry(resourceId: string, isTranscript = false) {
    setProcessing(resourceId);
    try {
      await (supabase as any).from('resources').update({
        enrichment_status: 'not_enriched',
        failure_reason: null,
        failure_count: 0,
        recovery_status: isTranscript ? 'pending_transcription' : 'pending_retry',
        recovery_attempt_count: 0,
        last_status_change_at: new Date().toISOString(),
      }).eq('id', resourceId);
      await invokeEnrichResource({ resource_id: resourceId, force: true }, { componentName: 'RecoveryQueue', timeoutMs: 90000 });
      toast.success(isTranscript ? 'Transcription retry initiated' : 'Retry initiated');
      onItemResolved();
    } catch (e: any) {
      toast.error(`Retry failed: ${e.message}`);
      await (supabase as any).from('resources').update({
        recovery_status: 'retry_failed',
        last_recovery_error: e.message,
        recovery_attempt_count: 1,
      }).eq('id', resourceId);
    } finally {
      setProcessing(null);
    }
  }

  async function handlePasteContent(resourceId: string) {
    if (!pasteContent.trim()) { toast.error('Content is empty'); return; }
    const trimmed = pasteContent.trim();
    if (trimmed.length < 50) { toast.error('Content too short — minimum 50 characters'); return; }
    setProcessing(resourceId);
    try {
      await (supabase as any).from('resources').update({
        content: trimmed,
        content_status: 'full',
        enrichment_status: 'not_enriched',
        failure_reason: null,
        failure_count: 0,
        content_length: trimmed.length,
        manual_content_present: true,
        manual_input_required: false,
        recovery_status: 'pending_reprocess',
        resolution_method: 'manual_paste',
        extraction_method: 'manual_paste',
        last_status_change_at: new Date().toISOString(),
      }).eq('id', resourceId);

      // Record attempt
      if (user?.id) {
        await (supabase as any).from('enrichment_attempts').insert({
          resource_id: resourceId,
          user_id: user.id,
          attempt_type: 'manual_paste',
          strategy: 'manual_paste',
          result: 'success',
          content_found: true,
          content_length_extracted: trimmed.length,
          completed_at: new Date().toISOString(),
        });
      }

      await invokeEnrichResource({ resource_id: resourceId, force: true }, { componentName: 'RecoveryQueue', timeoutMs: 60000 });
      toast.success('Content saved & re-enrichment triggered');
      setPasteContent('');
      setExpandedId(null);
      onItemResolved();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleAlternateUrl(resourceId: string) {
    if (!alternateUrl.trim()) { toast.error('URL is empty'); return; }
    setProcessing(resourceId);
    try {
      await (supabase as any).from('resources').update({
        file_url: alternateUrl.trim(),
        enrichment_status: 'not_enriched',
        failure_reason: null,
        failure_count: 0,
        recovery_status: 'pending_retry',
        resolution_method: 'alternate_url',
        extraction_method: null,
        last_status_change_at: new Date().toISOString(),
      }).eq('id', resourceId);

      if (user?.id) {
        await (supabase as any).from('enrichment_attempts').insert({
          resource_id: resourceId,
          user_id: user.id,
          attempt_type: 'alternate_url',
          strategy: 'url_replacement',
          result: 'pending',
          metadata: { new_url: alternateUrl.trim() },
        });
      }

      await invokeEnrichResource({ resource_id: resourceId, force: true }, { componentName: 'RecoveryQueue', timeoutMs: 90000 });
      toast.success('Alternate URL set & re-enrichment triggered');
      setAlternateUrl('');
      setExpandedId(null);
      onItemResolved();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleMarkMetadataOnly(item: RecoveryItem) {
    const allowed = item.recoveryBucket === 'auth_gated' || item.recoveryBucket === 'system_gap'
      || item.resource.enrichability === 'needs_auth'
      || item.resource.resolutionType === 'system_gap';
    if (!allowed) {
      toast.error('Metadata-only is only allowed for auth-gated or system gap resources.');
      return;
    }
    setProcessing(item.resource.id);
    try {
      await (supabase as any).from('resources').update({
        enrichment_status: 'deep_enriched',
        failure_reason: null,
        last_quality_tier: 'metadata_only',
        last_status_change_at: new Date().toISOString(),
        enriched_at: new Date().toISOString(),
        recovery_status: 'resolved_metadata_only',
        recovery_reason: 'Intentionally accepted as metadata-only',
        resolution_method: 'metadata_only',
        extraction_method: 'metadata_only',
      }).eq('id', item.resource.id);
      toast.success('Marked as metadata-only');
      onItemResolved();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }

  // ── Batch actions ──

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map(i => i.resource.id)));
  };

  async function handleBatchRetry() {
    if (selectedIds.size === 0) return;
    setProcessing('batch');
    let resolved = 0;
    for (const id of selectedIds) {
      try {
        await (supabase as any).from('resources').update({
          enrichment_status: 'not_enriched', failure_reason: null, failure_count: 0,
          recovery_status: 'pending_retry', last_status_change_at: new Date().toISOString(),
        }).eq('id', id);
        await invokeEnrichResource({ resource_id: id, force: true }, { componentName: 'RecoveryQueue', timeoutMs: 60000 });
        resolved++;
      } catch { /* continue */ }
    }
    toast.success(`Batch retry: ${resolved}/${selectedIds.size} initiated`);
    setSelectedIds(new Set());
    setProcessing(null);
    onItemResolved();
  }

  async function handleBatchDeepExtraction() {
    if (!user?.id || selectedIds.size === 0) return;
    setProcessing('batch');
    let queued = 0;
    for (const id of selectedIds) {
      const item = items.find(i => i.resource.id === id);
      if (item?.deepExtractionAvailable && item.platform) {
        try {
          await triggerDeepExtraction(id, user.id, item.platform);
          queued++;
        } catch { /* continue */ }
      }
    }
    toast.success(`Deep extraction: ${queued} resources queued`);
    setSelectedIds(new Set());
    setProcessing(null);
    onItemResolved();
  }

  async function handleBatchMarkAuthRequired() {
    if (selectedIds.size === 0) return;
    setProcessing('batch');
    for (const id of selectedIds) {
      await (supabase as any).from('resources').update({
        recovery_status: 'auth_gated_manual_action_required',
        recovery_reason: 'Marked auth-required via batch action',
        access_type: 'auth_gated',
        manual_input_required: true,
        next_best_action: 'paste_content',
      }).eq('id', id);
    }
    toast.success(`${selectedIds.size} items marked as auth-required`);
    setSelectedIds(new Set());
    setProcessing(null);
    onItemResolved();
  }

  // ── Render ──

  if (counts.all === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No resources need recovery — all resources are complete or processing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          Recovery Queue
          <Badge variant="outline" className="text-[9px] ml-auto">{counts.all} items</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Filters */}
        <div className="flex flex-wrap gap-1">
          {(Object.keys(FILTER_META) as RecoveryFilter[]).map(f => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[10px] gap-1 px-2"
              onClick={() => setFilter(f)}
            >
              {FILTER_META[f].icon}
              {FILTER_META[f].label}
              {counts[f] > 0 && <span className="ml-0.5 opacity-70">({counts[f]})</span>}
            </Button>
          ))}
        </div>

        {/* Search + batch controls */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search resources..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 text-xs pl-7"
            />
          </div>
          {selectedIds.size > 0 && (
            <div className="flex gap-1">
              <Button size="sm" className="h-6 text-[9px]" onClick={handleBatchRetry} disabled={processing === 'batch'}>
                <RotateCcw className="h-3 w-3 mr-0.5" /> Retry ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[9px]" onClick={handleBatchDeepExtraction} disabled={processing === 'batch'}>
                <ScanSearch className="h-3 w-3 mr-0.5" /> Deep ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[9px]" onClick={handleBatchMarkAuthRequired} disabled={processing === 'batch'}>
                <Lock className="h-3 w-3 mr-0.5" /> Auth ({selectedIds.size})
              </Button>
            </div>
          )}
        </div>

        {/* Select all */}
        <div className="flex items-center gap-2 px-1">
          <Checkbox
            checked={items.length > 0 && selectedIds.size === items.length}
            onCheckedChange={toggleSelectAll}
            className="h-3 w-3"
          />
          <span className="text-[9px] text-muted-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
          </span>
        </div>

        {/* Items */}
        <ScrollArea className="max-h-[500px]">
          <div className="space-y-1">
            {items.map(item => {
              const isExpanded = expandedId === item.resource.id;
              const isProcessing = processing === item.resource.id || processing === 'batch';
              return (
                <div
                  key={item.resource.id}
                  className={cn(
                    'rounded-md border border-border p-2 space-y-1.5 transition-colors',
                    isExpanded && 'bg-accent/30',
                    selectedIds.has(item.resource.id) && 'border-primary/50 bg-primary/5',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={selectedIds.has(item.resource.id)}
                      onCheckedChange={() => toggleSelect(item.resource.id)}
                      className="h-3 w-3 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <button
                        className="text-[11px] font-medium text-foreground hover:underline text-left truncate w-full"
                        onClick={() => {
                          const newId = isExpanded ? null : item.resource.id;
                          setExpandedId(newId);
                          if (newId) loadHistory(newId);
                        }}
                      >
                        {item.resource.title}
                      </button>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant="secondary" className="text-[8px] h-3.5">{item.preciseLabel}</Badge>
                        <Badge variant="outline" className="text-[7px] h-3">{item.resource.subtypeLabel}</Badge>
                        {item.platform && <Badge variant="outline" className="text-[7px] h-3 border-primary/30 text-primary">{item.platform}</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.attemptCount > 0 && (
                        <span className="text-[8px] text-muted-foreground">{item.attemptCount} att.</span>
                      )}
                      {item.deepExtractionAvailable && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 text-[8px] px-1.5 gap-0.5 border-primary/40 text-primary"
                          title="Try Deep Extraction"
                          onClick={() => handleDeepExtraction(item)}
                          disabled={isProcessing}
                        >
                          <ScanSearch className="h-3 w-3" /> Deep
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0"
                        title="Retry enrichment"
                        onClick={() => handleRetry(item.resource.id, item.recoveryBucket === 'needs_transcript')}
                        disabled={isProcessing}
                      >
                        <RotateCcw className={cn('h-3 w-3', isProcessing && 'animate-spin')} />
                      </Button>
                    </div>
                  </div>

                  {/* Precise reason + next action */}
                  <p className="text-[9px] text-muted-foreground">{item.recoveryReason}</p>
                  <p className="text-[9px] text-primary font-medium">→ {item.nextBestAction}</p>

                  {/* Last error */}
                  {item.lastError && (
                    <p className="text-[9px] text-destructive truncate flex items-center gap-1">
                      <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> {item.lastError}
                    </p>
                  )}

                  {/* Expanded: full resolution panel */}
                  {isExpanded && (
                    <div className="space-y-3 pt-2 border-t border-border">
                      {/* Source URL */}
                      {item.resource.url && (
                        <a href={item.resource.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" /> Open source URL
                        </a>
                      )}

                      {/* Strategy history */}
                      <AttemptHistoryPanel attempts={attemptHistory[item.resource.id] || []} />

                      {/* Strategy checklist */}
                      <div className="grid grid-cols-2 gap-1 text-[8px]">
                        <div className="flex items-center gap-1">
                          <CheckSquare className={cn('h-2.5 w-2.5', item.attemptCount > 0 ? 'text-status-green' : 'text-muted-foreground')} />
                          Basic extraction: {item.attemptCount > 0 ? 'Yes' : 'No'}
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckSquare className={cn('h-2.5 w-2.5', item.resource.failureCount >= 2 ? 'text-status-green' : 'text-muted-foreground')} />
                          Advanced extraction: {item.resource.failureCount >= 2 ? 'Attempted' : item.deepExtractionAvailable ? 'Available' : 'N/A'}
                        </div>
                      </div>

                      {/* Paste content */}
                      <div className="space-y-1">
                        <p className="text-[9px] font-medium text-muted-foreground">Paste Content / Transcript</p>
                        <Textarea
                          placeholder="Paste content, transcript, or summary here..."
                          value={pasteContent}
                          onChange={e => setPasteContent(e.target.value)}
                          className="text-[10px] min-h-[60px]"
                        />
                        <Button
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={() => handlePasteContent(item.resource.id)}
                          disabled={isProcessing || !pasteContent.trim()}
                        >
                          <ClipboardPaste className="h-3 w-3 mr-1" /> Save & Re-enrich
                        </Button>
                      </div>

                      {/* Alternate URL */}
                      <div className="space-y-1">
                        <p className="text-[9px] font-medium text-muted-foreground">Replace Source URL</p>
                        <Input
                          placeholder="https://direct-link-to-content..."
                          value={alternateUrl}
                          onChange={e => setAlternateUrl(e.target.value)}
                          className="h-7 text-[10px]"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px]"
                          onClick={() => handleAlternateUrl(item.resource.id)}
                          disabled={isProcessing || !alternateUrl.trim()}
                        >
                          <Link2 className="h-3 w-3 mr-1" /> Replace URL & Re-enrich
                        </Button>
                      </div>

                      {/* Metadata only */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => handleMarkMetadataOnly(item)}
                        disabled={isProcessing || !(item.recoveryBucket === 'auth_gated' || item.recoveryBucket === 'system_gap')}
                      >
                        <Eye className="h-3 w-3 mr-1" /> Metadata Only (Intentional Close)
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
