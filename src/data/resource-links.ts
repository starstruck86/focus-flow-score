/**
 * Data access layer for resource_links table.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ResourceLinkRow = Database['public']['Tables']['resource_links']['Row'];
type ResourceLinkInsert = Database['public']['Tables']['resource_links']['Insert'];
type ResourceLinkUpdate = Database['public']['Tables']['resource_links']['Update'];

export type { ResourceLinkRow, ResourceLinkInsert, ResourceLinkUpdate };

export interface ResourceLinkFilters {
  accountId?: string;
  opportunityId?: string;
  renewalId?: string;
  category?: string;
}

export async function getResourceLinks(filters?: ResourceLinkFilters): Promise<ResourceLinkRow[]> {
  let query = supabase
    .from('resource_links')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.accountId) query = query.eq('account_id', filters.accountId);
  if (filters?.opportunityId) query = query.eq('opportunity_id', filters.opportunityId);
  if (filters?.renewalId) query = query.eq('renewal_id', filters.renewalId);
  if (filters?.category) query = query.eq('category', filters.category);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getAllResourceLinks(limit = 200): Promise<ResourceLinkRow[]> {
  const { data, error } = await supabase
    .from('resource_links')
    .select('*')
    .order('category', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function insertResourceLink(payload: ResourceLinkInsert): Promise<void> {
  const { error } = await supabase.from('resource_links').insert(payload);
  if (error) throw error;
}

export async function updateResourceLink(id: string, updates: ResourceLinkUpdate): Promise<void> {
  const { error } = await supabase
    .from('resource_links')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteResourceLink(id: string): Promise<void> {
  const { error } = await supabase.from('resource_links').delete().eq('id', id);
  if (error) throw error;
}
