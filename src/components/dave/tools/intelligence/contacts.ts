import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import type { ToolContext } from '../../toolTypes';

export async function lookupContact(ctx: ToolContext, params: { accountName: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const { data: accts } = await supabase.from('accounts').select('id, name').eq('user_id', userId).is('deleted_at', null).ilike('name', `%${params.accountName}%`).limit(1);
  if (!accts?.length) return `Account "${params.accountName}" not found`;

  const { data: contacts } = await supabase.from('contacts').select('name, title, email, buyer_role, influence_level, department, status').eq('account_id', accts[0].id).limit(20);

  if (!contacts?.length) return `No contacts found for ${accts[0].name}`;
  return `Contacts at ${accts[0].name}:\n` + contacts.map(c =>
    `• ${c.name}${c.title ? ` (${c.title})` : ''}${c.department ? ` — ${c.department}` : ''}${c.buyer_role ? ` [${c.buyer_role}]` : ''}${c.email ? ` ${c.email}` : ''}`
  ).join('\n');
}

export async function addContact(ctx: ToolContext, params: { name: string; title?: string; email?: string; accountName?: string; department?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  let accountId: string | null = null;
  if (params.accountName) {
    const { data: accts } = await supabase.from('accounts').select('id').eq('user_id', userId).is('deleted_at', null).ilike('name', `%${params.accountName}%`).limit(1);
    accountId = accts?.[0]?.id ?? null;
  }

  const { error } = await supabase.from('contacts').insert({
    user_id: userId,
    name: params.name,
    title: params.title || null,
    email: params.email || null,
    account_id: accountId,
    department: params.department || null,
    discovery_source: 'voice',
  });

  if (error) return `Failed to add contact: ${error.message}`;
  emitDataChanged('contacts');
  toast.success('Contact added', { description: `${params.name}${params.title ? ` — ${params.title}` : ''}` });
  return `Added contact ${params.name}${params.accountName ? ` at ${params.accountName}` : ''}`;
}

export async function stakeholderQuery(ctx: ToolContext, params: { accountName: string; role?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const { data: accts } = await supabase.from('accounts').select('id, name').eq('user_id', userId).is('deleted_at', null).ilike('name', `%${params.accountName}%`).limit(1);
  if (!accts?.length) return `Account "${params.accountName}" not found`;

  let query = supabase.from('contacts').select('name, title, department, buyer_role, influence_level, email, reporting_to, status, seniority').eq('account_id', accts[0].id);
  if (params.role) query = query.or(`buyer_role.ilike.%${params.role}%,title.ilike.%${params.role}%`);

  const { data: contacts } = await query.limit(20);
  if (!contacts?.length) return `No stakeholders found at ${accts[0].name}${params.role ? ` matching "${params.role}"` : ''}`;

  const byInfluence = contacts.sort((a, b) => {
    const levels: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return (levels[b.influence_level || ''] || 0) - (levels[a.influence_level || ''] || 0);
  });

  return `Stakeholders at ${accts[0].name}:\n` +
    byInfluence.map(c =>
      `• ${c.name}${c.title ? ` — ${c.title}` : ''}${c.department ? ` (${c.department})` : ''}\n  Role: ${c.buyer_role || '—'} | Influence: ${c.influence_level || '—'} | Status: ${c.status || '—'}${c.reporting_to ? ` | Reports to: ${c.reporting_to}` : ''}`
    ).join('\n');
}

export async function contactTimeline(ctx: ToolContext, params: { contactName: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const { data: contacts } = await supabase.from('contacts').select('id, name, title, account_id, last_touch_date').eq('user_id', userId).ilike('name', `%${params.contactName}%`).limit(1);
  if (!contacts?.length) return `Contact matching "${params.contactName}" not found`;
  const contact = contacts[0];

  const { data: transcripts } = await supabase.from('call_transcripts').select('id, title, call_date, call_type').eq('user_id', userId).or(`participants.ilike.%${params.contactName}%,title.ilike.%${params.contactName}%`).order('call_date', { ascending: false }).limit(5);

  const { data: events } = await supabase.from('calendar_events').select('id, title, start_time').eq('user_id', userId).ilike('title', `%${params.contactName}%`).order('start_time', { ascending: false }).limit(5);

  const engagements: string[] = [];
  for (const t of (transcripts || []) as Array<{ call_date: string; title: string; call_type: string | null }>) engagements.push(`📞 ${t.call_date}: ${t.title} (${t.call_type || 'call'})`);
  for (const e of (events || []) as Array<{ start_time: string; title: string }>) engagements.push(`📅 ${new Date(e.start_time).toLocaleDateString()}: ${e.title}`);

  engagements.sort().reverse();

  const staleDays = contact.last_touch_date
    ? Math.ceil((Date.now() - new Date(contact.last_touch_date).getTime()) / 86400000)
    : null;

  return `👤 ${contact.name}${contact.title ? ` — ${contact.title}` : ''}\n${staleDays !== null ? `Last touch: ${staleDays} days ago${staleDays > 14 ? ' ⚠️ Going cold!' : ''}` : 'No touch date recorded'}\n\nEngagement History:\n${engagements.length ? engagements.slice(0, 8).join('\n') : 'No engagements found — consider reaching out!'}`;
}
