/**
 * Recovery Queue — the operational center for resolving blocked resources.
 * Phase 3: assisted resolution with file upload, smart escalation, and guided workflows.
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  ScanSearch, RotateCcw, Filter, Lock, FileText, Link2,
  ClipboardPaste, Wrench, HandHelping, Eye, AlertTriangle,
  History, ExternalLink, CheckSquare, Search, Upload,
  ChevronDown, ChevronUp, HelpCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { useAuth } from '@/contexts/AuthContext';
import {
  triggerDeepExtraction, getAttemptHistory, uploadTranscriptFile,
  getAssistedResolutionGuidance,
  type EnrichmentAttemptRecord,
} from '@/lib/advancedExtraction';
import { ZoomAssistPanel } from '@/components/prep/enrichment/ZoomAssistPanel';
import type { VerifiedResource } from '@/lib/enrichmentVerification';

// ── Types ────────────────────────────────────────────────

type RecoveryFilter =
  | 'all'
  | 'deep_extraction'
  | 'zoom_session_assist'
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

interface Props {
  resources: VerifiedResource[];
  onItemResolved: () => void;
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
  const deepAvailable = isPlatformResource && (v.advancedExtractionAttempts ?? 0) < 3;
  const deepExhausted = isPlatformResource && (v.advancedExtractionAttempts ?? 0) >= 1;

  let recoveryBucket: RecoveryFilter = 'all';
  let preciseLabel = '';
  let recoveryReason = '';
  let nextBestAction = '';

  // Platform-specific with deep extraction available AND not yet tried
  if (isPlatformResource && deepAvailable && !deepExhausted && !['auto_fix_now', 'retry_different_strategy', 'bad_scoring_state_bug', 'already_fixed_stale_ui', 'truly_complete'].includes(v.fixabilityBucket)) {
    recoveryBucket = 'deep_extraction';
    preciseLabel = `Try Deep Extraction (${platform})`;
    recoveryReason = `${v.subtypeLabel} — advanced platform-specific extraction available`;
    nextBestAction = 'Try Deep Extraction';
  } else if (isPlatformResource && deepExhausted && v.enrichmentStatus !== 'deep_enriched') {
    // Deep extraction was tried but didn't fully resolve
    if (platform === 'zoom') {
      // Zoom gets session-assisted capture before generic assisted resolution
      recoveryBucket = 'zoom_session_assist';
      preciseLabel = 'Capture From Browser Session';
      recoveryReason = `Deep extraction attempted ${v.advancedExtractionAttempts}× — browser session capture available`;
      nextBestAction = 'Use browser session to capture transcript/media';
    } else {
      recoveryBucket = 'assisted_resolution';
      preciseLabel = `Assisted Resolution (${platform})`;
      recoveryReason = `Deep extraction attempted ${v.advancedExtractionAttempts}× — manual assist needed`;
      nextBestAction = getAssistedNextAction(platform);
    }
  } else if (v.fixabilityBucket === 'needs_transcript') {
    recoveryBucket = 'needs_transcript';
    preciseLabel = 'Needs Transcript';
    recoveryReason = 'Audio/video content — transcript not yet extracted';
    nextBestAction = deepAvailable ? 'Try Deep Extraction or paste transcript' : 'Upload transcript file or paste text';
  } else if (v.fixabilityBucket === 'needs_access_auth') {
    if (isPlatformResource && deepAvailable) {
      recoveryBucket = 'deep_extraction';
      preciseLabel = `Try Deep Extraction (${platform})`;
      recoveryReason = `${v.subtypeLabel} — auth-gated but deep extraction may resolve`;
      nextBestAction = 'Try Deep Extraction first';
    } else {
      recoveryBucket = 'auth_gated';
      preciseLabel = 'Requires Login';
      recoveryReason = 'Content behind authentication wall';
      nextBestAction = 'Paste content, upload file, or provide access';
    }
  } else if (v.fixabilityBucket === 'needs_alternate_source') {
    if (isPlatformResource && deepAvailable) {
      recoveryBucket = 'deep_extraction';
      preciseLabel = `Try Deep Extraction (${platform})`;
      recoveryReason = `${v.subtypeLabel} — previous extraction failed, deep extraction available`;
      nextBestAction = 'Try Deep Extraction';
    } else {
      recoveryBucket = 'alternate_url';
      preciseLabel = 'Alternate URL Needed';
      recoveryReason = 'Source URL failed multiple times';
      nextBestAction = 'Provide an alternate URL';
    }
  } else if (v.fixabilityBucket === 'needs_pasted_content') {
    if (isPlatformResource && deepAvailable) {
      recoveryBucket = 'deep_extraction';
      preciseLabel = `Try Deep Extraction (${platform})`;
      recoveryReason = `${v.subtypeLabel} — deep extraction available before manual paste`;
      nextBestAction = 'Try Deep Extraction';
    } else {
      recoveryBucket = 'awaiting_input';
      preciseLabel = 'Awaiting Manual Content';
      recoveryReason = 'Content could not be extracted automatically';
      nextBestAction = 'Paste content or upload file';
    }
  } else if (v.resolutionType === 'system_gap') {
    recoveryBucket = 'system_gap';
    preciseLabel = 'System Gap';
    recoveryReason = v.rootCause || 'Requires system-level fix';
    nextBestAction = 'Provide content or wait for system fix';
  } else if (['auto_fix_now', 'retry_different_strategy', 'bad_scoring_state_bug', 'already_fixed_stale_ui'].includes(v.fixabilityBucket)) {
    recoveryBucket = 'retryable';
    preciseLabel = 'Auto-Retryable';
    recoveryReason = v.rootCause || 'Can be auto-fixed with retry';
    nextBestAction = 'Retry enrichment';
  } else if (v.fixabilityBucket === 'accept_metadata_only') {
    recoveryBucket = 'assisted_resolution';
    preciseLabel = 'Metadata Only Candidate';
    recoveryReason = 'Only metadata available — accept or provide full content';
    nextBestAction = 'Accept as metadata-only or paste full content';
  } else if (v.fixabilityBucket === 'needs_quarantine') {
    recoveryBucket = 'system_gap';
    preciseLabel = 'Quarantined';
    recoveryReason = v.failureReason || 'Quarantined — review needed';
    nextBestAction = 'Review and retry or paste content';
  } else if (isPlatformResource && deepAvailable) {
    recoveryBucket = 'deep_extraction';
    preciseLabel = `Try Deep Extraction (${platform})`;
    recoveryReason = `${v.subtypeLabel} — advanced platform-specific extraction available`;
    nextBestAction = 'Try Deep Extraction';
  } else {
    recoveryBucket = 'assisted_resolution';
    preciseLabel = 'Assisted Resolution';
    recoveryReason = `${v.subtypeLabel} — deep extraction exhausted`;
    nextBestAction = 'Paste content, upload file, or provide alternate URL';
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

function getAssistedNextAction(platform: string | null): string {
  switch (platform) {
    case 'zoom': return 'Upload Zoom transcript (.vtt/.txt) or paste content';
    case 'thinkific': return 'Log in and paste lesson content';
    case 'circle': return 'Log in and paste post content';
    case 'google_drive': return 'Download file and upload or paste content';
    default: return 'Paste content, upload file, or provide alternate URL';
  }
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
      {attempts.map(a => (
        <div key={a.id} className="text-[8px] border border-border rounded px-2 py-1 space-y-0.5">
          <div className="flex justify-between">
            <span className="font-medium">{a.strategy}</span>
            <Badge variant={a.result === 'success' ? 'default' : a.result === 'pending' ? 'secondary' : 'destructive'} className="text-[7px] h-3">
              {a.result}
            </Badge>
          </div>
          {a.platform && <span className="text-muted-foreground">Platform: {a.platform}</span>}
          {a.failure_category && <span className="text-destructive"> | {a.failure_category}</span>}
          <div className="flex gap-2 text-muted-foreground flex-wrap">
            {a.content_found && <span className="text-green-500">✓ content</span>}
            {a.transcript_url_found && <span className="text-green-500">✓ transcript</span>}
            {a.media_url_found && <span className="text-green-500">✓ media</span>}
            {a.caption_url_found && <span className="text-green-500">✓ captions</span>}
            {a.shell_rejected && <span className="text-destructive">✗ shell</span>}
            {a.runtime_config_found && <span className="text-green-500">✓ runtime</span>}
            {a.content_length_extracted > 0 && <span>{a.content_length_extracted} chars</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Guided Resolution Panel ─────────────────────────────

function GuidedResolutionPanel({
  item,
  pasteContent,
  setPasteContent,
  alternateUrl,
  setAlternateUrl,
  isProcessing,
  onPaste,
  onAltUrl,
  onUpload,
  onMetadataOnly,
  onDeepExtract,
  attempts,
}: {
  item: RecoveryItem;
  pasteContent: string;
  setPasteContent: (v: string) => void;
  alternateUrl: string;
  setAlternateUrl: (v: string) => void;
  isProcessing: boolean;
  onPaste: () => void;
  onAltUrl: () => void;
  onUpload: (file: File) => void;
  onMetadataOnly: () => void;
  onDeepExtract: () => void;
  attempts: EnrichmentAttemptRecord[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const guidance = getAssistedResolutionGuidance(item.platform, item.lastError);
  const [showGuidance, setShowGuidance] = useState(false);

  const canMetadataOnly = item.recoveryBucket === 'auth_gated' || item.recoveryBucket === 'system_gap'
    || item.recoveryBucket === 'assisted_resolution'
    || item.resource.enrichability === 'needs_auth'
    || item.resource.resolutionType === 'system_gap';

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      {/* Source URL */}
      {item.resource.url && (
        <a href={item.resource.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-primary hover:underline flex items-center gap-1">
          <ExternalLink className="h-3 w-3" /> Open source URL
        </a>
      )}

      {/* Platform-specific guidance */}
      <button
        className="text-[9px] text-primary flex items-center gap-1 hover:underline"
        onClick={() => setShowGuidance(!showGuidance)}
      >
        <HelpCircle className="h-3 w-3" />
        {showGuidance ? 'Hide' : 'Show'} resolution guide
        {showGuidance ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {showGuidance && (
        <div className="bg-accent/20 rounded-md p-2 space-y-1.5">
          <p className="text-[9px] font-medium text-foreground">How to resolve this:</p>
          {guidance.steps.map((step, i) => (
            <p key={i} className="text-[8px] text-muted-foreground">{step}</p>
          ))}
          {guidance.tips.length > 0 && (
            <>
              <p className="text-[8px] font-medium text-muted-foreground mt-1">Tips:</p>
              {guidance.tips.map((tip, i) => (
                <p key={i} className="text-[8px] text-muted-foreground italic">• {tip}</p>
              ))}
            </>
          )}
        </div>
      )}

      {/* Strategy history */}
      <AttemptHistoryPanel attempts={attempts} />

      {/* Strategy checklist */}
      <div className="grid grid-cols-2 gap-1 text-[8px]">
        <div className="flex items-center gap-1">
          <CheckSquare className={cn('h-2.5 w-2.5', item.attemptCount > 0 ? 'text-green-500' : 'text-muted-foreground')} />
          Basic extraction: {item.attemptCount > 0 ? 'Yes' : 'No'}
        </div>
        <div className="flex items-center gap-1">
          <CheckSquare className={cn('h-2.5 w-2.5', (item.resource.advancedExtractionAttempts ?? 0) > 0 ? 'text-green-500' : 'text-muted-foreground')} />
          Deep extraction: {(item.resource.advancedExtractionAttempts ?? 0) > 0 ? `${item.resource.advancedExtractionAttempts}× tried` : item.deepExtractionAvailable ? 'Available' : 'N/A'}
        </div>
      </div>

      {/* Deep extraction button if still available */}
      {item.deepExtractionAvailable && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] w-full border-primary/40 text-primary"
          onClick={onDeepExtract}
          disabled={isProcessing}
        >
          <ScanSearch className="h-3 w-3 mr-1" /> Try Deep Extraction ({3 - (item.resource.advancedExtractionAttempts ?? 0)} attempts remaining)
        </Button>
      )}

      {/* File upload */}
      <div className="space-y-1">
        <p className="text-[9px] font-medium text-muted-foreground flex items-center gap-1">
          <Upload className="h-3 w-3" /> Upload Transcript / Content File
        </p>
        <p className="text-[8px] text-muted-foreground">Supports .txt, .vtt, .srt, .json, .csv, .md, .html</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.vtt,.srt,.json,.csv,.md,.html,.htm"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px]"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          <Upload className="h-3 w-3 mr-1" /> Choose File
        </Button>
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
        {pasteContent.trim().length > 0 && (
          <p className="text-[8px] text-muted-foreground">{pasteContent.trim().length} characters</p>
        )}
        <Button
          size="sm"
          className="h-6 text-[10px]"
          onClick={onPaste}
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
          onClick={onAltUrl}
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
        onClick={onMetadataOnly}
        disabled={isProcessing || !canMetadataOnly}
      >
        <Eye className="h-3 w-3 mr-1" /> Metadata Only (Intentional Close)
      </Button>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

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
        // Reload attempt history
        const history = await getAttemptHistory(item.resource.id);
        setAttemptHistory(prev => ({ ...prev, [item.resource.id]: history }));
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

  async function handleFileUpload(resourceId: string, file: File) {
    if (!user?.id) return;
    setProcessing(resourceId);
    try {
      const result = await uploadTranscriptFile(resourceId, user.id, file);
      if (result.success) {
        toast.success(result.message);
        const history = await getAttemptHistory(resourceId);
        setAttemptHistory(prev => ({ ...prev, [resourceId]: history }));
        setExpandedId(null);
        onItemResolved();
      } else {
        toast.error(result.message);
      }
    } catch (e: any) {
      toast.error(`Upload failed: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleMarkMetadataOnly(item: RecoveryItem) {
    const allowed = item.recoveryBucket === 'auth_gated' || item.recoveryBucket === 'system_gap'
      || item.recoveryBucket === 'assisted_resolution'
      || item.resource.enrichability === 'needs_auth'
      || item.resource.resolutionType === 'system_gap';
    if (!allowed) {
      toast.error('Metadata-only is only allowed for auth-gated, assisted, or system gap resources.');
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

      if (user?.id) {
        await (supabase as any).from('enrichment_attempts').insert({
          resource_id: item.resource.id,
          user_id: user.id,
          attempt_type: 'metadata_only',
          strategy: 'metadata_only_close',
          result: 'success',
          completed_at: new Date().toISOString(),
        });
      }

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
                        {(item.resource.advancedExtractionAttempts ?? 0) > 0 && (
                          <Badge variant="outline" className="text-[7px] h-3 border-yellow-500/30 text-yellow-500">
                            {item.resource.advancedExtractionAttempts}× deep
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.attemptCount > 0 && (
                        <span className="text-[8px] text-muted-foreground">{item.attemptCount}× failed</span>
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

                  {/* Expanded: guided resolution panel */}
                  {isExpanded && (
                    <GuidedResolutionPanel
                      item={item}
                      pasteContent={pasteContent}
                      setPasteContent={setPasteContent}
                      alternateUrl={alternateUrl}
                      setAlternateUrl={setAlternateUrl}
                      isProcessing={isProcessing}
                      onPaste={() => handlePasteContent(item.resource.id)}
                      onAltUrl={() => handleAlternateUrl(item.resource.id)}
                      onUpload={(file) => handleFileUpload(item.resource.id, file)}
                      onMetadataOnly={() => handleMarkMetadataOnly(item)}
                      onDeepExtract={() => handleDeepExtraction(item)}
                      attempts={attemptHistory[item.resource.id] || []}
                    />
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
