import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-trace-id',
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
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Singapore Standard Time': 'Asia/Singapore',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Helsinki',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Korea Standard Time': 'Asia/Seoul',
  'Arab Standard Time': 'Asia/Riyadh',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Pacific Standard Time': 'America/Bogota',
  'Mountain Standard Time (Mexico)': 'America/Chihuahua',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
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

  // Validate that the timezone is recognized by Intl before returning it
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized });
    return normalized;
  } catch {
    console.warn(`[TZ-WARN] Unrecognized timezone "${normalized}", falling back to ${DEFAULT_TIMEZONE}`);
    return DEFAULT_TIMEZONE;
  }
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

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getUtcDateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

function buildOccurrenceFromLocalDate(dateOnly: Date, template: ReturnType<typeof getTimeZoneParts>, rawTimeZone: string | null): Date {
  return createUtcDateFromTimeZone(
    dateOnly.getUTCFullYear(),
    dateOnly.getUTCMonth(),
    dateOnly.getUTCDate(),
    template.hour,
    template.minute,
    template.second,
    rawTimeZone,
  );
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
    SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
  };

  const parsedByDay = byDayRaw.map(raw => {
    const match = raw.match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!match) return null;
    return { ordinal: match[1] ? parseInt(match[1]) : null, day: dayMap[match[2]] };
  }).filter(Boolean) as { ordinal: number | null; day: number }[];

  const startParts = getTimeZoneParts(startDate, rawTimeZone);
  const startDateOnly = getUtcDateOnly(startParts.year, startParts.month, startParts.day);
  const effectiveEnd = until && until < endRange ? until : endRange;
  const effectiveEndParts = getTimeZoneParts(effectiveEnd, rawTimeZone);
  const effectiveEndDateOnly = getUtcDateOnly(effectiveEndParts.year, effectiveEndParts.month, effectiveEndParts.day);
  const maxOccurrences = count || 100;

  const pushOccurrence = (dateOnly: Date) => {
    const occurrence = buildOccurrenceFromLocalDate(dateOnly, startParts, rawTimeZone);
    if (occurrence >= startDate && occurrence <= effectiveEnd) {
      occurrences.push(new Date(occurrence));
      return true;
    }
    return false;
  };

  if (freq === 'DAILY') {
    let currentDate = new Date(startDateOnly);
    while (occurrences.length < maxOccurrences && currentDate <= effectiveEndDateOnly) {
      pushOccurrence(currentDate);
      currentDate = addUtcDays(currentDate, interval);
    }
    return occurrences;
  }

  if (freq === 'WEEKLY') {
    const targetDays = parsedByDay.length > 0 ? parsedByDay.map(({ day }) => day) : [startParts.weekday];
    let currentWeekStart = addUtcDays(startDateOnly, -startParts.weekday);

    while (occurrences.length < maxOccurrences && currentWeekStart <= effectiveEndDateOnly) {
      for (const targetDay of targetDays) {
        const candidateDate = addUtcDays(currentWeekStart, targetDay);
        if (candidateDate < startDateOnly || candidateDate > effectiveEndDateOnly) continue;
        if (pushOccurrence(candidateDate) && occurrences.length >= maxOccurrences) break;
      }
      currentWeekStart = addUtcDays(currentWeekStart, 7 * interval);
    }

    return occurrences;
  }

  if (freq === 'MONTHLY') {
    let year = startParts.year;
    let month = startParts.month;

    while (occurrences.length < maxOccurrences) {
      const monthStart = getUtcDateOnly(year, month, 1);
      if (monthStart > effectiveEndDateOnly) break;

      let candidateDate: Date | null = null;

      if (parsedByDay.length > 0 && parsedByDay[0].ordinal !== null) {
        const { ordinal, day: targetDay } = parsedByDay[0];
        if ((ordinal ?? 0) > 0) {
          const firstDayWeekday = monthStart.getUTCDay();
          let dayOffset = targetDay - firstDayWeekday;
          if (dayOffset < 0) dayOffset += 7;
          const candidateDay = 1 + dayOffset + ((ordinal as number) - 1) * 7;
          const testDate = getUtcDateOnly(year, month, candidateDay);
          if (testDate.getUTCMonth() === month - 1) candidateDate = testDate;
        } else if (ordinal === -1) {
          const lastDay = new Date(Date.UTC(year, month, 0));
          let candidateDay = lastDay.getUTCDate();
          while (candidateDay > 0 && new Date(Date.UTC(year, month - 1, candidateDay)).getUTCDay() !== targetDay) {
            candidateDay -= 1;
          }
          if (candidateDay > 0) candidateDate = getUtcDateOnly(year, month, candidateDay);
        }
      } else {
        const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        candidateDate = getUtcDateOnly(year, month, Math.min(startParts.day, lastDayOfMonth));
      }

      if (candidateDate && candidateDate >= startDateOnly && candidateDate <= effectiveEndDateOnly) {
        pushOccurrence(candidateDate);
      }

      month += interval;
      year += Math.floor((month - 1) / 12);
      month = ((month - 1) % 12) + 1;
    }

    return occurrences;
  }

  if (startDate <= effectiveEnd) {
    occurrences.push(new Date(startDate));
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
      if (currentEvent.uid && currentEvent.start_time) {
        const duration = currentEvent.end_time
          ? currentEvent.end_time.getTime() - currentEvent.start_time.getTime()
          : 3600000; // default 1 hour

        // Debug: log key events
        if (currentEvent.title && (currentEvent.title.includes('All Hands') || currentEvent.title.includes('Enterprise Sales'))) {
          console.log(`[TZ-DEBUG] VEVENT complete: title="${currentEvent.title}" rrule="${currentEvent.rrule}" recurrenceId=${currentEvent.recurrenceId?.toISOString()} startUTC="${currentEvent.start_time.toISOString()}" tz="${currentEvent.timezone}" duration=${duration}`);
        }

        events.push({
          uid: currentEvent.uid,
          title: currentEvent.title || null,
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
          // Debug logging for specific events
          if (currentEvent.title && (currentEvent.title.includes('All Hands') || currentEvent.title.includes('Enterprise Sales'))) {
            console.log(`[TZ-DEBUG] ${currentEvent.title} DTSTART raw="${value}" keyPart="${keyPart}" parsedUTC="${start.date.toISOString()}" tz="${start.timeZone}" allDay=${start.allDay}`);
          }
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

      // Debug logging
      if (event.title && (event.title.includes('All Hands') || event.title.includes('Enterprise Sales'))) {
        console.log(`[TZ-DEBUG] Override instance: title="${event.title}" start="${event.start_time.toISOString()}" recurrenceId="${event.recurrenceId.toISOString()}" tz="${event.timezone}"`);
      }

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

function getStartOfDayInTimeZone(date: Date, rawTimeZone: string | null): Date {
  const timeZone = normalizeTimeZone(rawTimeZone);
  const parts = getTimeZoneParts(date, timeZone);
  return createUtcDateFromTimeZone(parts.year, parts.month - 1, parts.day, 0, 0, 0, timeZone);
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

    // Outlook's ICS endpoint is flaky and frequently returns transient 5xx.
    // Retry up to 3x with backoff, then return a clear (non-500) response so
    // the client surfaces a meaningful message instead of a generic crash.
    let icsResponse: Response | null = null;
    let lastStatus = 0;
    let lastStatusText = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(icsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0)' },
        });
        if (r.ok) {
          icsResponse = r;
          break;
        }
        lastStatus = r.status;
        lastStatusText = r.statusText;
        // Don't retry on 4xx (auth/URL issue)
        if (r.status >= 400 && r.status < 500) break;
      } catch (e) {
        lastStatusText = (e as Error).message;
      }
      if (attempt < 3) await new Promise((res) => setTimeout(res, 800 * attempt));
    }

    if (!icsResponse) {
      console.warn(`ICS upstream unavailable after retries: ${lastStatus} ${lastStatusText}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Calendar provider is temporarily unavailable. Please try again in a moment.',
          upstream_status: lastStatus,
          retryable: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const icsContent = await icsResponse.text();
    console.log('ICS content length:', icsContent.length);

    const rawEvents = parseICS(icsContent);
    console.log('Raw events parsed:', rawEvents.length);
    console.log('Events with RRULE:', rawEvents.filter(e => e.rrule).length);

    const syncStart = getStartOfDayInTimeZone(new Date(), DEFAULT_TIMEZONE);
    const rangeEnd = new Date(syncStart.getTime() + 90 * 24 * 60 * 60 * 1000);
    const syncedEvents = expandRecurringEvents(rawEvents, syncStart, rangeEnd, userId);
    console.log('Calendar sync window start:', syncStart.toISOString());
    console.log('Expanded events from local day start:', syncedEvents.length);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from('calendar_events').delete().eq('user_id', userId);

    for (let i = 0; i < syncedEvents.length; i += 100) {
      const chunk = syncedEvents.slice(i, i + 100);
      const { error } = await supabase
        .from('calendar_events')
        .upsert(chunk, { onConflict: 'external_id' });
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: syncedEvents.length,
        message: `Synced ${syncedEvents.length} events from today's local start onward`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An unexpected error occurred. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});