import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ToolContext, ToolMap } from '../toolTypes';
import type { GradingCriteria } from '@/types/supabase-helpers';

export function createIntegrationTools(ctx: ToolContext): ToolMap {
  return {
    set_reminder: async (params: { message: string; minutes_from_now: number }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';
      const remindAt = new Date(Date.now() + params.minutes_from_now * 60 * 1000);
      await supabase.from('voice_reminders').insert({
        user_id: userId,
        message: params.message,
        remind_at: remindAt.toISOString(),
      });
      return `Reminder set for ${params.minutes_from_now} minutes from now: ${params.message}`;
    },

    draft_email: (params: { to: string; subject: string; body: string }) => {
      const emailText = `To: ${params.to}\nSubject: ${params.subject}\n\n${params.body}`;
      navigator.clipboard?.writeText(emailText).catch(() => {});
      toast.success('Email drafted & copied', { description: params.subject });
      return `Email drafted for ${params.to}: "${params.subject}". I've copied it to your clipboard.`;
    },

    get_calendar: async (params: { day?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const target = params.day?.toLowerCase() === 'tomorrow'
        ? new Date(Date.now() + 86400000)
        : new Date();
      const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate()).toISOString();
      const dayEnd = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1).toISOString();

      const { data: events } = await supabase
        .from('calendar_events')
        .select('title, start_time, end_time, description, location')
        .eq('user_id', userId)
        .gte('start_time', dayStart)
        .lt('start_time', dayEnd)
        .order('start_time')
        .limit(20);

      if (!events?.length) return `No meetings ${params.day === 'tomorrow' ? 'tomorrow' : 'today'}.`;
      const label = params.day === 'tomorrow' ? 'Tomorrow' : 'Today';
      return `${label}'s calendar (${events.length} events):\n` +
        events.map(e => {
          const start = new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const end = e.end_time ? new Date(e.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          return `• ${start}${end ? `–${end}` : ''} ${e.title}${e.location ? ` (${e.location})` : ''}`;
        }).join('\n');
    },




    read_resource_digest: async (params: { title: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: resources } = await supabase
        .from('resources')
        .select('id, title')
        .eq('user_id', userId)
        .ilike('title', `%${params.title}%`)
        .limit(5);

      if (!resources?.length) return `No resource found matching "${params.title}". Try a different title.`;

      const resourceIds = resources.map(r => r.id);

      const { data: digests } = await supabase
        .from('resource_digests')
        .select('*')
        .eq('user_id', userId)
        .in('resource_id', resourceIds);

      if (!digests?.length) {
        const titles = resources.map(r => r.title).join(', ');
        return `Found resources (${titles}) but none have been operationalized yet. Use "Operationalize" in the Sales Brain OS Library to extract intelligence.`;
      }

      const d = digests[0];
      const resource = resources.find(r => r.id === d.resource_id);

      let result = `📚 "${resource?.title || params.title}" — Intelligence Digest\n\n`;
      result += `📝 Summary:\n${d.summary || 'No summary'}\n\n`;

      if (d.takeaways?.length) {
        result += `🎯 Key Takeaways:\n${d.takeaways.map((t: string) => `• ${t}`).join('\n')}\n\n`;
      }

      if (d.use_cases?.length) {
        result += `📋 Use Cases:\n${d.use_cases.map((u: string) => `• ${u}`).join('\n')}\n\n`;
      }

      if (d.grading_criteria) {
        const criteria = d.grading_criteria as unknown as GradingCriteria;
        if (criteria.categories?.length) {
          result += `📊 Grading Criteria:\n${criteria.categories.map(c => `• ${c.name}: ${c.description || ''}`).join('\n')}`;
        }
      }

      return result;
    },
  };
}
