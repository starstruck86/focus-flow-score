/**
 * Data access layer for contacts table.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ContactRow = Database['public']['Tables']['contacts']['Row'];
type ContactInsert = Database['public']['Tables']['contacts']['Insert'];
type ContactUpdate = Database['public']['Tables']['contacts']['Update'];

export type { ContactRow, ContactInsert, ContactUpdate };

export async function getContacts(): Promise<ContactRow[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

export async function findContactBySalesforceId(sfId: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('salesforce_id', sfId)
    .maybeSingle();
  return data;
}

export async function findContactByEmail(email: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  return data;
}

export async function insertContact(payload: ContactInsert): Promise<ContactRow> {
  const { data, error } = await supabase
    .from('contacts')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateContact(id: string, updates: ContactUpdate): Promise<ContactRow> {
  const { data, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
