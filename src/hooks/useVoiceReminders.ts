import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const POLL_INTERVAL = 60_000; // 60s

export function useVoiceReminders() {
  const { user } = useAuth();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    async function checkReminders() {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('voice_reminders' as any)
        .select('id, message, remind_at')
        .eq('user_id', user!.id)
        .eq('delivered', false)
        .lte('remind_at', now)
        .limit(5);

      if (!data?.length) return;

      for (const reminder of data as any[]) {
        toast.info('🔔 Reminder', {
          description: reminder.message,
          duration: 15000,
        });

        // Mark delivered
        await supabase
          .from('voice_reminders' as any)
          .update({ delivered: true } as any)
          .eq('id', reminder.id);
      }
    }

    // Check immediately, then poll
    checkReminders();
    timerRef.current = setInterval(checkReminders, POLL_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [user?.id]);
}
