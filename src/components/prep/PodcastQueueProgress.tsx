import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CheckCircle2, XCircle, Loader2, Clock, Ban, Trash2, Brain, AlertTriangle, ChevronDown, ChevronRight, Sparkles, FileText, ShieldCheck, Eye, ThumbsDown, RefreshCw, Filter } from 'lucide-react';
import type { QueueItem, QueueStats } from '@/hooks/usePodcastQueue';

type FilterMode = 'all' | 'awaiting' | 'approved' | 'rejected';

const REJECT_REASONS = [
  'Too messy',
  'Too generic',
  'Bad structure',
  'Wrong content',
];

interface PodcastQueueProgressProps {
  items: QueueItem[];
  stats: QueueStats;
  isActive: boolean;
  isDone: boolean;
  onCancel: () => void;
  onClear: () => void;
  onGenerateKIs?: (queueItemId: string) => void;
  onGenerateAllKIs?: () => void;
  onApproveTranscript?: (queueItemId: string) => void;
  onApproveAllTranscripts?: () => void;
  onRejectTranscript?: (queueItemId: string, reason?: string) => void;
  onReprocessTranscript?: (queueItemId: string) => void;
  generatingKIs?: Set<string>;
}

const statusIcon = (status: QueueItem['status']) => {
  switch (status) {
    case 'complete': return <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />;
    case 'failed': return <XCircle className="h-3 w-3 text-destructive shrink-0" />;
    case 'processing': return <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />;
    case 'skipped': return <Ban className="h-3 w-3 text-muted-foreground shrink-0" />;
    default: return <Clock className="h-3 w-3 text-muted-foreground shrink-0" />;
  }
};

const platformLabel = (platform: string | null) => {
  if (!platform || platform === 'unknown') return null;
  const labels: Record<string, string> = {
    spotify: 'Spotify', apple: 'Apple', youtube: 'YouTube', anchor: 'Anchor',
    buzzsprout: 'Buzzsprout', libsyn: 'Libsyn', podbean: 'Podbean',
    transistor: 'Transistor', simplecast: 'Simplecast', direct_audio: 'Audio',
    rss_direct: 'RSS',
  };
  return labels[platform] || platform;
};

const transcriptStatusLabel = (status: string | null) => {
  if (!status || status === 'pending') return null;
  const labels: Record<string, { text: string; color: string }> = {
    resolving_link: { text: 'Resolving…', color: 'text-yellow-500' },
    audio_resolved: { text: 'Audio found', color: 'text-blue-500' },
    transcribing: { text: 'Transcribing…', color: 'text-yellow-500' },
    transcript_ready: { text: 'Raw ✓', color: 'text-green-500' },
    transcript_structured: { text: 'Structured ✓', color: 'text-green-500' },
    transcript_found: { text: 'Transcript ✓', color: 'text-green-500' },
    transcript_failed: { text: 'Failed', color: 'text-destructive' },
    transcript_unavailable: { text: 'Unavailable', color: 'text-muted-foreground' },
    skipped_duplicate: { text: 'Duplicate', color: 'text-muted-foreground' },
  };
  return labels[status] || { text: status, color: 'text-muted-foreground' };
};

const kiStatusLabel = (kiStatus: string | null, kiCount: number) => {
  if (!kiStatus || kiStatus === 'pending') return null;
  switch (kiStatus) {
    case 'awaiting_approval': return { text: 'Needs approval', color: 'text-amber-500' };
    case 'ready_for_review': return { text: 'Approved', color: 'text-blue-500' };
    case 'rejected': return { text: 'Rejected', color: 'text-destructive' };
    case 'extracting': return { text: 'Extracting…', color: 'text-yellow-500' };
    case 'extracted': return { text: `${kiCount} KI${kiCount !== 1 ? 's' : ''}`, color: 'text-green-500' };
    case 'ki_failed': return { text: 'KI failed', color: 'text-destructive' };
    case 'skipped': return { text: 'Skipped', color: 'text-muted-foreground' };
    default: return null;
  }
};

const failureLabel = (type: string | null) => {
  if (!type) return null;
  const labels: Record<string, string> = {
    content_invalid: 'Invalid content',
    content_invalid_html: 'HTML junk',
    content_invalid_css: 'CSS junk',
    content_bot_or_login_wall: 'Login wall',
    content_ui_fragments: 'UI fragments',
    content_too_short: 'Too short',
    transcript_unavailable_from_link: 'No transcript',
    audio_unresolvable: 'No audio',
    extraction_blocked: 'Save error',
    preprocess_invalid: 'Bad preprocessing',
  };
  return labels[type] || type;
};

function formatBytes(chars: number): string {
  if (chars < 1000) return `${chars} chars`;
  return `${(chars / 1000).toFixed(1)}K chars`;
}

export function PodcastQueueProgress({
  items, stats, isActive, isDone, onCancel, onClear,
  onGenerateKIs, onGenerateAllKIs, onApproveTranscript, onApproveAllTranscripts,
  onRejectTranscript, onReprocessTranscript, generatingKIs,
}: PodcastQueueProgressProps) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');

  const progressPct = stats.total > 0
    ? Math.round(((stats.complete + stats.failed + stats.skipped) / stats.total) * 100)
    : 0;

  const filteredItems = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'awaiting') return item.ki_status === 'awaiting_approval';
    if (filter === 'approved') return item.ki_status === 'ready_for_review';
    if (filter === 'rejected') return item.ki_status === 'rejected';
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {isActive ? 'Server-side import running...' : isDone ? 'Import complete' : 'Queued for processing'}
          </span>
          <span className="font-medium">{stats.complete + stats.failed + stats.skipped}/{stats.total}</span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      {/* Stats badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {stats.complete > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            {stats.complete} complete
          </Badge>
        )}
        {stats.processing > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            {stats.processing} processing
          </Badge>
        )}
        {stats.queued > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <Clock className="h-3 w-3" />
            {stats.queued} queued
          </Badge>
        )}
        {stats.failed > 0 && (
          <Badge variant="destructive" className="text-[10px] gap-1">
            <XCircle className="h-3 w-3" />
            {stats.failed} failed
          </Badge>
        )}
        {stats.awaitingApproval > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/30">
            <Eye className="h-3 w-3 text-amber-500" />
            {stats.awaitingApproval} needs review
          </Badge>
        )}
        {stats.readyForKI > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1 border-blue-500/30">
            <FileText className="h-3 w-3 text-blue-500" />
            {stats.readyForKI} ready for KI
          </Badge>
        )}
        {stats.rejected > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1 border-destructive/30">
            <ThumbsDown className="h-3 w-3 text-destructive" />
            {stats.rejected} rejected
          </Badge>
        )}
        {stats.totalKIs > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1 border-green-500/30">
            <Brain className="h-3 w-3 text-green-500" />
            {stats.totalKIs} KIs
          </Badge>
        )}
      </div>

      {/* Filter tabs */}
      {(stats.awaitingApproval > 0 || stats.rejected > 0 || stats.readyForKI > 0) && (
        <div className="flex items-center gap-1 text-[10px]">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {(['all', 'awaiting', 'approved', 'rejected'] as FilterMode[]).map(f => {
            const count = f === 'all' ? items.length : f === 'awaiting' ? stats.awaitingApproval : f === 'approved' ? stats.readyForKI : stats.rejected;
            if (f !== 'all' && count === 0) return null;
            return (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'ghost'}
                size="sm"
                className="text-[10px] h-5 px-2"
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'awaiting' ? 'Needs Review' : f === 'approved' ? 'Approved' : 'Rejected'}
                {count > 0 && ` (${count})`}
              </Button>
            );
          })}
        </div>
      )}

      {/* Scrollable item list */}
      <ScrollArea className="max-h-[280px] border rounded-md">
        <div className="p-2 space-y-0.5">
          {filteredItems.map(item => {
            const platform = platformLabel(item.platform);
            const transcript = transcriptStatusLabel(item.transcript_status);
            const ki = kiStatusLabel(item.ki_status, item.ki_count);
            const failure = item.status === 'failed' ? failureLabel(item.failure_type) : null;
            const isExpanded = expandedItem === item.id;
            const isGenerating = generatingKIs?.has(item.id);
            const canApprove = item.ki_status === 'awaiting_approval' && item.resource_id;
            const canReject = item.ki_status === 'awaiting_approval' && item.resource_id;
            const canGenerateKI = item.ki_status === 'ready_for_review' && item.resource_id && !isGenerating;
            const isRejected = item.ki_status === 'rejected';

            return (
              <Collapsible key={item.id} open={isExpanded} onOpenChange={() => setExpandedItem(isExpanded ? null : item.id)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center gap-2 py-1.5 px-2 rounded text-xs hover:bg-muted/50 cursor-pointer">
                    {statusIcon(item.status)}
                    <span className="flex-1 truncate">{item.episode_title}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {platform && (
                        <span className="text-[10px] text-muted-foreground">{platform}</span>
                      )}
                      {transcript && (
                        <span className={`text-[10px] ${transcript.color}`}>{transcript.text}</span>
                      )}
                      {ki && (
                        <span className={`text-[10px] ${ki.color}`}>{ki.text}</span>
                      )}
                      {failure && (
                        <span className="text-[10px] text-destructive flex items-center gap-0.5">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {failure}
                        </span>
                      )}
                      {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="ml-5 pl-2 border-l border-border space-y-2 py-2 text-[11px]">
                    {/* Transcript stats */}
                    {(item.transcript_length > 0 || item.transcript_section_count > 0) && (
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{formatBytes(item.transcript_length)}</span>
                        {item.transcript_section_count > 0 && (
                          <span>{item.transcript_section_count} sections</span>
                        )}
                      </div>
                    )}

                    {/* Transcript preview */}
                    {item.transcript_preview && (
                      <div className="bg-muted/30 rounded p-2 text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-[120px] overflow-y-auto">
                        {item.transcript_preview}
                      </div>
                    )}

                    {/* Error / rejection message */}
                    {item.error_message && (
                      <div className="text-[10px] text-destructive">
                        {item.error_message}
                      </div>
                    )}

                    {/* Approve / Reject buttons */}
                    {canApprove && (
                      <div className="flex items-center gap-1.5">
                        {onApproveTranscript && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-[10px] h-6 gap-1"
                            onClick={(e) => { e.stopPropagation(); onApproveTranscript(item.id); }}
                          >
                            <ShieldCheck className="h-3 w-3" /> Approve
                          </Button>
                        )}
                        {canReject && onRejectTranscript && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-[10px] h-6 gap-1 text-destructive hover:text-destructive"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ThumbsDown className="h-3 w-3" /> Reject
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                              {REJECT_REASONS.map(reason => (
                                <DropdownMenuItem key={reason} onClick={() => onRejectTranscript(item.id, reason)}>
                                  {reason}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuItem onClick={() => onRejectTranscript(item.id)}>
                                No reason
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}

                    {/* Generate KIs button — only after approval, never for rejected */}
                    {canGenerateKI && onGenerateKIs && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[10px] h-6 gap-1"
                        onClick={(e) => { e.stopPropagation(); onGenerateKIs(item.id); }}
                      >
                        <Sparkles className="h-3 w-3" /> Generate KIs
                      </Button>
                    )}

                    {/* Reprocess button for rejected items */}
                    {isRejected && onReprocessTranscript && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[10px] h-6 gap-1"
                        onClick={(e) => { e.stopPropagation(); onReprocessTranscript(item.id); }}
                      >
                        <RefreshCw className="h-3 w-3" /> Reprocess Transcript
                      </Button>
                    )}

                    {isGenerating && (
                      <div className="flex items-center gap-1 text-[10px] text-yellow-500">
                        <Loader2 className="h-3 w-3 animate-spin" /> Extracting knowledge items…
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {isActive && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onCancel}>
            <Ban className="h-3 w-3" /> Cancel remaining
          </Button>
        )}
        {isDone && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onClear}>
            <Trash2 className="h-3 w-3" /> Clear queue
          </Button>
        )}
        {stats.awaitingApproval > 0 && onApproveAllTranscripts && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onApproveAllTranscripts}>
            <ShieldCheck className="h-3 w-3" /> Approve All ({stats.awaitingApproval})
          </Button>
        )}
        {stats.readyForKI > 0 && onGenerateAllKIs && (
          <Button variant="default" size="sm" className="text-xs gap-1" onClick={onGenerateAllKIs}>
            <Sparkles className="h-3 w-3" /> Generate KIs ({stats.readyForKI})
          </Button>
        )}
        {isActive && (
          <p className="text-[10px] text-muted-foreground">
            ✓ Safe to close browser — import continues server-side
          </p>
        )}
      </div>
    </div>
  );
}
