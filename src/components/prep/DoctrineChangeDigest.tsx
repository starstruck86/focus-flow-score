/**
 * Doctrine Change Digest — operator-facing "what changed?" view.
 *
 * Groups meaningful changes by time window (today, 7d, 30d).
 */

import { memo, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { History, Filter } from 'lucide-react';
import { loadChangelog, type DoctrineChangeEvent, type ChangeEventType } from '@/lib/salesBrain';
import { cn } from '@/lib/utils';

type TimeWindow = 'today' | '7d' | '30d';

const EVENT_COLORS: Partial<Record<ChangeEventType, string>> = {
  doctrine_approved: 'text-status-green',
  doctrine_rejected: 'text-destructive',
  doctrine_merged: 'text-primary',
  doctrine_created: 'text-status-yellow',
  doctrine_reinforced: 'text-primary',
  insight_created: 'text-muted-foreground',
  resource_ingested: 'text-muted-foreground',
  propagation_changed: 'text-status-yellow',
  confidence_adjusted: 'text-muted-foreground',
  duplicate_detected: 'text-status-yellow',
  conflict_detected: 'text-destructive',
};

export const DoctrineChangeDigest = memo(function DoctrineChangeDigest() {
  const [window, setWindow] = useState<TimeWindow>('7d');
  const allEvents = useMemo(() => loadChangelog(), []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoffs: Record<TimeWindow, number> = {
      today: now - 86400000,
      '7d': now - 7 * 86400000,
      '30d': now - 30 * 86400000,
    };
    return allEvents.filter(e => new Date(e.timestamp).getTime() > cutoffs[window]);
  }, [allEvents, window]);

  // Group by event type
  const grouped = useMemo(() => {
    const map = new Map<ChangeEventType, DoctrineChangeEvent[]>();
    for (const e of filtered) {
      const existing = map.get(e.eventType) || [];
      existing.push(e);
      map.set(e.eventType, existing);
    }
    return map;
  }, [filtered]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            What Changed?
          </CardTitle>
          <div className="flex gap-1">
            {(['today', '7d', '30d'] as TimeWindow[]).map(w => (
              <Button
                key={w}
                size="sm"
                variant={window === w ? 'default' : 'ghost'}
                className="h-5 text-[10px] px-2"
                onClick={() => setWindow(w)}
              >
                {w === 'today' ? 'Today' : w}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No changes in this period</p>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-3">
              {/* Summary counts */}
              <div className="flex gap-2 flex-wrap">
                {Array.from(grouped.entries()).map(([type, events]) => (
                  <Badge key={type} variant="outline" className={cn('text-[9px]', EVENT_COLORS[type])}>
                    {type.replace(/_/g, ' ')} ({events.length})
                  </Badge>
                ))}
              </div>

              {/* Event list */}
              <div className="space-y-1">
                {filtered.slice(0, 50).map(event => (
                  <div key={event.id} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0 w-[50px] text-[10px]">
                      {new Date(event.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <Badge variant="outline" className={cn('text-[8px] shrink-0', EVENT_COLORS[event.eventType])}>
                      {event.eventType.replace(/_/g, ' ')}
                    </Badge>
                    <span className="text-foreground truncate text-[11px]">{event.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
});
