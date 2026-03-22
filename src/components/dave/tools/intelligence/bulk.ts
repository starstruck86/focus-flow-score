import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import { ACCOUNT_FIELDS } from '../../toolTypes';
import type { ToolContext } from '../../toolTypes';

export async function bulkUpdate(ctx: ToolContext, params: { entity: string; filter_field: string; filter_value: string; update_field: string; update_value: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const entity = params.entity.toLowerCase();

  const VALID_FIELDS: Record<string, string[]> = {
    accounts: ['account_status', 'tier', 'priority', 'motion', 'notes', 'next_step', 'outreach_status', 'industry', 'cadence_name'],
    opportunities: ['stage', 'status', 'arr', 'close_date', 'next_step', 'notes', 'deal_type'],
    tasks: ['status', 'priority', 'due_date', 'notes', 'category'],
  };

  if (!VALID_FIELDS[entity]) return `Bulk update only supports accounts, opportunities, and tasks.`;

  const filterField = ACCOUNT_FIELDS[params.filter_field.toLowerCase()] || params.filter_field;
  const updateField = (entity === 'accounts' ? ACCOUNT_FIELDS[params.update_field.toLowerCase()] : null) || params.update_field;

  if (!VALID_FIELDS[entity].includes(filterField) && filterField !== 'name' && filterField !== 'title') {
    return `Invalid filter field "${params.filter_field}" for ${entity}. Valid: name, ${VALID_FIELDS[entity].join(', ')}`;
  }
  if (!VALID_FIELDS[entity].includes(updateField)) {
    return `Invalid update field "${params.update_field}" for ${entity}. Valid: ${VALID_FIELDS[entity].join(', ')}`;
  }

  const table = entity as 'accounts' | 'opportunities' | 'tasks';

  const { data: matches, count } = await supabase
    .from(table)
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .ilike(filterField, `%${params.filter_value}%`)
    .limit(50);

  const matchCount = count || matches?.length || 0;
  if (!matchCount) return `No ${entity} found matching ${params.filter_field} = "${params.filter_value}"`;

  const ids = (matches || []).map(m => m.id);
  const { error } = await supabase
    .from(table)
    .update({ [updateField]: params.update_value, updated_at: new Date().toISOString() })
    .in('id', ids);

  if (error) return `Bulk update failed: ${error.message}`;
  emitDataChanged(entity);
  toast.success(`Bulk updated ${matchCount} ${entity}`, { description: `${params.update_field} → ${params.update_value}` });
  return `Updated ${matchCount} ${entity} where ${params.filter_field} matches "${params.filter_value}": set ${params.update_field} = "${params.update_value}"`;
}
