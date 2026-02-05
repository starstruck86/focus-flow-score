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

function parseICSDate(dateStr: string, keyPart: string): { date: Date; allDay: boolean } {
  // Extract timezone from TZID parameter if present (e.g., DTSTART;TZID=America/New_York:20260206T100000)
  const tzidMatch = keyPart.match(/TZID=([^;:]+)/i);
  const timezone = tzidMatch ? tzidMatch[1] : null;
  
  // Get the actual date value after the colon
  const cleanDate = dateStr;
  
  // Check if it's an all-day event (YYYYMMDD format, no time)
  if (cleanDate.length === 8) {
    const year = parseInt(cleanDate.slice(0, 4));
    const month = parseInt(cleanDate.slice(4, 6)) - 1;
    const day = parseInt(cleanDate.slice(6, 8));
    // All-day events: treat as midnight UTC
    return { date: new Date(Date.UTC(year, month, day, 0, 0, 0)), allDay: true };
  }
  
  // Full datetime format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const year = parseInt(cleanDate.slice(0, 4));
  const month = parseInt(cleanDate.slice(4, 6)) - 1;
  const day = parseInt(cleanDate.slice(6, 8));
  const hour = parseInt(cleanDate.slice(9, 11)) || 0;
  const minute = parseInt(cleanDate.slice(11, 13)) || 0;
  const second = parseInt(cleanDate.slice(13, 15)) || 0;
  
  // If ends with Z, it's already UTC
  if (cleanDate.endsWith('Z')) {
    return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), allDay: false };
  }
  
  // If timezone is specified (usually America/New_York for EST/EDT), convert to UTC
  // EST is UTC-5, EDT is UTC-4
  if (timezone && (timezone.includes('Eastern') || timezone.includes('New_York'))) {
    // Determine if DST is in effect (rough approximation: March-November)
    const tempDate = new Date(year, month, day);
    const isDST = month >= 2 && month <= 10; // March through November
    const offsetHours = isDST ? 4 : 5; // EDT = -4, EST = -5
    
    return { 
      date: new Date(Date.UTC(year, month, day, hour + offsetHours, minute, second)), 
      allDay: false 
    };
  }
  
  // Default: assume the time is in Eastern timezone (EST/EDT)
  // Most Outlook calendars use Eastern time
  const tempDate = new Date(year, month, day);
  const isDST = month >= 2 && month <= 10;
  const offsetHours = isDST ? 4 : 5;
  
  return { 
    date: new Date(Date.UTC(year, month, day, hour + offsetHours, minute, second)), 
    allDay: false 
  };
}

function parseICS(icsContent: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  
  // Unfold lines (lines starting with space/tab are continuations)
  const unfoldedContent = icsContent.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfoldedContent.split(/\r\n|\n/);
  
  let currentEvent: Partial<CalendarEvent> & { uid?: string; recurrenceId?: string } | null = null;
  let allDay = false;
  
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
      allDay = false;
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.uid && currentEvent.title && currentEvent.start_time) {
        // Create unique external_id by combining UID with recurrence-id or start_time
        // This handles recurring events having the same UID
        const uniqueId = currentEvent.recurrenceId 
          ? `${currentEvent.uid}_${currentEvent.recurrenceId}`
          : `${currentEvent.uid}_${currentEvent.start_time}`;
        
        events.push({
          external_id: uniqueId,
          title: currentEvent.title,
          description: currentEvent.description || null,
          start_time: currentEvent.start_time,
          end_time: currentEvent.end_time || null,
          location: currentEvent.location || null,
          all_day: allDay,
        });
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const keyPart = line.slice(0, colonIndex);
      const value = line.slice(colonIndex + 1);
      const key = keyPart.split(';')[0]; // Remove parameters
      
      switch (key) {
        case 'UID':
          currentEvent.uid = value;
          break;
        case 'RECURRENCE-ID':
          currentEvent.recurrenceId = value;
          break;
        case 'SUMMARY':
          currentEvent.title = value;
          break;
        case 'DESCRIPTION':
          currentEvent.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
          break;
        case 'DTSTART':
          const start = parseICSDate(value, keyPart);
          currentEvent.start_time = start.date.toISOString();
          allDay = start.allDay;
          break;
        case 'DTEND':
          const end = parseICSDate(value, keyPart);
          currentEvent.end_time = end.date.toISOString();
          break;
        case 'LOCATION':
          currentEvent.location = value;
          break;
      }
    }
  }
  
  return events;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const icsUrl = Deno.env.get('OUTLOOK_ICS_URL');
    if (!icsUrl) {
      throw new Error('OUTLOOK_ICS_URL is not configured');
    }

    console.log('Fetching ICS from:', icsUrl);
    
    // Fetch ICS content
    const icsResponse = await fetch(icsUrl);
    if (!icsResponse.ok) {
      throw new Error(`Failed to fetch ICS: ${icsResponse.status} ${icsResponse.statusText}`);
    }
    
    const icsContent = await icsResponse.text();
    console.log('ICS content length:', icsContent.length);
    
    // Parse events
    const allEvents = parseICS(icsContent);
    console.log('Total events parsed:', allEvents.length);
    
    // Filter for future events only
    const now = new Date();
    const futureEvents = allEvents.filter(event => new Date(event.start_time) >= now);
    console.log('Future events:', futureEvents.length);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Upsert events
    if (futureEvents.length > 0) {
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
