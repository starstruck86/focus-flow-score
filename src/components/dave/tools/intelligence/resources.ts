import { supabase } from '@/integrations/supabase/client';
import { fromActiveAccounts } from '@/data/accounts';
import type { ToolContext } from '../../toolTypes';

export async function readResource(ctx: ToolContext, params: { title: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const { data: resources } = await supabase.from('resources').select('id, title, content, resource_type').eq('user_id', userId).ilike('title', `%${params.title}%`).limit(1);
  if (!resources?.length) return `Resource matching "${params.title}" not found`;

  const r = resources[0];
  const content = (r.content || '').substring(0, 3000);
  return `📚 "${r.title}" (${r.resource_type || 'document'}):\n\n${content}${(r.content || '').length > 3000 ? '\n\n... [truncated]' : ''}`;
}

export async function searchResources(ctx: ToolContext, params: { query: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const q = `%${params.query}%`;
  const { data: resources } = await supabase.from('resources').select('title, resource_type, template_category, created_at').eq('user_id', userId).or(`title.ilike.${q},content.ilike.${q},resource_type.ilike.${q}`).limit(10);

  if (!resources?.length) return `No resources found matching "${params.query}"`;
  return `Resources matching "${params.query}":\n` +
    resources.map(r => `• ${r.title} [${r.resource_type || '—'}]${r.template_category ? ` (${r.template_category})` : ''}`).join('\n');
}

export async function lookupTranscript(ctx: ToolContext, params: { accountName: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const { data: accts } = await fromActiveAccounts().select('id, name').eq('user_id', userId).ilike('name', `%${params.accountName}%`).limit(1);
  if (!accts?.length) return `Account "${params.accountName}" not found`;

  const { data: transcripts } = await supabase.from('call_transcripts').select('title, call_date, call_type, summary, participants, duration_minutes').eq('account_id', accts[0].id).order('call_date', { ascending: false }).limit(5);

  if (!transcripts?.length) return `No call transcripts found for ${accts[0].name}`;
  return `Recent calls with ${accts[0].name}:\n` +
    transcripts.map(t => `• ${t.call_date}: ${t.title} (${t.call_type || 'call'}${t.duration_minutes ? `, ${t.duration_minutes}min` : ''})${t.summary ? `\n  Summary: ${t.summary.slice(0, 150)}` : ''}`).join('\n');
}

export async function trendQuery(ctx: ToolContext, params: { metric: string; period?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const TREND_METRIC_MAP: Record<string, string> = {
    dials: 'dials', calls: 'dials',
    connects: 'conversations', conversations: 'conversations',
    meetings: 'meetings_set', 'meetings set': 'meetings_set',
    emails: 'manual_emails',
    prospects: 'prospects_added',
    'customer meetings': 'customer_meetings_held',
    opps: 'opportunities_created',
    'accounts researched': 'accounts_researched',
    score: 'daily_score',
  };

  const dbField = TREND_METRIC_MAP[params.metric.toLowerCase()] || params.metric;
  const period = (params.period || 'week').toLowerCase();
  const daysBack = period.includes('month') ? 30 : period.includes('quarter') ? 90 : 7;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const { data: entries } = await supabase.from('daily_journal_entries').select('*').eq('user_id', userId).gte('date', startDate.toISOString().split('T')[0]).order('date');

  if (!entries?.length) return `No data for ${params.metric} in the last ${daysBack} days.`;

  const values = entries.map(e => (e as unknown as Record<string, number>)[dbField] || 0);
  const total = values.reduce((s: number, v: number) => s + v, 0);
  const avg = Math.round((total / values.length) * 10) / 10;
  const latest = values[values.length - 1];

  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const firstAvg = firstHalf.length ? firstHalf.reduce((s: number, v: number) => s + v, 0) / firstHalf.length : 0;
  const secondAvg = secondHalf.length ? secondHalf.reduce((s: number, v: number) => s + v, 0) / secondHalf.length : 0;
  const trend = secondAvg > firstAvg * 1.1 ? '📈 trending up' : secondAvg < firstAvg * 0.9 ? '📉 trending down' : '➡️ stable';

  return `${params.metric} over last ${daysBack} days: Total ${total}, Avg ${avg}/day, Latest ${latest}. ${trend} (early avg ${Math.round(firstAvg * 10) / 10} → recent avg ${Math.round(secondAvg * 10) / 10}).`;
}
