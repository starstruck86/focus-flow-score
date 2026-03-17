import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
}

function parseICSDate(dateStr: string, keyPart: string): { date: Date; allDay: boolean } {
  const tzidMatch = keyPart.match(/TZID=([^;:]+)/i);
  const timezone = tzidMatch ? tzidMatch[1] : null;
  const cleanDate = dateStr;
  
  if (cleanDate.length === 8) {
    const year = parseInt(cleanDate.slice(0, 4));
    const month = parseInt(cleanDate.slice(4, 6)) - 1;
    const day = parseInt(cleanDate.slice(6, 8));
    return { date: new Date(Date.UTC(year, month, day, 0, 0, 0)), allDay: true };
  }
  
  const year = parseInt(cleanDate.slice(0, 4));
  const month = parseInt(cleanDate.slice(4, 6)) - 1;
  const day = parseInt(cleanDate.slice(6, 8));
  const hour = parseInt(cleanDate.slice(9, 11)) || 0;
  const minute = parseInt(cleanDate.slice(11, 13)) || 0;
  const second = parseInt(cleanDate.slice(13, 15)) || 0;
  
  if (cleanDate.endsWith('Z')) {
    return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), allDay: false };
  }
  
  if (timezone && (timezone.includes('Eastern') || timezone.includes('New_York'))) {
    const isDST = month >= 2 && month <= 10;
    const offsetHours = isDST ? 4 : 5;
    return { 
      date: new Date(Date.UTC(year, month, day, hour + offsetHours, minute, second)), 
      allDay: false 
    };
  }
  
  const isDST = month >= 2 && month <= 10;
  const offsetHours = isDST ? 4 : 5;
  return { 
    date: new Date(Date.UTC(year, month, day, hour + offsetHours, minute, second)), 
    allDay: false 
  };
}

function parseRRule(rrule: string, startDate: Date, endRange: Date): Date[] {
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

  // Parse BYDAY values - handle ordinal prefixes like "3WE", "-1FR"
  const parsedByDay = byDayRaw.map(raw => {
    const match = raw.match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!match) return null;
    return { ordinal: match[1] ? parseInt(match[1]) : null, day: dayMap[match[2]] };
  }).filter(Boolean) as { ordinal: number | null; day: number }[];
  
  let current = new Date(startDate);
  let occurrenceCount = 0;
  const maxOccurrences = count || 100;
  const effectiveEnd = until && until < endRange ? until : endRange;
  
  while (current <= effectiveEnd && occurrenceCount < maxOccurrences) {
    if (freq === 'WEEKLY') {
      if (parsedByDay.length > 0) {
        for (const { day: targetDay } of parsedByDay) {
          const weekStart = new Date(current);
          weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
          const occurrence = new Date(weekStart);
          occurrence.setUTCDate(occurrence.getUTCDate() + targetDay);
          occurrence.setUTCHours(startDate.getUTCHours(), startDate.getUTCMinutes(), startDate.getUTCSeconds());
          
          if (occurrence >= startDate && occurrence <= effectiveEnd) {
            occurrences.push(new Date(occurrence));
            occurrenceCount++;
          }
        }
        current.setUTCDate(current.getUTCDate() + (7 * interval));
      } else {
        if (current >= startDate) {
          occurrences.push(new Date(current));
          occurrenceCount++;
        }
        current.setUTCDate(current.getUTCDate() + (7 * interval));
      }
    } else if (freq === 'DAILY') {
      if (current >= startDate) {
        occurrences.push(new Date(current));
        occurrenceCount++;
      }
      current.setUTCDate(current.getUTCDate() + interval);
    } else if (freq === 'MONTHLY') {
      if (parsedByDay.length > 0 && parsedByDay[0].ordinal !== null) {
        // Handle ordinal BYDAY for MONTHLY (e.g., BYDAY=3WE = 3rd Wednesday)
        const { ordinal, day: targetDay } = parsedByDay[0];
        const year = current.getUTCFullYear();
        const month = current.getUTCMonth();

        let nthDate: Date | null = null;
        if (ordinal > 0) {
          // Find the Nth occurrence of targetDay in the month
          // Start from the 1st of the month
          const firstOfMonth = new Date(Date.UTC(year, month, 1, startDate.getUTCHours(), startDate.getUTCMinutes(), startDate.getUTCSeconds()));
          const firstDow = firstOfMonth.getUTCDay();
          let dayOffset = targetDay - firstDow;
          if (dayOffset < 0) dayOffset += 7;
          // First occurrence is on day (1 + dayOffset), Nth is + (ordinal-1)*7
          const nthDay = 1 + dayOffset + (ordinal - 1) * 7;
          // Validate it's still in the same month
          const candidate = new Date(Date.UTC(year, month, nthDay, startDate.getUTCHours(), startDate.getUTCMinutes(), startDate.getUTCSeconds()));
          if (candidate.getUTCMonth() === month) {
            nthDate = candidate;
          }
        } else if (ordinal === -1) {
          // Last occurrence of targetDay in the month
          const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
          let d = lastOfMonth.getUTCDate();
          while (new Date(Date.UTC(year, month, d)).getUTCDay() !== targetDay && d > 0) d--;
          if (d > 0) {
            nthDate = new Date(Date.UTC(year, month, d, startDate.getUTCHours(), startDate.getUTCMinutes(), startDate.getUTCSeconds()));
          }
        }

        if (nthDate && nthDate >= startDate && nthDate <= effectiveEnd) {
          occurrences.push(nthDate);
          occurrenceCount++;
        }
        current.setUTCMonth(current.getUTCMonth() + interval);
      } else {
        // Simple monthly: same day of month
        if (current >= startDate) {
          occurrences.push(new Date(current));
          occurrenceCount++;
        }
        current.setUTCMonth(current.getUTCMonth() + interval);
      }
    } else {
      occurrences.push(new Date(current));
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
        case 'RECURRENCE-ID':
          currentEvent.recurrenceId = value;
          break;
        case 'RRULE':
          currentEvent.rrule = value;
          break;
        case 'EXDATE':
          const exdate = parseICSDate(value, keyPart);
          currentEvent.exdates = currentEvent.exdates || [];
          currentEvent.exdates.push(exdate.date);
          break;
        case 'SUMMARY':
          currentEvent.title = value;
          break;
        case 'DESCRIPTION':
          currentEvent.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
          break;
        case 'DTSTART':
          const start = parseICSDate(value, keyPart);
          currentEvent.start_time = start.date;
          allDay = start.allDay;
          break;
        case 'DTEND':
          const end = parseICSDate(value, keyPart);
          currentEvent.end_time = end.date;
          break;
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
  
  // First, collect all exception instances (events with RECURRENCE-ID)
  for (const event of rawEvents) {
    if (event.recurrenceId) {
      overrides.set(`${event.uid}_${event.recurrenceId}`, event);
    }
  }
  
  for (const event of rawEvents) {
    if (event.recurrenceId) {
      // This is an exception instance, add it directly
      expandedEvents.push({
        external_id: `${event.uid}_${event.start_time.toISOString()}`,
        title: event.title,
        description: event.description,
        start_time: event.start_time.toISOString(),
        end_time: event.end_time?.toISOString() || null,
        location: event.location,
        all_day: event.all_day,
        user_id: userId,
      });
    } else if (event.rrule) {
      // Expand recurring event
      const occurrences = parseRRule(event.rrule, event.start_time, rangeEnd);
      
      for (const occurrence of occurrences) {
        if (occurrence < rangeStart) continue;
        
        // Check if this occurrence is excluded
        const isExcluded = event.exdates.some(exdate => 
          Math.abs(exdate.getTime() - occurrence.getTime()) < 86400000 // within a day
        );
        if (isExcluded) continue;
        
        // Check if there's an override for this occurrence
        const overrideKey = `${event.uid}_${occurrence.toISOString().slice(0, 10)}`;
        if (overrides.has(overrideKey)) continue; // Skip, override will be added separately
        
        const endTime = event.end_time 
          ? new Date(occurrence.getTime() + event.duration)
          : null;
        
        expandedEvents.push({
          external_id: `${event.uid}_${occurrence.toISOString()}`,
          title: event.title,
          description: event.description,
          start_time: occurrence.toISOString(),
          end_time: endTime?.toISOString() || null,
          location: event.location,
          all_day: event.all_day,
          user_id: userId,
        });
      }
    } else {
      // Non-recurring event
      expandedEvents.push({
        external_id: `${event.uid}_${event.start_time.toISOString()}`,
        title: event.title,
        description: event.description,
        start_time: event.start_time.toISOString(),
        end_time: event.end_time?.toISOString() || null,
        location: event.location,
        all_day: event.all_day,
        user_id: userId,
      });
    }
  }
  
  // Deduplicate by external_id (keep the last occurrence in case of duplicates)
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
    // Get user from auth header
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
    
    // Create client with user's auth to get their ID
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
    
    // Parse raw events
    const rawEvents = parseICS(icsContent);
    console.log('Raw events parsed:', rawEvents.length);
    console.log('Events with RRULE:', rawEvents.filter(e => e.rrule).length);
    
    // Expand recurring events for next 90 days
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const allEvents = expandRecurringEvents(rawEvents, now, rangeEnd, userId);
    console.log('Expanded events:', allEvents.length);
    
    // Filter for future events only
    const futureEvents = allEvents.filter(event => new Date(event.start_time) >= now);
    console.log('Future events:', futureEvents.length);

    // Use service role for database writes
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Full replace: delete ALL events for this user, then insert fresh set
    if (futureEvents.length > 0) {
      await supabase.from('calendar_events').delete().eq('user_id', userId);
      
      // Batch insert in chunks of 100
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
