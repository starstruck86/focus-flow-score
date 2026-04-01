import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Loader2, Clock, Ban, Trash2 } from 'lucide-react';
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
    case 'complete': return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case 'failed': return <XCircle className="h-3 w-3 text-destructive" />;
    case 'processing': return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
    case 'skipped': return <Ban className="h-3 w-3 text-muted-foreground" />;
    default: return <Clock className="h-3 w-3 text-muted-foreground" />;
  }
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
      </div>

      {/* Scrollable item list */}
      <ScrollArea className="max-h-[200px] border rounded-md">
        <div className="p-2 space-y-0.5">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2 py-1 px-2 rounded text-xs hover:bg-muted/50">
              {statusIcon(item.status)}
              <span className="flex-1 truncate">{item.episode_title}</span>
              {item.error_message && item.status === 'failed' && (
                <span className="text-[10px] text-destructive truncate max-w-[150px]">{item.error_message}</span>
              )}
            </div>
          ))}
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
