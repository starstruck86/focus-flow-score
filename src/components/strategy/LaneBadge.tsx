// ════════════════════════════════════════════════════════════════
// LaneBadge — inline pill showing the router-assigned lane
// for a given strategy assistant message.
// Pure presentational; uses semantic design tokens only.
// ════════════════════════════════════════════════════════════════

import { cn } from '@/lib/utils';

export type Lane = 'direct' | 'assisted' | 'deep_work';

export interface LaneBadgeProps {
  lane: Lane;
  className?: string;
}

const LANE_LABEL: Record<Lane, string> = {
  direct: 'Quick',
  assisted: 'Assisted',
  deep_work: 'Deep Work',
};

const LANE_CLASS: Record<Lane, string> = {
  direct: 'bg-muted text-muted-foreground',
  assisted: 'bg-secondary text-secondary-foreground',
  deep_work: 'bg-primary text-primary-foreground',
};

export function LaneBadge({ lane, className }: LaneBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        LANE_CLASS[lane],
        className,
      )}
      aria-label={`Routing lane: ${LANE_LABEL[lane]}`}
    >
      {LANE_LABEL[lane]}
    </span>
  );
}
