/**
 * Data access layer for accounts table.
 * All direct Supabase queries for accounts are centralized here.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AccountRow = Database['public']['Tables']['accounts']['Row'];
type AccountInsert = Database['public']['Tables']['accounts']['Insert'];
type AccountUpdate = Database['public']['Tables']['accounts']['Update'];

export type { AccountRow, AccountInsert, AccountUpdate };

export async function getAccounts(): Promise<AccountRow[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

export async function getAccountById(id: string): Promise<AccountRow | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findAccountBySalesforceId(sfId: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id')
    .eq('salesforce_id', sfId)
    .maybeSingle();
  return data;
}

export async function findAccountByWebsite(domain: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id, website')
    .ilike('website', `%${domain}%`)
    .maybeSingle();
  return data;
}

export async function findAccountByName(name: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id')
    .ilike('name', name.trim())
    .maybeSingle();
  return data;
}

export async function insertAccount(payload: AccountInsert): Promise<AccountRow> {
  const { data, error } = await supabase
    .from('accounts')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAccount(id: string, updates: AccountUpdate): Promise<AccountRow> {
  const { data, error } = await supabase
    .from('accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from('accounts').delete().eq('id', id);
  if (error) throw error;
}
