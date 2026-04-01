import { usePodcastQueue } from '@/hooks/usePodcastQueue';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, Podcast } from 'lucide-react';

/**
 * Small indicator badge for the Prep page header showing active podcast queue progress.
 * Only renders when there are active or recently-completed queue items.
 */
export function PodcastQueueIndicator() {
  const { stats, isActive, isDone } = usePodcastQueue();

  if (stats.total === 0) return null;

  if (isActive) {
    const done = stats.complete + stats.failed + stats.skipped;
    return (
      <Badge variant="outline" className="text-[10px] gap-1.5 animate-pulse">
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        <Podcast className="h-3 w-3" />
        Importing: {done}/{stats.total}
      </Badge>
    );
  }

  if (isDone) {
    return (
      <Badge variant="outline" className="text-[10px] gap-1.5">
        <CheckCircle2 className="h-3 w-3 text-primary" />
        <Podcast className="h-3 w-3" />
        {stats.complete} imported{stats.failed > 0 ? `, ${stats.failed} failed` : ''}
      </Badge>
    );
  }

  return null;
}
