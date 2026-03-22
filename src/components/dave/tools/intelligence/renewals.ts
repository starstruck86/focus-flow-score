import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import type { ToolContext } from '../../toolTypes';

export async function lookupRenewal(ctx: ToolContext, params: { timeframe?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date();
  let endDate: Date;
  const tf = (params.timeframe || 'quarter').toLowerCase();
  if (tf.includes('month')) endDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  else if (tf.includes('year')) endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  else endDate = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());

  const { data: renewals } = await supabase.from('renewals').select('account_name, arr, renewal_due, health_status, churn_risk, renewal_stage, next_step').eq('user_id', userId).gte('renewal_due', now.toISOString().split('T')[0]).lte('renewal_due', endDate.toISOString().split('T')[0]).order('renewal_due').limit(20);

  if (!renewals?.length) return `No renewals found in the next ${tf}.`;
  const totalArr = renewals.reduce((s, r) => s + Number(r.arr || 0), 0);
  return `${renewals.length} renewals ($${Math.round(totalArr / 1000)}k) in the next ${tf}:\n` +
    renewals.map(r => `• ${r.account_name}: $${Math.round(Number(r.arr || 0) / 1000)}k due ${r.renewal_due} [${r.health_status || '—'}/${r.churn_risk || '—'}]${r.next_step ? ` → ${r.next_step}` : ''}`).join('\n');
}

export async function updateRenewal(ctx: ToolContext, params: { accountName: string; field: string; value: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const RENEWAL_FIELDS: Record<string, string> = {
    health: 'health_status', 'health status': 'health_status',
    risk: 'churn_risk', 'churn risk': 'churn_risk',
    'risk reason': 'risk_reason',
    stage: 'renewal_stage', 'renewal stage': 'renewal_stage',
    'next step': 'next_step', next_step: 'next_step',
    notes: 'notes',
  };

  const dbField = RENEWAL_FIELDS[params.field.toLowerCase()];
  if (!dbField) return `Invalid renewal field "${params.field}". Valid: ${Object.keys(RENEWAL_FIELDS).join(', ')}`;

  const { data: renewals } = await supabase.from('renewals').select('id, account_name').eq('user_id', userId).ilike('account_name', `%${params.accountName}%`).limit(1);
  if (!renewals?.length) return `Renewal for "${params.accountName}" not found`;

  const { error } = await supabase.from('renewals').update({ [dbField]: params.value, updated_at: new Date().toISOString() }).eq('id', renewals[0].id);

  if (error) return `Failed to update renewal: ${error.message}`;
  emitDataChanged('renewals');
  toast.success('Renewal updated', { description: `${renewals[0].account_name}: ${params.field} → ${params.value}` });
  return `Updated ${renewals[0].account_name} renewal ${params.field} to ${params.value}`;
}
