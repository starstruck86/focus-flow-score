import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import { parseDueDate, parseTime } from '../toolTypes';
import type { ToolContext, ToolMap } from '../toolTypes';
import type { TaskInsert } from '@/types/supabase-helpers';

export function createTaskTools(ctx: ToolContext): ToolMap {
  return {
    create_task: async (params: { title: string; priority?: string; accountName?: string; dueDate?: string; dueTime?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      let linkedAccountId: string | null = null;
      if (params.accountName) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        linkedAccountId = accts?.[0]?.id ?? null;
      }

      const dueDate = params.dueDate ? parseDueDate(params.dueDate) : null;

      let reminderAt: string | null = null;
      if (params.dueTime && dueDate) {
        const time = parseTime(params.dueTime);
        if (time) {
          reminderAt = new Date(`${dueDate}T${time}:00`).toISOString();
        }
      }

      const { error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: params.title,
        priority: params.priority || 'P2',
        status: 'next',
        workstream: 'pg',
        linked_account_id: linkedAccountId,
        category: 'voice-created',
        due_date: dueDate,
        reminder_at: reminderAt,
      });

      if (error) {
        console.error('Voice create_task error:', error);
        return `Failed to create task: ${error.message}`;
      }
      emitDataChanged('tasks');

      if (params.dueTime && dueDate) {
        const time = parseTime(params.dueTime);
        if (time) {
          const remindAt = new Date(`${dueDate}T${time}:00`);
          await supabase.from('voice_reminders').insert({
            user_id: userId,
            message: params.title,
            remind_at: remindAt.toISOString(),
          });
        }
      }

      toast.success('Task created', { description: `${params.title}${dueDate ? ` (due ${dueDate})` : ''}${reminderAt ? ' 🔔' : ''}` });
      return `Task created: ${params.title}${dueDate ? ` due ${dueDate}` : ''}${reminderAt ? ' with reminder' : ''}`;
    },

    complete_task: async (params: { taskTitle: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, status')
        .eq('user_id', userId)
        .not('status', 'in', '("done","dropped")')
        .ilike('title', `%${params.taskTitle}%`)
        .limit(1);

      if (!tasks?.length) return `Task matching "${params.taskTitle}" not found`;

      const { error } = await supabase
        .from('tasks')
        .update({ status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', tasks[0].id);

      if (error) return `Failed to complete task: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Task completed', { description: tasks[0].title });
      return `Completed: ${tasks[0].title}`;
    },

    list_tasks: async (params: { filter?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      let query = supabase
        .from('tasks')
        .select('title, priority, status, due_date, linked_account_id')
        .eq('user_id', userId)
        .not('status', 'in', '("done","dropped")')
        .order('priority')
        .limit(15);

      const filter = (params.filter || 'today').toLowerCase();
      if (filter === 'today' || filter === 'due today') {
        query = query.eq('due_date', today);
      } else if (filter === 'overdue') {
        query = query.lt('due_date', today);
      }

      const { data: tasks } = await query;
      if (!tasks?.length) return filter === 'today' ? 'No tasks due today.' : 'No matching tasks found.';

      const accountIds = [...new Set(tasks.map(t => t.linked_account_id).filter(Boolean))] as string[];
      let accountMap: Record<string, string> = {};
      if (accountIds.length) {
        const { data: accts } = await supabase.from('active_accounts' as any).select('id, name').in('id', accountIds);
        if (accts) accountMap = Object.fromEntries(accts.map(a => [a.id, a.name]));
      }

      return `${tasks.length} tasks${filter === 'today' ? ' for today' : ''}:\n` +
        tasks.map(t => {
          const acctName = t.linked_account_id ? accountMap[t.linked_account_id] : null;
          return `• [${t.priority || 'P2'}] ${t.title}${acctName ? ` (${acctName})` : ''}${t.due_date ? ` due ${t.due_date}` : ''} — ${t.status}`;
        }).join('\n');
    },

    set_task_reminder: async (params: { taskTitle: string; reminderTime: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('user_id', userId)
        .not('status', 'in', '("done","dropped")')
        .ilike('title', `%${params.taskTitle}%`)
        .limit(1);

      if (!tasks?.length) return `Task matching "${params.taskTitle}" not found`;

      let reminderAtDate: Date;
      const lower = params.reminderTime.toLowerCase().trim();
      const relativeMatch = lower.match(/in\s+(\d+)\s*(minute|min|hour|hr|h|m)/i);
      if (relativeMatch) {
        const amount = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2].startsWith('h') ? 60 : 1;
        reminderAtDate = new Date(Date.now() + amount * unit * 60 * 1000);
      } else {
        reminderAtDate = new Date(params.reminderTime);
        if (isNaN(reminderAtDate.getTime())) {
          const time = parseTime(params.reminderTime);
          if (time) {
            const today = new Date().toISOString().split('T')[0];
            reminderAtDate = new Date(`${today}T${time}:00`);
          } else {
            return `Could not parse reminder time: "${params.reminderTime}". Try "in 30 minutes" or "3pm".`;
          }
        }
      }

      const { error } = await supabase
        .from('tasks')
        .update({ reminder_at: reminderAtDate.toISOString(), updated_at: new Date().toISOString() })
        .eq('id', tasks[0].id);

      if (error) return `Failed to set reminder: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Reminder set', { description: `${tasks[0].title} — ${reminderAtDate.toLocaleString()}` });
      return `Reminder set for "${tasks[0].title}" at ${reminderAtDate.toLocaleString()}`;
    },

    create_recurring_task: async (params: { title: string; recurrence: string; accountName?: string; priority?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      let linkedAccountId: string | null = null;
      if (params.accountName) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        linkedAccountId = accts?.[0]?.id ?? null;
      }

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);
      while (dueDate.getDay() === 0 || dueDate.getDay() === 6) dueDate.setDate(dueDate.getDate() + 1);

      const { error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: `🔄 ${params.title}`,
        priority: params.priority || 'P2',
        status: 'next',
        workstream: 'pg',
        linked_account_id: linkedAccountId,
        category: `recurring:${params.recurrence}`,
        due_date: dueDate.toISOString().split('T')[0],
      });

      if (error) return `Failed to create recurring task: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Recurring task created', { description: `${params.title} — ${params.recurrence}` });
      return `Created recurring task: "${params.title}" (${params.recurrence})${params.accountName ? ` linked to ${params.accountName}` : ''}`;
    },

    save_commitment: async (params: { commitment: string; accountName?: string; dueDate?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      let accountId: string | null = null;
      if (params.accountName) {
        const { data: accounts } = await supabase
          .from('accounts')
          .select('id, name, notes')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        if (accounts?.length) {
          accountId = accounts[0].id;
          const existing = accounts[0].notes || '';
          await supabase
            .from('accounts')
            .update({ notes: `${existing}\n\n🤝 Commitment (${new Date().toLocaleDateString()}): ${params.commitment}`.trim() })
            .eq('id', accountId);
        }
      }

      const dueDate = params.dueDate ? parseDueDate(params.dueDate) : new Date().toISOString().split('T')[0];
      const taskPayload: TaskInsert = {
        user_id: userId,
        title: `🤝 ${params.commitment}`,
        priority: 'P2',
        status: 'todo',
        due_date: dueDate,
        linked_account_id: accountId,
        category: 'dave-commitment',
      };
      const { error } = await supabase.from('tasks').insert(taskPayload);

      if (error) return `Failed to save commitment: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Commitment saved', { description: params.commitment });
      return `Saved commitment: "${params.commitment}"${accountId ? ` (linked to account)` : ''} — task created for ${dueDate}`;
    },
  };
}
