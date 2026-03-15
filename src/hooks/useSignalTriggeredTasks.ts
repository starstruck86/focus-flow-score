// Signal-triggered auto-tasks — creates tasks when enrichment detects trigger events
import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const SIGNAL_TASK_TEMPLATES: Record<string, { title: (name: string) => string; priority: string; workstream: string }> = {
  executive_hire: {
    title: (name) => `New executive at ${name} — reach out with POV`,
    priority: 'P1',
    workstream: 'pg',
  },
  job_posting: {
    title: (name) => `${name} hiring for CRM/Lifecycle — time to prospect`,
    priority: 'P2',
    workstream: 'pg',
  },
  tech_change: {
    title: (name) => `${name} tech stack change detected — competitive play`,
    priority: 'P1',
    workstream: 'pg',
  },
  company_news: {
    title: (name) => `${name} in the news — leverage for outreach`,
    priority: 'P2',
    workstream: 'pg',
  },
};

export function useSignalTriggeredTasks() {
  const { user } = useAuth();

  const createTasksFromSignals = useCallback(async (
    accountId: string,
    accountName: string,
    triggerEvents: any[],
  ) => {
    if (!user || !triggerEvents?.length) return 0;

    // Get existing tasks to avoid duplicates
    const today = new Date().toISOString().split('T')[0];
    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('title')
      .eq('linked_account_id', accountId)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

    const existingTitles = new Set((existingTasks || []).map((t: any) => t.title.toLowerCase()));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = tomorrow.toISOString().split('T')[0];

    let created = 0;
    for (const event of triggerEvents.slice(0, 3)) {
      const template = SIGNAL_TASK_TEMPLATES[event.type];
      if (!template) continue;

      const title = template.title(accountName);
      if (existingTitles.has(title.toLowerCase())) continue;

      const { error } = await supabase.from('tasks').insert({
        user_id: user.id,
        title,
        priority: template.priority,
        workstream: template.workstream,
        status: 'next',
        due_date: dueDate,
        linked_account_id: accountId,
        notes: `**Signal:** ${event.headline || event.type}\n**Source:** ${event.source || 'Daily digest'}\n**Date:** ${event.date || today}`,
        category: 'signal-triggered',
      });

      if (!error) created++;
    }

    if (created > 0) {
      toast.success(`${created} signal-triggered task${created > 1 ? 's' : ''} created`, {
        description: `For ${accountName}`,
      });
    }
    return created;
  }, [user]);

  return { createTasksFromSignals };
}
