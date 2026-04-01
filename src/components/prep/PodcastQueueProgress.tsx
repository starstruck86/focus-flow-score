import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Loader2, Clock, Ban, Trash2, Brain, AlertTriangle } from 'lucide-react';
import type { QueueItem, QueueStats } from '@/hooks/usePodcastQueue';

interface PodcastQueueProgressProps {
  items: QueueItem[];
  stats: QueueStats;
  isActive: boolean;
  isDone: boolean;
  onCancel: () => void;
  onClear: () => void;
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

const transcriptLabel = (status: string | null) => {
  if (!status || status === 'pending') return null;
  const labels: Record<string, { text: string; color: string }> = {
    resolving_link: { text: 'Resolving…', color: 'text-yellow-500' },
    audio_resolved: { text: 'Audio found', color: 'text-blue-500' },
    transcribing: { text: 'Transcribing…', color: 'text-yellow-500' },
    transcript_ready: { text: 'Transcript ✓', color: 'text-green-500' },
    transcript_found: { text: 'Transcript ✓', color: 'text-green-500' },
    transcript_failed: { text: 'Failed', color: 'text-destructive' },
    transcript_unavailable: { text: 'Unavailable', color: 'text-muted-foreground' },
    skipped_duplicate: { text: 'Duplicate', color: 'text-muted-foreground' },
  };
  return labels[status] || { text: status, color: 'text-muted-foreground' };
};

const kiLabel = (kiStatus: string | null, kiCount: number) => {
  if (!kiStatus || kiStatus === 'pending') return null;
  switch (kiStatus) {
    case 'extracting': return { text: 'Extracting KIs…', color: 'text-yellow-500' };
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
  };
  return labels[type] || type;
};

export function PodcastQueueProgress({ items, stats, isActive, isDone, onCancel, onClear }: PodcastQueueProgressProps) {
  const progressPct = stats.total > 0
    ? Math.round(((stats.complete + stats.failed + stats.skipped) / stats.total) * 100)
    : 0;

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
        {stats.totalKIs > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1 border-green-500/30">
            <Brain className="h-3 w-3 text-green-500" />
            {stats.totalKIs} KIs
          </Badge>
        )}
      </div>

      {/* Scrollable item list */}
      <ScrollArea className="max-h-[200px] border rounded-md">
        <div className="p-2 space-y-0.5">
          {items.map(item => {
            const platform = platformLabel(item.platform);
            const transcript = transcriptLabel(item.transcript_status);
            const ki = kiLabel(item.ki_status, item.ki_count);
            const failure = item.status === 'failed' ? failureLabel(item.failure_type) : null;

            return (
              <div key={item.id} className="flex items-center gap-2 py-1 px-2 rounded text-xs hover:bg-muted/50">
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
                  {!failure && item.error_message && item.status === 'failed' && (
                    <span className="text-[10px] text-destructive truncate max-w-[120px]">{item.error_message}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="flex items-center gap-2">
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
        {isActive && (
          <p className="text-[10px] text-muted-foreground">
            ✓ Safe to close browser — import continues server-side
          </p>
        )}
      </div>
    </div>
  );
}
