import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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

export function useCalendarEvents() {
  return useQuery({
    queryKey: ['calendar-events'],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('calendar_events' as never)
        .select('*')
        .gte('start_time', now)
        .order('start_time', { ascending: true })
        .limit(10);
      
      if (error) throw error;
      return data as CalendarEvent[];
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
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}
