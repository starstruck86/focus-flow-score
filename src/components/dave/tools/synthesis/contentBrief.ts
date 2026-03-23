import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatTimeETLabel } from '@/lib/timeFormat';
import type { ToolContext } from '../../toolTypes';

export async function generateContent(ctx: ToolContext, params: { contentType: string; accountName?: string; opportunityName?: string; contactName?: string; customInstructions?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  let accountContext: { id: string; name: string; industry: string | null; notes: string | null; contacts?: string } | null = null;
  let oppContext: { id: string; name: string; stage: string | null; arr: number | null; close_date: string | null; next_step: string | null } | null = null;
  let transcriptContext = '';
  let methodologyContext = '';

  if (params.accountName) {
    const { data: accounts } = await supabase.from('accounts').select('id, name, industry, notes').eq('user_id', userId).ilike('name', `%${params.accountName}%`).limit(1);
    if (accounts?.length) {
      accountContext = accounts[0];
      const { data: transcripts } = await supabase.from('call_transcripts').select('summary, call_date, call_type').eq('user_id', userId).eq('account_id', accountContext.id).order('call_date', { ascending: false }).limit(2);
      if (transcripts?.length) transcriptContext = transcripts.map((t: { call_date: string; call_type: string | null; summary: string | null }) => `[${t.call_date} ${t.call_type}]: ${t.summary || 'No summary'}`).join('\n');
      const { data: contacts } = await supabase.from('contacts').select('name, title, buyer_role').eq('user_id', userId).eq('account_id', accountContext.id).limit(5);
      if (contacts?.length) accountContext.contacts = contacts.map((c: { name: string; title: string | null; buyer_role: string | null }) => `${c.name} (${c.title || 'N/A'}, ${c.buyer_role || 'N/A'})`).join(', ');
    }
  }

  if (params.opportunityName) {
    const { data: opps } = await supabase.from('opportunities').select('id, name, stage, arr, close_date, next_step').eq('user_id', userId).ilike('name', `%${params.opportunityName}%`).limit(1);
    if (opps?.length) {
      oppContext = opps[0];
      const { data: meth } = await supabase.from('opportunity_methodology' as 'opportunity_methodology').select('*').eq('opportunity_id', oppContext.id).maybeSingle();
      if (meth) {
        const m = meth as Record<string, unknown>;
        const gaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'].filter(f => !m[`${f}_confirmed`]);
        methodologyContext = `MEDDICC gaps: ${gaps.length ? gaps.join(', ') : 'All confirmed'}`;
      }
    }
  }

  const contextParts: string[] = [];
  if (accountContext) contextParts.push(`Account: ${accountContext.name} (${accountContext.industry || 'N/A'})`);
  if (oppContext) contextParts.push(`Deal: ${oppContext.name} — Stage: ${oppContext.stage}, ARR: $${oppContext.arr}, Close: ${oppContext.close_date}`);
  if (methodologyContext) contextParts.push(methodologyContext);
  if (transcriptContext) contextParts.push(`Recent calls:\n${transcriptContext}`);
  if (params.contactName) contextParts.push(`Key contact: ${params.contactName}`);

  const fullPrompt = `${params.customInstructions || `Generate a professional ${params.contentType}`}\n\nContext:\n${contextParts.join('\n')}`;

  try {
    const { streamToString } = await import('@/lib/streamingFetch');
    const { text: result, error } = await streamToString({
      functionName: 'build-resource',
      body: { type: 'generate', prompt: fullPrompt, outputType: params.contentType || 'email', accountContext: accountContext ? { name: accountContext.name, industry: accountContext.industry, contacts: accountContext.contacts } : undefined },
    });

    if (error) throw new Error(error);
    if (result && navigator.clipboard) { try { await navigator.clipboard.writeText(result); } catch {} }

    toast.success(`${params.contentType} generated`, { description: 'Copied to clipboard' });
    return `✅ Generated ${params.contentType}:\n\n${result.slice(0, 2000)}${result.length > 2000 ? '\n\n[...truncated, full content copied to clipboard]' : ''}`;
  } catch (e: unknown) {
    return `Failed to generate content: ${(e as Error).message}`;
  }
}

export async function meetingBrief(ctx: ToolContext, params: { meetingTitle?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = await supabase.from('calendar_events').select('id, title, start_time, end_time, description').eq('user_id', userId).gte('start_time', now).lte('start_time', tomorrow).order('start_time', { ascending: true }).limit(10);

  if (!events?.length) return 'No upcoming meetings found in the next 24 hours.';

  type CalEvent = { id: string; title: string; start_time: string; end_time: string | null; description: string | null };
  let target = events[0] as CalEvent;
  if (params.meetingTitle) {
    const match = (events as CalEvent[]).find(e => e.title.toLowerCase().includes(params.meetingTitle!.toLowerCase()));
    if (match) target = match;
  }

  const { data: accounts } = await supabase.from('accounts').select('id, name, industry, tier, notes, last_touch_date, account_status').eq('user_id', userId);

  type MatchedAccount = { id: string; name: string; industry: string | null; tier: string | null; account_status: string | null };
  const matchedAccount = (accounts || []).find((a: MatchedAccount) =>
    target.title.toLowerCase().includes(a.name.toLowerCase()) ||
    a.name.toLowerCase().includes(target.title.toLowerCase().replace(/meeting|call|sync|review|check-in|intro/gi, '').trim())
  ) as MatchedAccount | undefined;

  if (!matchedAccount) {
    return `📅 Next meeting: "${target.title}" at ${formatTimeETLabel(target.start_time)}\n\nCouldn't match to an account — try "prep meeting for [account name]" for a full brief.`;
  }

  const { data: opps } = await supabase.from('opportunities').select('id, name, stage, arr, close_date, next_step').eq('user_id', userId).eq('account_id', matchedAccount.id).not('status', 'eq', 'closed-won').not('status', 'eq', 'closed-lost').limit(3);

  let methSummary = '';
  if (opps?.length) {
    const { data: meth } = await supabase.from('opportunity_methodology' as 'opportunity_methodology').select('*').eq('opportunity_id', opps[0].id).maybeSingle();
    if (meth) {
      const m = meth as Record<string, unknown>;
      const gaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'].filter(f => !m[`${f}_confirmed`]);
      methSummary = gaps.length ? `\n⚠️ MEDDICC Gaps: ${gaps.join(', ')}` : '\n✅ All MEDDICC confirmed';
    }
  }

  const { data: transcripts } = await supabase.from('call_transcripts').select('summary, call_date').eq('user_id', userId).eq('account_id', matchedAccount.id).order('call_date', { ascending: false }).limit(1);
  const { data: contacts } = await supabase.from('contacts').select('name, title, buyer_role').eq('user_id', userId).eq('account_id', matchedAccount.id).limit(5);

  const meetTime = formatTimeETLabel(target.start_time);
  const minsAway = Math.round((new Date(target.start_time).getTime() - Date.now()) / 60000);

  let brief = `📋 MEETING BRIEF: "${target.title}" at ${meetTime} (${minsAway > 0 ? `in ${minsAway} min` : 'now'})\n\n`;
  brief += `🏢 ${matchedAccount.name} | ${matchedAccount.industry || 'N/A'} | Tier ${matchedAccount.tier || 'N/A'} | Status: ${matchedAccount.account_status || 'N/A'}\n`;

  if (opps?.length) {
    brief += `\n💼 Active Deals:\n${opps.map((o: { name: string; stage: string | null; arr: number | null; close_date: string | null }) => `• ${o.name} — ${o.stage} — $${((o.arr || 0) / 1000).toFixed(0)}k${o.close_date ? ` — Close: ${o.close_date}` : ''}`).join('\n')}`;
    brief += methSummary;
  }

  if (contacts?.length) {
    brief += `\n\n👥 Key Contacts:\n${contacts.map((c: { name: string; title: string | null; buyer_role: string | null }) => `• ${c.name}${c.title ? ` (${c.title})` : ''}${c.buyer_role ? ` — ${c.buyer_role}` : ''}`).join('\n')}`;
  }

  if (transcripts?.length) {
    const t = transcripts[0] as { summary: string | null; call_date: string };
    brief += `\n\n📞 Last Call (${t.call_date}):\n${(t.summary || 'No summary').slice(0, 300)}`;
  }

  return brief;
}
