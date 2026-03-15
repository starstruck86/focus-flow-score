import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useRef } from 'react';

interface CalendarEvent {
  id: string;
  external_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  location: string | null;
  all_day: boolean;
  created_at: string;
  updated_at: string;
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const LAST_SYNC_KEY = 'calendar_last_sync';

export function useCalendarEvents() {
  return useQuery({
    queryKey: ['calendar-events'],
    queryFn: async () => {
      // Fetch events from 2 hours ago (for post-meeting prompts) through future
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('calendar_events' as any)
        .select('*')
        .gte('start_time', twoHoursAgo)
        .order('start_time', { ascending: true })
        .limit(50);
      
      if (error) throw error;
      return data as unknown as CalendarEvent[];
    },
  });
}

export function useSyncCalendar() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke('sync-calendar');
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}

/** Auto-syncs calendar if last sync was over 1 hour ago */
export function useAutoSyncCalendar() {
  const sync = useSyncCalendar();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const lastSync = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
    const elapsed = Date.now() - lastSync;

    if (elapsed >= SYNC_INTERVAL_MS) {
      sync.mutate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
