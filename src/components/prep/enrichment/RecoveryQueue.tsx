/**
 * Recovery Queue — dedicated view for all recoverable resources.
 * Shows items that need manual action, are awaiting transcription,
 * or require alternate sources.
 */
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FileText, Lock, ExternalLink, Wrench, RotateCcw, Upload, ClipboardPaste, Eye, Search, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { toast } from 'sonner';
import type { VerifiedResource } from '@/lib/enrichmentVerification';

type RecoveryFilter = 'all' | 'needs_transcript' | 'auth_gated' | 'awaiting_input' | 'system_gap' | 'retryable';

interface RecoveryItem {
  resource: VerifiedResource;
  recoveryReason: string;
  nextBestAction: string;
  recoveryBucket: RecoveryFilter;
  attemptCount: number;
  lastError: string | null;
}

interface Props {
  resources: VerifiedResource[];
  onItemResolved: () => void;
}

function classifyRecoveryItem(v: VerifiedResource): RecoveryItem | null {
  // Only non-complete, non-unsupported
  if (v.fixabilityBucket === 'truly_complete' || v.fixabilityBucket === 'true_unsupported') return null;

  let recoveryBucket: RecoveryFilter = 'all';
  let recoveryReason = '';
  let nextBestAction = '';

  if (v.fixabilityBucket === 'needs_transcript') {
    recoveryBucket = 'needs_transcript';
    recoveryReason = 'Audio/video content — transcript not yet extracted';
    nextBestAction = 'Paste transcript or retry transcription';
  } else if (v.fixabilityBucket === 'needs_access_auth') {
    recoveryBucket = 'auth_gated';
    recoveryReason = 'Content behind authentication wall';
    nextBestAction = 'Paste content or provide access';
  } else if (v.fixabilityBucket === 'needs_pasted_content') {
    recoveryBucket = 'awaiting_input';
    recoveryReason = 'Content could not be extracted automatically';
    nextBestAction = 'Paste content manually';
  } else if (v.fixabilityBucket === 'needs_alternate_source') {
    recoveryBucket = 'awaiting_input';
    recoveryReason = 'Source URL failed multiple times';
    nextBestAction = 'Provide an alternate URL';
  } else if (v.resolutionType === 'system_gap') {
    recoveryBucket = 'system_gap';
    recoveryReason = v.rootCause || 'Requires system-level fix';
    nextBestAction = 'Assign manual review or provide content';
  } else if (['auto_fix_now', 'retry_different_strategy', 'bad_scoring_state_bug', 'already_fixed_stale_ui'].includes(v.fixabilityBucket)) {
    recoveryBucket = 'retryable';
    recoveryReason = 'Can be retried automatically';
    nextBestAction = 'Retry enrichment';
  } else if (v.fixabilityBucket === 'needs_quarantine') {
    recoveryBucket = 'retryable';
    recoveryReason = v.failureReason || 'Quarantined';
    nextBestAction = 'Review and retry or provide content';
  } else {
    return null;
  }

  return {
    resource: v,
    recoveryReason,
    nextBestAction,
    recoveryBucket,
    attemptCount: v.failureCount || 0,
    lastError: v.failureReason || null,
  };
}

const FILTER_META: Record<RecoveryFilter, { label: string; icon: React.ReactNode }> = {
  all: { label: 'All', icon: <Filter className="h-3 w-3" /> },
  needs_transcript: { label: 'Needs Transcript', icon: <FileText className="h-3 w-3" /> },
  auth_gated: { label: 'Auth-Gated', icon: <Lock className="h-3 w-3" /> },
  awaiting_input: { label: 'Awaiting Input', icon: <ClipboardPaste className="h-3 w-3" /> },
  system_gap: { label: 'System Gap', icon: <Wrench className="h-3 w-3" /> },
  retryable: { label: 'Retryable', icon: <RotateCcw className="h-3 w-3" /> },
};

export function RecoveryQueue({ resources, onItemResolved }: Props) {
  const [filter, setFilter] = useState<RecoveryFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  const items = useMemo(() => {
    return resources
      .map(classifyRecoveryItem)
      .filter((item): item is RecoveryItem => item !== null)
      .filter(item => filter === 'all' || item.recoveryBucket === filter)
      .filter(item => !search || item.resource.title.toLowerCase().includes(search.toLowerCase()));
  }, [resources, filter, search]);

  const counts = useMemo(() => {
    const all = resources.map(classifyRecoveryItem).filter((i): i is RecoveryItem => i !== null);
    const c: Record<RecoveryFilter, number> = { all: all.length, needs_transcript: 0, auth_gated: 0, awaiting_input: 0, system_gap: 0, retryable: 0 };
    for (const item of all) c[item.recoveryBucket]++;
    return c;
  }, [resources]);

  async function handleRetry(resourceId: string, isTranscript = false) {
    setProcessing(resourceId);
    try {
      await supabase.from('resources').update({
        enrichment_status: 'not_enriched',
        failure_reason: null,
        failure_count: 0,
        recovery_status: isTranscript ? 'pending_transcription' : 'pending_retry',
        recovery_attempt_count: 0,
        last_status_change_at: new Date().toISOString(),
      } as any).eq('id', resourceId);
      await invokeEnrichResource({ resource_id: resourceId, force: true }, { componentName: 'RecoveryQueue', timeoutMs: 90000 });
      toast.success(isTranscript ? 'Transcription retry initiated' : 'Retry initiated');
      onItemResolved();
    } catch (e: any) {
      toast.error(`Retry failed: ${e.message}`);
      // Persist failure in recovery state
      await supabase.from('resources').update({
        recovery_status: 'retry_failed',
        last_recovery_error: e.message,
        recovery_attempt_count: 1,
      } as any).eq('id', resourceId);
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
      await supabase.from('resources').update({
        content: trimmed,
        content_status: 'full',
        enrichment_status: 'not_enriched',
        failure_reason: null,
        failure_count: 0,
        content_length: trimmed.length,
        manual_content_present: true,
        manual_input_required: false,
        recovery_status: 'pending_reprocess',
        extraction_method: 'manual_paste',
        last_status_change_at: new Date().toISOString(),
      } as any).eq('id', resourceId);
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

  async function handleMarkMetadataOnly(resourceId: string) {
    setProcessing(resourceId);
    try {
      await supabase.from('resources').update({
        enrichment_status: 'deep_enriched',
        failure_reason: null,
        last_quality_tier: 'metadata_only',
        last_status_change_at: new Date().toISOString(),
        enriched_at: new Date().toISOString(),
      } as any).eq('id', resourceId);
      toast.success('Marked as metadata-only');
      onItemResolved();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }

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

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search resources..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs pl-7"
          />
        </div>

        {/* Items */}
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-1">
            {items.map(item => {
              const isExpanded = expandedId === item.resource.id;
              const isProcessing = processing === item.resource.id;
              return (
                <div
                  key={item.resource.id}
                  className={cn(
                    'rounded-md border border-border p-2 space-y-1.5 transition-colors',
                    isExpanded && 'bg-accent/30',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <button
                        className="text-[11px] font-medium text-foreground hover:underline text-left truncate w-full"
                        onClick={() => setExpandedId(isExpanded ? null : item.resource.id)}
                      >
                        {item.resource.title}
                      </button>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[8px] h-3.5">{item.recoveryBucket.replace('_', ' ')}</Badge>
                        <span className="text-[9px] text-muted-foreground truncate">{item.recoveryReason}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.attemptCount > 0 && (
                        <span className="text-[8px] text-muted-foreground">{item.attemptCount} attempts</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0"
                        onClick={() => handleRetry(item.resource.id)}
                        disabled={isProcessing}
                      >
                        <RotateCcw className={cn('h-3 w-3', isProcessing && 'animate-spin')} />
                      </Button>
                    </div>
                  </div>

                  {/* Next action */}
                  <p className="text-[9px] text-primary font-medium">→ {item.nextBestAction}</p>

                  {/* Last error */}
                  {item.lastError && (
                    <p className="text-[9px] text-destructive truncate">Last error: {item.lastError}</p>
                  )}

                  {/* Expanded: actions */}
                  {isExpanded && (
                    <div className="space-y-2 pt-1 border-t border-border">
                      {item.resource.url && (
                        <a href={item.resource.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" /> Open source URL
                        </a>
                      )}

                      {/* Paste content / transcript */}
                      <div className="space-y-1">
                        <Textarea
                          placeholder="Paste content or transcript here..."
                          value={pasteContent}
                          onChange={e => setPasteContent(e.target.value)}
                          className="text-[10px] min-h-[60px]"
                        />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-6 text-[10px]"
                            onClick={() => handlePasteContent(item.resource.id)}
                            disabled={isProcessing || !pasteContent.trim()}
                          >
                            <ClipboardPaste className="h-3 w-3 mr-1" />
                            Save & Re-enrich
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px]"
                            onClick={() => handleMarkMetadataOnly(item.resource.id)}
                            disabled={isProcessing}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            Metadata Only
                          </Button>
                        </div>
                      </div>
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
