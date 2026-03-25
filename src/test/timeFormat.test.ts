import { describe, it, expect } from 'vitest';
import {
  toAppTime,
  formatTimeET,
  formatTimeETLabel,
  todayInAppTz,
  getCurrentMinutesET,
  bostonNow,
  spokenTimeET,
  getCanonicalBostonTime,
  validateBostonTime,
  APP_TIMEZONE,
} from '@/lib/timeFormat';

describe('timeFormat — canonical Boston time pipeline', () => {
  it('APP_TIMEZONE is America/New_York', () => {
    expect(APP_TIMEZONE).toBe('America/New_York');
  });

  // Winter: UTC-5 (EST)
  it('converts winter UTC to EST correctly', () => {
    // Jan 15 2025 18:03 UTC → Jan 15 2025 1:03 PM EST
    const utc = new Date('2025-01-15T18:03:00Z');
    const et = toAppTime(utc);
    expect(et.getHours()).toBe(13);
    expect(et.getMinutes()).toBe(3);
  });

  it('formats winter time correctly', () => {
    const result = formatTimeET('2025-01-15T18:03:00Z');
    expect(result).toBe('1:03 PM');
  });

  // Summer: UTC-4 (EDT)
  it('converts summer UTC to EDT correctly', () => {
    // Jul 15 2025 18:03 UTC → Jul 15 2025 2:03 PM EDT
    const utc = new Date('2025-07-15T18:03:00Z');
    const et = toAppTime(utc);
    expect(et.getHours()).toBe(14);
    expect(et.getMinutes()).toBe(3);
  });

  it('formats summer time correctly', () => {
    const result = formatTimeET('2025-07-15T18:03:00Z');
    expect(result).toBe('2:03 PM');
  });

  // DST spring forward: March 9 2025, 2:00 AM → 3:00 AM
  it('handles DST spring forward boundary', () => {
    // March 9 2025 06:30 UTC → 1:30 AM EST (before spring forward)
    const before = toAppTime(new Date('2025-03-09T06:30:00Z'));
    expect(before.getHours()).toBe(1);

    // March 9 2025 07:30 UTC → 3:30 AM EDT (after spring forward, skips 2 AM)
    const after = toAppTime(new Date('2025-03-09T07:30:00Z'));
    expect(after.getHours()).toBe(3);
  });

  // DST fall back: November 2 2025, 2:00 AM → 1:00 AM
  it('handles DST fall back boundary', () => {
    // Nov 2 2025 05:30 UTC → 1:30 AM EDT (before fall back)
    const before = toAppTime(new Date('2025-11-02T05:30:00Z'));
    expect(before.getHours()).toBe(1);

    // Nov 2 2025 07:30 UTC → 2:30 AM EST (after fall back)
    const after = toAppTime(new Date('2025-11-02T07:30:00Z'));
    expect(after.getHours()).toBe(2);
  });

  // Morning example: 8:03 AM Boston
  it('converts representative morning time correctly', () => {
    // 8:03 AM EST = 13:03 UTC in winter
    const result = formatTimeET('2025-02-10T13:03:00Z');
    expect(result).toBe('8:03 AM');
  });

  it('formatTimeETLabel appends ET', () => {
    const result = formatTimeETLabel('2025-02-10T13:03:00Z');
    expect(result).toBe('8:03 AM ET');
  });

  it('todayInAppTz returns YYYY-MM-DD format', () => {
    const today = todayInAppTz();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getCurrentMinutesET returns 0-1439', () => {
    const mins = getCurrentMinutesET();
    expect(mins).toBeGreaterThanOrEqual(0);
    expect(mins).toBeLessThan(1440);
  });

  it('bostonNow returns a Date', () => {
    expect(bostonNow()).toBeInstanceOf(Date);
  });

  it('spokenTimeET formats 24h to spoken', () => {
    expect(spokenTimeET('14:30')).toBe('2:30 PM');
    expect(spokenTimeET('09:00')).toBe('9 AM');
    expect(spokenTimeET('00:15')).toBe('12:15 AM');
    expect(spokenTimeET('12:00')).toBe('12 PM');
  });

  it('getCanonicalBostonTime returns valid snapshot', () => {
    const snap = getCanonicalBostonTime();
    expect(snap.timezone).toBe('America/New_York');
    expect(snap.utcIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snap.bostonDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snap.bostonHour).toBeGreaterThanOrEqual(0);
    expect(snap.bostonHour).toBeLessThan(24);
    expect(snap.minutesSinceMidnight).toBeGreaterThanOrEqual(0);
    expect(snap.minutesSinceMidnight).toBeLessThan(1440);
  });

  it('validateBostonTime matches canonical time', () => {
    const snap = getCanonicalBostonTime();
    expect(validateBostonTime(snap.bostonFormatted)).toBe(true);
    expect(validateBostonTime('99:99 ZZ')).toBe(false);
  });
});
