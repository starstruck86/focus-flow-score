/**
 * Shared timezone + time formatting utilities.
 * Single source of truth for ET formatting used by dashboard and Dave.
 */
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export const APP_TIMEZONE = 'America/New_York';

/** Convert a UTC Date or ISO string to the app's timezone */
export function toAppTime(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return toZonedTime(d, APP_TIMEZONE);
}

/** Format a UTC date/string as "h:mm a" in the app timezone (ET) */
export function formatTimeET(date: Date | string): string {
  return format(toAppTime(date), 'h:mm a');
}

/** Format a UTC date/string as "h:mm a 'ET'" in the app timezone */
export function formatTimeETLabel(date: Date | string): string {
  return format(toAppTime(date), "h:mm a") + ' ET';
}

/** Get today's date string (YYYY-MM-DD) in the app timezone */
export function todayInAppTz(): string {
  return format(toAppTime(new Date()), 'yyyy-MM-dd');
}
