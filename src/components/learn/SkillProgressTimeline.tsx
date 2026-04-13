/**
 * SkillProgressTimeline — Recent progression events (lightweight).
 */

import { getRecentLevelEvents, type LevelEvent } from '@/lib/learning/levelEventStore';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import { Clock, TrendingUp, Sparkles } from 'lucide-react';
import { useMemo } from 'react';

export function SkillProgressTimeline() {
  const events = useMemo(() => getRecentLevelEvents(8), []);

  if (events.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Recent Progress
        </p>
      </div>
      <div className="space-y-1">
        {events.map((event, i) => (
          <TimelineItem key={`${event.skill}-${event.timestamp}-${i}`} event={event} />
        ))}
      </div>
    </div>
  );
}

function TimelineItem({ event }: { event: LevelEvent }) {
  const label = SKILL_LABELS[event.skill as SkillFocus] ?? event.skill;
  const time = formatRelativeTime(event.timestamp);

  if (event.type === 'tier_up') {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-primary/5 border border-primary/10">
        <Sparkles className="h-3 w-3 text-primary shrink-0" />
        <p className="text-[11px] text-foreground flex-1">
          <span className="font-medium">{label}</span> → Tier {event.newTier}
        </p>
        <p className="text-[10px] text-muted-foreground shrink-0">{time}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/50">
      <TrendingUp className="h-3 w-3 text-muted-foreground shrink-0" />
      <p className="text-[11px] text-muted-foreground flex-1">
        <span className="font-medium text-foreground">{label}</span>
        {event.deltaProgress != null && ` +${event.deltaProgress}%`}
      </p>
      <p className="text-[10px] text-muted-foreground shrink-0">{time}</p>
    </div>
  );
}

function formatRelativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
