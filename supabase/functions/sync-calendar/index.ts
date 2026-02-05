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
}

interface RawEvent {
  uid: string;
  title: string;
  description: string | null;
  start_time: Date;
  end_time: Date | null;
  location: string | null;
  all_day: boolean;
  rrule: string | null;
  recurrenceId: string | null;
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
  const byDay = parts['BYDAY']?.split(',') || [];
  
  const dayMap: Record<string, number> = {
    'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
  };
  
  let current = new Date(startDate);
  let occurrenceCount = 0;
  const maxOccurrences = count || 100;
  const effectiveEnd = until && until < endRange ? until : endRange;
  
  while (current <= effectiveEnd && occurrenceCount < maxOccurrences) {
    if (freq === 'WEEKLY') {
      if (byDay.length > 0) {
        // For each day in BYDAY
        for (const day of byDay) {
          const targetDay = dayMap[day];
          if (targetDay !== undefined) {
            const weekStart = new Date(current);
            weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay()); // Go to Sunday
            const occurrence = new Date(weekStart);
            occurrence.setUTCDate(occurrence.getUTCDate() + targetDay);
            occurrence.setUTCHours(startDate.getUTCHours(), startDate.getUTCMinutes(), startDate.getUTCSeconds());
            
            if (occurrence >= startDate && occurrence <= effectiveEnd) {
              occurrences.push(new Date(occurrence));
              occurrenceCount++;
            }
          }
        }
        // Move to next interval
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
      if (current >= startDate) {
        occurrences.push(new Date(current));
        occurrenceCount++;
      }
      current.setUTCMonth(current.getUTCMonth() + interval);
    } else {
      // Unknown frequency, just add the start date
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

function expandRecurringEvents(rawEvents: RawEvent[], rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
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
    const icsUrl = Deno.env.get('OUTLOOK_ICS_URL');
    if (!icsUrl) {
      throw new Error('OUTLOOK_ICS_URL is not configured');
    }

    console.log('Fetching ICS from:', icsUrl);
    
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
    const allEvents = expandRecurringEvents(rawEvents, now, rangeEnd);
    console.log('Expanded events:', allEvents.length);
    
    // Filter for future events only
    const futureEvents = allEvents.filter(event => new Date(event.start_time) >= now);
    console.log('Future events:', futureEvents.length);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Clear old events and insert new ones
    if (futureEvents.length > 0) {
      // Delete old events first to handle removed/cancelled meetings
      await supabase.from('calendar_events').delete().lt('start_time', now.toISOString());
      
      const { error } = await supabase
        .from('calendar_events')
        .upsert(futureEvents, { onConflict: 'external_id' });

      if (error) {
        throw error;
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
