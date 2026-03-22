/**
 * Data access layer for opportunities table.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];
type OpportunityInsert = Database['public']['Tables']['opportunities']['Insert'];
type OpportunityUpdate = Database['public']['Tables']['opportunities']['Update'];

export type { OpportunityRow, OpportunityInsert, OpportunityUpdate };

export async function getOpportunities(): Promise<OpportunityRow[]> {
  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function findOpportunityBySalesforceId(sfId: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('opportunities')
    .select('id')
    .eq('salesforce_id', sfId)
    .maybeSingle();
  return data;
}

export async function insertOpportunity(payload: OpportunityInsert): Promise<OpportunityRow> {
  const { data, error } = await supabase
    .from('opportunities')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateOpportunity(id: string, updates: OpportunityUpdate): Promise<OpportunityRow> {
  const { data, error } = await supabase
    .from('opportunities')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Clears FK references in child tables before deleting the opportunity. */
export async function deleteOpportunity(id: string): Promise<void> {
  await Promise.all([
    supabase.from('tasks').update({ linked_opportunity_id: null }).eq('linked_opportunity_id', id),
    supabase.from('renewals').update({ linked_opportunity_id: null }).eq('linked_opportunity_id', id),
    supabase.from('call_transcripts').update({ opportunity_id: null }).eq('opportunity_id', id),
    supabase.from('resource_links').update({ opportunity_id: null }).eq('opportunity_id', id),
  ]);
  const { error } = await supabase.from('opportunities').delete().eq('id', id);
  if (error) throw error;
}
