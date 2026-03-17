import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_TIMEZONE = 'America/New_York';
const WINDOWS_TIMEZONE_MAP: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
};

interface CalendarEvent {
  external_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  location: string | null;
  all_day: boolean;
  user_id: string;
}

interface RawEvent {
  uid: string;
  title: string | null;
  description: string | null;
  start_time: Date;
  end_time: Date | null;
  location: string | null;
  all_day: boolean;
  rrule: string | null;
  recurrenceId: Date | null;
  exdates: Date[];
  duration: number; // in milliseconds
  timezone: string | null;
}

interface ParsedICSDate {
  date: Date;
  allDay: boolean;
  timeZone: string | null;
}

function normalizeTimeZone(timeZone: string | null): string {
  if (!timeZone) return DEFAULT_TIMEZONE;

  const normalized = timeZone.trim().replace(/\\/g, '');
  const mappedWindowsZone = WINDOWS_TIMEZONE_MAP[normalized];
  if (mappedWindowsZone) return mappedWindowsZone;

  if (
    normalized.includes('Eastern') ||
    normalized.includes('New_York')
  ) {
    return DEFAULT_TIMEZONE;
  }

  if (normalized === 'UTC' || normalized === 'Etc/UTC' || normalized === 'GMT') {
    return 'UTC';
  }

  return normalized;
}

function getTimeZoneOffsetMinutes(date: Date, rawTimeZone: string | null): number {
  const timeZone = normalizeTimeZone(rawTimeZone);
  if (timeZone === 'UTC') return 0;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const offsetLabel = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  if (offsetLabel === 'GMT' || offsetLabel === 'UTC') return 0;

  const match = offsetLabel.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  return hours * 60 + Math.sign(hours || 1) * minutes;
}

function createUtcDateFromTimeZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  rawTimeZone: string | null,
): Date {
  const timeZone = normalizeTimeZone(rawTimeZone);
  if (timeZone === 'UTC') {
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  let utcMillis = Date.UTC(year, month, day, hour, minute, second);

  for (let i = 0; i < 3; i++) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    const nextUtcMillis = Date.UTC(year, month, day, hour, minute, second) - offsetMinutes * 60 * 1000;

    if (nextUtcMillis === utcMillis) break;
    utcMillis = nextUtcMillis;
  }

  return new Date(utcMillis);
}

function getTimeZoneParts(date: Date, rawTimeZone: string | null) {
  const timeZone = normalizeTimeZone(rawTimeZone);

  if (timeZone === 'UTC') {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      weekday: date.getUTCDay(),
    };
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '0';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: parseInt(getPart('year'), 10),
    month: parseInt(getPart('month'), 10),
    day: parseInt(getPart('day'), 10),
    hour: parseInt(getPart('hour'), 10),
    minute: parseInt(getPart('minute'), 10),
    second: parseInt(getPart('second'), 10),
    weekday: weekdayMap[getPart('weekday')] ?? 0,
  };
}

function toWallClockDate(date: Date, rawTimeZone: string | null): Date {
  const parts = getTimeZoneParts(date, rawTimeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

function fromWallClockDate(date: Date, rawTimeZone: string | null): Date {
  return createUtcDateFromTimeZone(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    rawTimeZone,
  );
}

function parseICSDate(dateStr: string, keyPart: string): ParsedICSDate {
  const tzidMatch = keyPart.match(/TZID=([^;:]+)/i);
  const timeZone = normalizeTimeZone(tzidMatch ? tzidMatch[1] : null);
  const cleanDate = dateStr;

  if (cleanDate.length === 8) {
    const year = parseInt(cleanDate.slice(0, 4));
    const month = parseInt(cleanDate.slice(4, 6)) - 1;
    const day = parseInt(cleanDate.slice(6, 8));
    return { date: new Date(Date.UTC(year, month, day, 0, 0, 0)), allDay: true, timeZone };
  }

  const year = parseInt(cleanDate.slice(0, 4));
  const month = parseInt(cleanDate.slice(4, 6)) - 1;
  const day = parseInt(cleanDate.slice(6, 8));
  const hour = parseInt(cleanDate.slice(9, 11)) || 0;
  const minute = parseInt(cleanDate.slice(11, 13)) || 0;
  const second = parseInt(cleanDate.slice(13, 15)) || 0;

  if (cleanDate.endsWith('Z')) {
    return {
      date: new Date(Date.UTC(year, month, day, hour, minute, second)),
      allDay: false,
      timeZone: 'UTC',
    };
  }

  return {
    date: createUtcDateFromTimeZone(year, month, day, hour, minute, second, timeZone),
    allDay: false,
    timeZone,
  };
}

function parseRRule(rrule: string, startDate: Date, endRange: Date, rawTimeZone: string | null): Date[] {
  const occurrences: Date[] = [];
  const parts: Record<string, string> = {};

  rrule.split(';').forEach(part => {
    const [key, value] = part.split('=');
    if (key && value) parts[key] = value;
  });

  const freq = parts['FREQ'];
  const interval = parseInt(parts['INTERVAL'] || '1');
  const count = parts['COUNT'] ? parseInt(parts['COUNT']) : null;
  const until = parts['UNTIL'] ? parseICSDate(parts['UNTIL'], '').date : null;
  const byDayRaw = parts['BYDAY']?.split(',') || [];

  const dayMap: Record<string, number> = {
    'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
  };

  const parsedByDay = byDayRaw.map(raw => {
    const match = raw.match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!match) return null;
    return { ordinal: match[1] ? parseInt(match[1]) : null, day: dayMap[match[2]] };
  }).filter(Boolean) as { ordinal: number | null; day: number }[];

  const timeZone = normalizeTimeZone(rawTimeZone);
  const startWallClock = toWallClockDate(startDate, timeZone);
  let current = new Date(startWallClock);
  let occurrenceCount = 0;
  const maxOccurrences = count || 100;
  const effectiveEnd = until && until < endRange ? until : endRange;

  while (occurrenceCount < maxOccurrences) {
    if (freq === 'WEEKLY') {
      if (parsedByDay.length > 0) {
        for (const { day: targetDay } of parsedByDay) {
          const weekStart = new Date(current);
          weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());

          const occurrenceWallClock = new Date(weekStart);
          occurrenceWallClock.setUTCDate(occurrenceWallClock.getUTCDate() + targetDay);
          occurrenceWallClock.setUTCHours(
            startWallClock.getUTCHours(),
            startWallClock.getUTCMinutes(),
            startWallClock.getUTCSeconds(),
            0,
          );

          const occurrence = fromWallClockDate(occurrenceWallClock, timeZone);

          if (occurrence >= startDate && occurrence <= effectiveEnd) {
            occurrences.push(new Date(occurrence));
            occurrenceCount++;
            if (occurrenceCount >= maxOccurrences) break;
          }
        }

        if (current > toWallClockDate(effectiveEnd, timeZone)) break;
        current.setUTCDate(current.getUTCDate() + (7 * interval));
      } else {
        const occurrence = fromWallClockDate(current, timeZone);
        if (occurrence >= startDate && occurrence <= effectiveEnd) {
          occurrences.push(new Date(occurrence));
          occurrenceCount++;
        }
        current.setUTCDate(current.getUTCDate() + (7 * interval));
      }
    } else if (freq === 'DAILY') {
      const occurrence = fromWallClockDate(current, timeZone);
      if (occurrence >= startDate && occurrence <= effectiveEnd) {
        occurrences.push(new Date(occurrence));
        occurrenceCount++;
      }
      current.setUTCDate(current.getUTCDate() + interval);
    } else if (freq === 'MONTHLY') {
      if (parsedByDay.length > 0 && parsedByDay[0].ordinal !== null) {
        const { ordinal, day: targetDay } = parsedByDay[0];
        const year = current.getUTCFullYear();
        const month = current.getUTCMonth();

        let candidateWallClock: Date | null = null;
        if ((ordinal ?? 0) > 0) {
          const firstOfMonth = new Date(Date.UTC(
            year,
            month,
            1,
            startWallClock.getUTCHours(),
            startWallClock.getUTCMinutes(),
            startWallClock.getUTCSeconds(),
          ));
          const firstDow = firstOfMonth.getUTCDay();
          let dayOffset = targetDay - firstDow;
          if (dayOffset < 0) dayOffset += 7;
          const nthDay = 1 + dayOffset + ((ordinal as number) - 1) * 7;
          const candidate = new Date(Date.UTC(
            year,
            month,
            nthDay,
            startWallClock.getUTCHours(),
            startWallClock.getUTCMinutes(),
            startWallClock.getUTCSeconds(),
          ));
          if (candidate.getUTCMonth() === month) {
            candidateWallClock = candidate;
          }
        } else if (ordinal === -1) {
          const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
          let d = lastOfMonth.getUTCDate();
          while (new Date(Date.UTC(year, month, d)).getUTCDay() !== targetDay && d > 0) d--;
          if (d > 0) {
            candidateWallClock = new Date(Date.UTC(
              year,
              month,
              d,
              startWallClock.getUTCHours(),
              startWallClock.getUTCMinutes(),
              startWallClock.getUTCSeconds(),
            ));
          }
        }

        if (candidateWallClock) {
          const occurrence = fromWallClockDate(candidateWallClock, timeZone);
          if (occurrence >= startDate && occurrence <= effectiveEnd) {
            occurrences.push(new Date(occurrence));
            occurrenceCount++;
          }
        }

        current.setUTCMonth(current.getUTCMonth() + interval);
      } else {
        const occurrence = fromWallClockDate(current, timeZone);
        if (occurrence >= startDate && occurrence <= effectiveEnd) {
          occurrences.push(new Date(occurrence));
          occurrenceCount++;
        }
        current.setUTCMonth(current.getUTCMonth() + interval);
      }
    } else {
      const occurrence = fromWallClockDate(current, timeZone);
      if (occurrence <= effectiveEnd) {
        occurrences.push(new Date(occurrence));
      }
      break;
    }

    if (current > toWallClockDate(effectiveEnd, timeZone)) {
      break;
    }
  }

  return occurrences;
}

function parseICS(icsContent: string): RawEvent[] {
  const events: RawEvent[] = [];
  const unfoldedContent = icsContent.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfoldedContent.split(/\r\n|\n/);

  let currentEvent: Partial<RawEvent> | null = null;
  let allDay = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      currentEvent = { exdates: [] };
      allDay = false;
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.uid && currentEvent.title && currentEvent.start_time) {
        const duration = currentEvent.end_time
          ? currentEvent.end_time.getTime() - currentEvent.start_time.getTime()
          : 3600000; // default 1 hour

        events.push({
          uid: currentEvent.uid,
          title: currentEvent.title,
          description: currentEvent.description || null,
          start_time: currentEvent.start_time,
          end_time: currentEvent.end_time || null,
          location: currentEvent.location || null,
          all_day: allDay,
          rrule: currentEvent.rrule || null,
          recurrenceId: currentEvent.recurrenceId || null,
          exdates: currentEvent.exdates || [],
          duration,
          timezone: currentEvent.timezone || null,
        });
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const keyPart = line.slice(0, colonIndex);
      const value = line.slice(colonIndex + 1);
      const key = keyPart.split(';')[0];

      switch (key) {
        case 'UID':
          currentEvent.uid = value;
          break;
        case 'RECURRENCE-ID': {
          const recurrence = parseICSDate(value, keyPart);
          currentEvent.recurrenceId = recurrence.date;
          break;
        }
        case 'RRULE':
          currentEvent.rrule = value;
          break;
        case 'EXDATE': {
          const exdate = parseICSDate(value, keyPart);
          currentEvent.exdates = currentEvent.exdates || [];
          currentEvent.exdates.push(exdate.date);
          break;
        }
        case 'SUMMARY':
          currentEvent.title = value;
          break;
        case 'DESCRIPTION':
          currentEvent.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
          break;
        case 'DTSTART': {
          const start = parseICSDate(value, keyPart);
          currentEvent.start_time = start.date;
          currentEvent.timezone = start.timeZone;
          allDay = start.allDay;
          break;
        }
        case 'DTEND': {
          const end = parseICSDate(value, keyPart);
          currentEvent.end_time = end.date;
          break;
        }
        case 'LOCATION':
          currentEvent.location = value;
          break;
      }
    }
  }

  return events;
}

function expandRecurringEvents(rawEvents: RawEvent[], rangeStart: Date, rangeEnd: Date, userId: string): CalendarEvent[] {
  const expandedEvents: CalendarEvent[] = [];
  const overrides = new Map<string, RawEvent>();
  const baseEventsByUid = new Map<string, RawEvent>();

  const overrideKeyFor = (uid: string, recurrenceDate: Date) => `${uid}_${recurrenceDate.toISOString()}`;

  for (const event of rawEvents) {
    if (event.rrule && !event.recurrenceId) {
      baseEventsByUid.set(event.uid, event);
    }
    if (event.recurrenceId) {
      overrides.set(overrideKeyFor(event.uid, event.recurrenceId), event);
    }
  }

  for (const event of rawEvents) {
    if (event.recurrenceId) {
      const baseEvent = baseEventsByUid.get(event.uid);
      const fallbackDuration = baseEvent?.duration ?? 3600000;
      const fallbackEndTime = event.end_time
        ? event.end_time
        : new Date(event.start_time.getTime() + fallbackDuration);

      expandedEvents.push({
        external_id: `${event.uid}_${event.start_time.toISOString()}`,
        title: event.title ?? baseEvent?.title ?? 'Untitled event',
        description: event.description ?? baseEvent?.description ?? null,
        start_time: event.start_time.toISOString(),
        end_time: fallbackEndTime?.toISOString() || null,
        location: event.location ?? baseEvent?.location ?? null,
        all_day: event.all_day,
        user_id: userId,
      });
    } else if (event.rrule) {
      const occurrences = parseRRule(event.rrule, event.start_time, rangeEnd, event.timezone);

      for (const occurrence of occurrences) {
        if (occurrence < rangeStart) continue;

        const isExcluded = event.exdates.some(exdate => exdate.getTime() === occurrence.getTime());
        if (isExcluded) continue;

        const overrideKey = overrideKeyFor(event.uid, occurrence);
        if (overrides.has(overrideKey)) continue;

        const endTime = event.end_time
          ? new Date(occurrence.getTime() + event.duration)
          : null;

        expandedEvents.push({
          external_id: `${event.uid}_${occurrence.toISOString()}`,
          title: event.title ?? 'Untitled event',
          description: event.description,
          start_time: occurrence.toISOString(),
          end_time: endTime?.toISOString() || null,
          location: event.location,
          all_day: event.all_day,
          user_id: userId,
        });
      }
    } else {
      expandedEvents.push({
        external_id: `${event.uid}_${event.start_time.toISOString()}`,
        title: event.title ?? 'Untitled event',
        description: event.description,
        start_time: event.start_time.toISOString(),
        end_time: event.end_time?.toISOString() || null,
        location: event.location,
        all_day: event.all_day,
        user_id: userId,
      });
    }
  }

  const uniqueEvents = new Map<string, CalendarEvent>();
  for (const event of expandedEvents) {
    uniqueEvents.set(event.external_id, event);
  }

  return Array.from(uniqueEvents.values());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub as string;

    const icsUrl = Deno.env.get('OUTLOOK_ICS_URL');
    if (!icsUrl) {
      throw new Error('OUTLOOK_ICS_URL is not configured');
    }

    console.log('Fetching ICS for user:', userId);

    const icsResponse = await fetch(icsUrl);
    if (!icsResponse.ok) {
      throw new Error(`Failed to fetch ICS: ${icsResponse.status} ${icsResponse.statusText}`);
    }

    const icsContent = await icsResponse.text();
    console.log('ICS content length:', icsContent.length);

    const rawEvents = parseICS(icsContent);
    console.log('Raw events parsed:', rawEvents.length);
    console.log('Events with RRULE:', rawEvents.filter(e => e.rrule).length);

    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const allEvents = expandRecurringEvents(rawEvents, now, rangeEnd, userId);
    console.log('Expanded events:', allEvents.length);

    const futureEvents = allEvents.filter(event => new Date(event.start_time) >= now);
    console.log('Future events:', futureEvents.length);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (futureEvents.length > 0) {
      await supabase.from('calendar_events').delete().eq('user_id', userId);

      for (let i = 0; i < futureEvents.length; i += 100) {
        const chunk = futureEvents.slice(i, i + 100);
        const { error } = await supabase
          .from('calendar_events')
          .upsert(chunk, { onConflict: 'external_id' });
        if (error) throw error;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: futureEvents.length,
        message: `Synced ${futureEvents.length} upcoming events`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});