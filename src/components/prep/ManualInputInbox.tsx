/**
 * Manual Input Inbox — inline operator workflow for user-fixable resources.
 * Supports paste transcript, paste content, provide alternate URL, accept metadata-only, park, skip.
 * After submit: saves to DB, re-runs enrichment, re-scores, updates queue live.
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FileText, Lock, ExternalLink, Bookmark, SkipForward,
  Loader2, CheckCircle2, ChevronDown, ChevronRight, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CanonicalState } from '@/lib/canonicalResourceState';
import { CANONICAL_STATE_LABELS, CANONICAL_STATE_COLORS } from '@/lib/canonicalResourceState';

// ── Types ────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  title: string;
  url: string | null;
  subtypeLabel: string;
  score: number;
  status: string;
  reason: string;
  nextAction: string;
  sourceRouter: string;
  failureCount: number;
  lastAttempt: string | null;
  audioJobStatus: string | null;
}

export interface InboxQueue {
  state: CanonicalState;
  label: string;
  action: string;
  icon: React.ReactNode;
  items: InboxItem[];
}

type InlineMode = 'paste_transcript' | 'paste_content' | 'alt_url' | 'metadata_only' | 'park' | null;

// ── Main Component ──────────────────────────────────────

export function ManualInputInbox({ queues, onItemResolved }: {
  queues: InboxQueue[];
  onItemResolved: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const nonEmpty = queues.filter(q => q.items.length > 0);

  if (nonEmpty.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-status-green" />
          <p className="text-sm text-muted-foreground">No manual input needed — all clear</p>
        </CardContent>
      </Card>
    );
  }

  const totalItems = nonEmpty.reduce((s, q) => s + q.items.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Manual Input Inbox</h3>
        <Badge variant="outline" className="text-[10px]">{totalItems} items</Badge>
      </div>
      {nonEmpty.map(queue => (
        <InboxQueueSection
          key={queue.state}
          queue={queue}
          expanded={expanded[queue.state] ?? (nonEmpty.length <= 3)}
          onToggle={() => setExpanded(prev => ({ ...prev, [queue.state]: !prev[queue.state] }))}
          onItemResolved={onItemResolved}
        />
      ))}
    </div>
  );
}

// ── Queue Section ───────────────────────────────────────

function InboxQueueSection({ queue, expanded, onToggle, onItemResolved }: {
  queue: InboxQueue; expanded: boolean;
  onToggle: () => void; onItemResolved: () => void;
}) {
  const stateColor = CANONICAL_STATE_COLORS[queue.state] || 'bg-muted text-muted-foreground';

  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-2">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <div className="shrink-0">{queue.icon}</div>
        <Badge className={cn('text-[10px]', stateColor)}>{queue.label}</Badge>
        <span className="text-sm font-medium text-foreground">{queue.items.length}</span>
        <span className="text-xs text-muted-foreground ml-auto">{queue.action}</span>
      </button>
      {expanded && (
        <CardContent className="pt-0 pb-3">
          <ScrollArea className="max-h-[500px]">
            <div className="space-y-2">
              {queue.items.map(item => (
                <InboxItemRow
                  key={item.id}
                  item={item}
                  queueState={queue.state}
                  onResolved={onItemResolved}
                />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

// ── Inline Item Row ─────────────────────────────────────

function InboxItemRow({ item, queueState, onResolved }: {
  item: InboxItem; queueState: CanonicalState; onResolved: () => void;
}) {
  const [mode, setMode] = useState<InlineMode>(null);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState(false);
  const qc = useQueryClient();

  const defaultMode = getDefaultMode(queueState);

  const handleSubmit = useCallback(async () => {
    const activeMode = mode || defaultMode;
    if (!activeMode) return;
    setSubmitting(true);

    try {
      if (activeMode === 'paste_transcript' || activeMode === 'paste_content') {
        // Save content to resource
        const { error } = await supabase.from('resources').update({
          content: input.trim(),
          content_length: input.trim().length,
          enrichment_status: 'not_enriched',
          failure_reason: null,
          last_status_change_at: new Date().toISOString(),
        } as any).eq('id', item.id);
        if (error) throw error;

        // Re-run enrichment
        await invokeEnrichResource(
          { resource_id: item.id, force: true },
          { componentName: 'ManualInputInbox', timeoutMs: 60000 },
        );
      } else if (activeMode === 'alt_url') {
        // Update URL and re-enrich
        const { error } = await supabase.from('resources').update({
          file_url: input.trim(),
          enrichment_status: 'not_enriched',
          failure_reason: null,
          failure_count: 0,
          last_status_change_at: new Date().toISOString(),
        } as any).eq('id', item.id);
        if (error) throw error;

        await invokeEnrichResource(
          { resource_id: item.id, force: true },
          { componentName: 'ManualInputInbox', timeoutMs: 60000 },
        );
      } else if (activeMode === 'metadata_only') {
        await supabase.from('resources').update({
          enrichment_status: 'deep_enriched',
          failure_reason: null,
          last_quality_tier: 'metadata_only',
          enriched_at: new Date().toISOString(),
          last_status_change_at: new Date().toISOString(),
        } as any).eq('id', item.id);
      } else if (activeMode === 'park') {
        // Just clear from active failures
        await supabase.from('resources').update({
          failure_reason: 'Parked for later — manual input deferred',
          last_status_change_at: new Date().toISOString(),
        } as any).eq('id', item.id);
      }

      setResolved(true);
      toast.success(`${item.title.slice(0, 40)} — updated`);
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['all-resources'] });
      onResolved();
    } catch (e: any) {
      toast.error(e.message || 'Failed to process');
    } finally {
      setSubmitting(false);
    }
  }, [mode, defaultMode, input, item, qc, onResolved]);

  if (resolved) {
    return (
      <div className="flex items-center gap-2 rounded px-3 py-2 bg-status-green/5 border border-status-green/20">
        <CheckCircle2 className="h-3.5 w-3.5 text-status-green shrink-0" />
        <span className="text-xs text-status-green font-medium truncate">{item.title}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">Submitted</span>
      </div>
    );
  }

  const isOpen = mode !== null;

  return (
    <div className="rounded border border-border px-3 py-2 space-y-2">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
            <span>{item.subtypeLabel}</span>
            <span>Score: {item.score}</span>
            <span>{item.status}</span>
            {item.failureCount > 0 && <span className="text-destructive">{item.failureCount} failures</span>}
            {item.audioJobStatus && <span>Audio: {item.audioJobStatus}</span>}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">{item.reason}</p>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-primary hover:underline flex items-center gap-0.5 mt-0.5">
              <ExternalLink className="h-2.5 w-2.5" /> {item.url.length > 60 ? item.url.slice(0, 58) + '…' : item.url}
            </a>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {!isOpen && (
            <>
              {(queueState === 'needs_transcript' || queueState === 'needs_pasted_content') && (
                <Button size="sm" variant="default" className="h-6 text-[10px] gap-1"
                  onClick={() => setMode(defaultMode)}>
                  <FileText className="h-2.5 w-2.5" /> Paste
                </Button>
              )}
              {queueState === 'needs_access_auth' && (
                <Button size="sm" variant="default" className="h-6 text-[10px] gap-1"
                  onClick={() => setMode('paste_content')}>
                  <Lock className="h-2.5 w-2.5" /> Paste Content
                </Button>
              )}
              {queueState === 'needs_alternate_source' && (
                <Button size="sm" variant="default" className="h-6 text-[10px] gap-1"
                  onClick={() => setMode('alt_url')}>
                  <ExternalLink className="h-2.5 w-2.5" /> New URL
                </Button>
              )}
              {queueState === 'metadata_only_candidate' && (
                <>
                  <Button size="sm" variant="default" className="h-6 text-[10px] gap-1"
                    onClick={() => { setMode('metadata_only'); }}>
                    <Bookmark className="h-2.5 w-2.5" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                    onClick={() => setMode('paste_content')}>
                    <FileText className="h-2.5 w-2.5" /> Improve
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1"
                onClick={() => setMode('park')}>
                <SkipForward className="h-2.5 w-2.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Inline input area */}
      {isOpen && mode !== 'metadata_only' && mode !== 'park' && (
        <div className="space-y-1.5">
          {(mode === 'paste_transcript' || mode === 'paste_content') && (
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={mode === 'paste_transcript' ? 'Paste full transcript here…' : 'Paste content here…'}
              className="text-xs min-h-[80px]"
              autoFocus
            />
          )}
          {mode === 'alt_url' && (
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="https://..."
              className="text-xs h-8"
              autoFocus
            />
          )}
          {input && (
            <p className="text-[10px] text-muted-foreground">
              {mode === 'alt_url' ? input.trim() : `${input.split(/\s+/).filter(Boolean).length} words`}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-6 text-[10px] gap-1" disabled={!input.trim() || submitting}
              onClick={handleSubmit}>
              {submitting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Send className="h-2.5 w-2.5" />}
              Submit & Re-enrich
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]"
              onClick={() => { setMode(null); setInput(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Confirm for metadata_only / park */}
      {isOpen && (mode === 'metadata_only' || mode === 'park') && (
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-muted-foreground flex-1">
            {mode === 'metadata_only'
              ? 'Accept as metadata-only? Resource will be marked complete with limited data.'
              : 'Park for later? Resource will be deprioritized.'}
          </p>
          <Button size="sm" className="h-6 text-[10px]" disabled={submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Confirm'}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]"
            onClick={() => setMode(null)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────

function getDefaultMode(state: CanonicalState): InlineMode {
  switch (state) {
    case 'needs_transcript': return 'paste_transcript';
    case 'needs_pasted_content': return 'paste_content';
    case 'needs_access_auth': return 'paste_content';
    case 'needs_alternate_source': return 'alt_url';
    case 'metadata_only_candidate': return 'metadata_only';
    default: return 'paste_content';
  }
}
