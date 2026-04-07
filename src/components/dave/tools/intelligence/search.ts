import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

export async function searchCrm(ctx: ToolContext, params: { query: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const q = `%${params.query}%`;
  const [accts, opps, contacts, transcripts] = await Promise.all([
    fromActiveAccounts().select('name, tier, account_status').eq('user_id', userId).or(`name.ilike.${q},notes.ilike.${q},industry.ilike.${q}`).limit(5),
    supabase.from('opportunities').select('name, stage, arr').eq('user_id', userId).or(`name.ilike.${q},notes.ilike.${q},next_step.ilike.${q}`).limit(5),
    supabase.from('contacts').select('name, title, email').eq('user_id', userId).or(`name.ilike.${q},title.ilike.${q},email.ilike.${q}`).limit(5),
    supabase.from('call_transcripts').select('title, call_date, summary').eq('user_id', userId).or(`title.ilike.${q},content.ilike.${q},summary.ilike.${q}`).limit(5),
  ]);

  const results: string[] = [];
  if (accts.data?.length) results.push(`Accounts: ${accts.data.map(a => `${a.name} [${a.tier || '—'}]`).join(', ')}`);
  if (opps.data?.length) results.push(`Deals: ${opps.data.map(o => `${o.name} (${o.stage || '—'}, $${Math.round((o.arr || 0) / 1000)}k)`).join(', ')}`);
  if (contacts.data?.length) results.push(`Contacts: ${contacts.data.map(c => `${c.name}${c.title ? ` (${c.title})` : ''}`).join(', ')}`);
  if (transcripts.data?.length) results.push(`Transcripts: ${transcripts.data.map(t => `${t.title} (${t.call_date})`).join(', ')}`);

  if (!results.length) return `No results found for "${params.query}"`;
  return `Search results for "${params.query}":\n${results.join('\n')}`;
}

export async function competitiveIntel(ctx: ToolContext, params: { query: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const searchTerm = params.query.toLowerCase();

  const { data: transcripts } = await supabase.from('call_transcripts').select('id, title, call_date, account_id, content').eq('user_id', userId).ilike('content', `%${params.query}%`).order('call_date', { ascending: false }).limit(10);
  const { data: accounts } = await fromActiveAccounts().select('id, name, notes').eq('user_id', userId).ilike('notes', `%${params.query}%`).limit(10);
  const { data: opps } = await supabase.from('opportunities').select('id, name, notes, account_id').eq('user_id', userId).ilike('notes', `%${params.query}%`).limit(10);
  const { data: grades } = await supabase.from('transcript_grades').select('transcript_id, competitors_mentioned').eq('user_id', userId).not('competitors_mentioned', 'is', null).limit(50);

  const gradeMatches = (grades || []).filter((g: { competitors_mentioned: string[] | null }) =>
    (g.competitors_mentioned || []).some((c: string) => c.toLowerCase().includes(searchTerm))
  );

  const accountIds = [...new Set((transcripts || []).map((t: { account_id: string | null }) => t.account_id).filter(Boolean))];
  let accountMap: Record<string, string> = {};
  if (accountIds.length) {
    const { data: accts } = await fromActiveAccounts().select('id, name').in('id', accountIds as string[]);
    accountMap = Object.fromEntries((accts || []).map((a: { id: string; name: string }) => [a.id, a.name]));
  }

  const results: string[] = [];
  for (const t of (transcripts || []) as Array<{ call_date: string; account_id: string | null; content: string; title: string }>) {
    const acctName = accountMap[t.account_id || ''] || 'Unknown';
    const idx = (t.content || '').toLowerCase().indexOf(searchTerm);
    const snippet = idx >= 0 ? (t.content || '').slice(Math.max(0, idx - 50), idx + searchTerm.length + 100).trim() : '';
    results.push(`📞 ${t.call_date} — ${acctName}: "${snippet.slice(0, 150)}..."`);
  }
  for (const a of (accounts || []) as Array<{ name: string }>) results.push(`🏢 Account "${a.name}" notes mention "${params.query}"`);
  for (const o of (opps || []) as Array<{ name: string }>) results.push(`💼 Deal "${o.name}" notes mention "${params.query}"`);
  if (gradeMatches.length) results.push(`📊 ${gradeMatches.length} call grade(s) flagged "${params.query}" as a competitor`);

  if (!results.length) return `No mentions of "${params.query}" found in your transcripts, accounts, or deals.`;
  return `🔍 Competitive Intel for "${params.query}":\n\n${results.slice(0, 10).join('\n\n')}${results.length > 10 ? `\n\n...and ${results.length - 10} more mentions` : ''}`;
}
