import { format, parseISO, differenceInDays, isValid } from 'date-fns';
import { cn } from '@/lib/utils';

/** Safely parse & format a date string, returning fallback on invalid dates */
export function safeFormat(dateStr: string | undefined | null, fmt: string, fallback = '—'): string {
  if (!dateStr) return fallback;
  try {
    const d = parseISO(dateStr);
    return isValid(d) ? format(d, fmt) : fallback;
  } catch {
    return fallback;
  }
}

/** Safely compute days since a date string */
export function safeDaysSince(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  try {
    const d = parseISO(dateStr);
    return isValid(d) ? differenceInDays(new Date(), d) : null;
  } catch {
    return null;
  }
}

/** Color-coded "Xd ago" indicator */
export function LastTouchIndicator({ date }: { date?: string }) {
  const days = safeDaysSince(date);
  if (days === null) return <span className="text-xs text-muted-foreground">No touch</span>;
  const color = days <= 3 ? 'text-status-green' : days <= 7 ? 'text-status-yellow' : 'text-status-red';
  return <span className={cn("text-xs font-medium", color)}>{days}d ago</span>;
}
