/**
 * Data access layer for renewals table.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type RenewalRow = Database['public']['Tables']['renewals']['Row'];
type RenewalInsert = Database['public']['Tables']['renewals']['Insert'];
type RenewalUpdate = Database['public']['Tables']['renewals']['Update'];

export type { RenewalRow, RenewalInsert, RenewalUpdate };

export async function getRenewals(): Promise<RenewalRow[]> {
  const { data, error } = await supabase
    .from('renewals')
    .select('*')
    .order('renewal_due');
  if (error) throw error;
  return data;
}

export async function findRenewalByAccountName(name: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('renewals')
    .select('id')
    .ilike('account_name', name.trim())
    .maybeSingle();
  return data;
}

export async function insertRenewal(payload: RenewalInsert): Promise<RenewalRow> {
  const { data, error } = await supabase
    .from('renewals')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRenewal(id: string, updates: RenewalUpdate): Promise<RenewalRow> {
  const { data, error } = await supabase
    .from('renewals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
