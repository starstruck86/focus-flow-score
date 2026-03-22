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

      // Check voice reminders
      const { data: voiceReminders } = await supabase
        .from('voice_reminders')
        .select('id, message, remind_at')
        .eq('user_id', user!.id)
        .eq('delivered', false)
        .lte('remind_at', now)
        .limit(5);

      if (voiceReminders?.length) {
        for (const reminder of voiceReminders) {
          toast.info('🔔 Reminder', {
            description: reminder.message,
            duration: 15000,
          });
          await supabase
            .from('voice_reminders')
            .update({ delivered: true })
            .eq('id', reminder.id);
        }
      }

      // Check task reminders
      const { data: taskReminders } = await supabase
        .from('tasks')
        .select('id, title, reminder_at')
        .eq('user_id', user!.id)
        .not('status', 'in', '("done","dropped")')
        .not('reminder_at', 'is', null)
        .lte('reminder_at', now)
        .limit(5);

      if (taskReminders?.length) {
        for (const task of taskReminders) {
          toast.info('⏰ Task Reminder', {
            description: task.title,
            duration: 15000,
          });
          // Null out reminder_at to prevent re-firing
          await supabase
            .from('tasks')
            .update({ reminder_at: null })
            .eq('id', task.id);
        }
      }
    }

    checkReminders();
    timerRef.current = setInterval(checkReminders, POLL_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [user?.id]);
}
