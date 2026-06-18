import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface IntensiveMode {
  active: boolean;
  startDate: string | null;
  daysIn: number;
  toggle: () => Promise<void>;
}

export function useIntensiveMode(): IntensiveMode {
  const [active, setActive] = useState(false);
  const [startDate, setStartDate] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any)
        .from('user_settings')
        .select('deal_control_intensive, intensive_start_date')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }: any) => {
          if (data) {
            setActive(data.deal_control_intensive ?? false);
            setStartDate(data.intensive_start_date ?? null);
          }
        });
    });
  }, []);

  const toggle = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const next = !active;
    const now = new Date().toISOString();
    await (supabase as any)
      .from('user_settings')
      .upsert({
        user_id: user.id,
        deal_control_intensive: next,
        intensive_start_date: next ? now : null,
      }, { onConflict: 'user_id' });
    setActive(next);
    setStartDate(next ? now : null);
  };

  const daysIn = startDate
    ? Math.floor((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return { active, startDate, daysIn, toggle };
}
