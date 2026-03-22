/**
 * Data access layer for call_transcripts table.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type TranscriptRow = Database['public']['Tables']['call_transcripts']['Row'];
type TranscriptInsert = Database['public']['Tables']['call_transcripts']['Insert'];
type TranscriptUpdate = Database['public']['Tables']['call_transcripts']['Update'];

export type { TranscriptRow, TranscriptInsert, TranscriptUpdate };

export interface TranscriptFilters {
  accountId?: string;
  opportunityId?: string;
  renewalId?: string;
  search?: string;
}

export async function getTranscripts(filters?: TranscriptFilters, limit = 100): Promise<TranscriptRow[]> {
  let query = supabase
    .from('call_transcripts')
    .select('*')
    .order('call_date', { ascending: false });

  if (filters?.accountId) query = query.eq('account_id', filters.accountId);
  if (filters?.opportunityId) query = query.eq('opportunity_id', filters.opportunityId);
  if (filters?.renewalId) query = query.eq('renewal_id', filters.renewalId);
  if (filters?.search) query = query.textSearch('content', filters.search);

  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getTranscriptsForAccount(accountId: string, limit = 20): Promise<TranscriptRow[]> {
  const { data, error } = await supabase
    .from('call_transcripts')
    .select('*')
    .eq('account_id', accountId)
    .order('call_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

type PrepTranscriptFields = Pick<TranscriptRow, 'id' | 'title' | 'call_date' | 'call_type' | 'summary' | 'participants' | 'notes'>;

export async function getRecentTranscriptsForPrep(accountId: string): Promise<PrepTranscriptFields[]> {
  const { data, error } = await supabase
    .from('call_transcripts')
    .select('id, title, call_date, call_type, summary, participants, notes')
    .eq('account_id', accountId)
    .order('call_date', { ascending: false })
    .limit(3);
  if (error) throw error;
  return data || [];
}

export async function insertTranscript(payload: TranscriptInsert): Promise<TranscriptRow> {
  const { data, error } = await supabase
    .from('call_transcripts')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTranscript(id: string, updates: TranscriptUpdate): Promise<TranscriptRow> {
  const { data, error } = await supabase
    .from('call_transcripts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTranscript(id: string): Promise<void> {
  const { error } = await supabase.from('call_transcripts').delete().eq('id', id);
  if (error) throw error;
}
