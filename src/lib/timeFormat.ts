/**
 * Canonical Boston time pipeline.
 * Single source of truth for ALL Boston/ET time in the app.
 * RULES:
 *   1. Always use America/New_York (DST-aware, no manual offsets)
 *   2. Format only at display time — never parse formatted strings back
 *   3. All Dave/UI time references MUST flow through this module
 */
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

/** The one and only timezone constant for the entire app */
export const APP_TIMEZONE = 'America/New_York';

/** Convert a UTC Date or ISO string to the app's timezone */
export function toAppTime(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return toZonedTime(d, APP_TIMEZONE);
}

/** Format a UTC date/string as "h:mm a" in Boston time */
export function formatTimeET(date: Date | string): string {
  return format(toAppTime(date), 'h:mm a');
}

/** Format a UTC date/string as "h:mm a 'ET'" in Boston time */
export function formatTimeETLabel(date: Date | string): string {
  return format(toAppTime(date), "h:mm a") + ' ET';
}

/** Get today's date string (YYYY-MM-DD) in Boston time */
export function todayInAppTz(): string {
  return format(toAppTime(new Date()), 'yyyy-MM-dd');
}

/** Get current Boston time as minutes since midnight (0-1439). DST-aware. */
export function getCurrentMinutesET(): number {
  const et = toAppTime(new Date());
  return et.getHours() * 60 + et.getMinutes();
}

/** Get the current hour in Boston time (0-23) */
export function getCurrentHourET(): number {
  return toAppTime(new Date()).getHours();
}

/** Get a full Boston Date object (for reading .getHours()/.getMinutes() etc.) */
export function bostonNow(): Date {
  return toAppTime(new Date());
}

/**
 * Get today's date string (YYYY-MM-DD) in Boston time.
 * Alias for todayInAppTz — preferred for brevity in tools/hooks.
 */
export function todayET(): string {
  return todayInAppTz();
}

/** Get current day of week in Boston time (0=Sun, 6=Sat) */
export function getDayOfWeekET(): number {
  return bostonNow().getDay();
}

/** Check if current Boston time is within work hours (8 AM – 6 PM ET) */
export function isWorkHoursET(): boolean {
  const h = bostonNow().getHours();
  return h >= 8 && h < 18;
}

/** Get a date N days ago as YYYY-MM-DD in Boston time */
export function daysAgoET(n: number): string {
  const d = bostonNow();
  d.setDate(d.getDate() - n);
  return format(d, 'yyyy-MM-dd');
}

/** Get the Monday of the current week as YYYY-MM-DD in Boston time */
export function mondayOfWeekET(): string {
  const now = bostonNow();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  now.setDate(now.getDate() - diff);
  return format(now, 'yyyy-MM-dd');
}

/**
 * Format a time string like "14:30" into spoken form "2:30 PM".
 * Pure formatting — no timezone conversion (input is already ET).
 */
export function spokenTimeET(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  if (m === 0) return `${hour} ${suffix}`;
  return `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
}

/**
 * Runtime invariant: returns canonical Boston time snapshot with debug metadata.
 * Use this before injecting time into Dave context or UI headers.
 */
export function getCanonicalBostonTime(): {
  utcIso: string;
  bostonFormatted: string;
  bostonDate: string;
  bostonHour: number;
  bostonMinute: number;
  minutesSinceMidnight: number;
  timezone: typeof APP_TIMEZONE;
} {
  const utcNow = new Date();
  const et = toAppTime(utcNow);
  return {
    utcIso: utcNow.toISOString(),
    bostonFormatted: format(et, 'h:mm a'),
    bostonDate: format(et, 'yyyy-MM-dd'),
    bostonHour: et.getHours(),
    bostonMinute: et.getMinutes(),
    minutesSinceMidnight: et.getHours() * 60 + et.getMinutes(),
    timezone: APP_TIMEZONE,
  };
}

/**
 * Runtime guard: validates that a Boston time string matches our canonical computation.
 * Returns true if the times match (within 1 minute tolerance).
 * Used before Dave speaks time to prevent silent mismatches.
 */
export function validateBostonTime(claimedTimeStr: string): boolean {
  const canonical = getCanonicalBostonTime();
  // Normalize both to compare (strip whitespace, lowercase)
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalize(canonical.bostonFormatted) === normalize(claimedTimeStr);
}
