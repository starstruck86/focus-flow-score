// React Query hooks for accounts, contacts, opportunities, renewals
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// Types for database tables
export interface DbAccount {
  id: string;
  user_id: string;
  name: string;
  website?: string;
  industry?: string;
  priority: 'high' | 'medium' | 'low';
  tier: 'A' | 'B' | 'C';
  account_status: string; // 'researching' | 'prepped' | 'active' | 'inactive' | 'disqualified' | 'meeting-booked'
  motion: 'new-logo' | 'renewal' | 'general' | 'both';
  salesforce_link?: string;
  salesforce_id?: string;
  planhat_link?: string;
  current_agreement_link?: string;
  tech_stack: string[];
  tech_stack_notes?: string;
  tech_fit_flag: 'good' | 'watch' | 'disqualify';
  outreach_status: string;
  cadence_name?: string;
  last_touch_date?: string;
  last_touch_type?: string;
  touches_this_week: number;
  next_step?: string;
  next_touch_due?: string;
  notes?: string;
  mar_tech?: string;
  ecommerce?: string;
  contact_status?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface DbContact {
  id: string;
  user_id: string;
  account_id?: string;
  name: string;
  title?: string;
  department?: string;
  seniority?: string;
  email?: string;
  linkedin_url?: string;
  salesforce_link?: string;
  salesforce_id?: string;
  status: 'target' | 'engaged' | 'unresponsive' | 'not-fit';
  last_touch_date?: string;
  preferred_channel?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface DbOpportunity {
  id: string;
  user_id: string;
  account_id?: string;
  name: string;
  salesforce_link?: string;
  salesforce_id?: string;
  status: 'active' | 'stalled' | 'closed-lost' | 'closed-won';
  stage: string;
  arr?: number;
  churn_risk?: 'certain' | 'high' | 'medium' | 'low';
  close_date?: string;
  next_step?: string;
  next_step_date?: string;
  last_touch_date?: string;
  notes?: string;
  deal_type?: 'new-logo' | 'expansion' | 'renewal' | 'one-time';
  payment_terms?: 'annual' | 'prepaid' | 'other';
  term_months?: number;
  prior_contract_arr?: number;
  renewal_arr?: number;
  one_time_amount?: number;
  is_new_logo?: boolean;
  linked_renewal_id?: string;
  activity_log: any[];
  created_at: string;
  updated_at: string;
}

export interface DbRenewal {
  id: string;
  user_id: string;
  account_id?: string;
  account_name: string;
  csm?: string;
  arr: number;
  renewal_due: string;
  renewal_quarter?: string;
  entitlements?: string;
  usage?: string;
  term?: string;
  planhat_link?: string;
  current_agreement_link?: string;
  auto_renew: boolean;
  product?: string;
  cs_notes?: string;
  next_step?: string;
  health_status: 'green' | 'yellow' | 'red';
  churn_risk: 'certain' | 'high' | 'medium' | 'low';
  linked_opportunity_id?: string;
  risk_reason?: string;
  renewal_stage?: string;
  owner?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// Accounts hooks
export function useDbAccounts() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-accounts', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return data as DbAccount[];
    },
    enabled: !!user?.id,
  });
}

export function useUpsertAccount() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (account: Partial<DbAccount> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      // Try to find existing account by salesforce_id, website domain, or name
      let existingId: string | undefined;
      
      if (account.salesforce_id) {
        const { data } = await supabase
          .from('accounts')
          .select('id')
          .eq('salesforce_id', account.salesforce_id)
          .maybeSingle();
        existingId = data?.id;
      }
      
      if (!existingId && account.website) {
        const domain = extractDomain(account.website);
        if (domain) {
          const { data } = await supabase
            .from('accounts')
            .select('id, website')
            .ilike('website', `%${domain}%`)
            .maybeSingle();
          existingId = data?.id;
        }
      }
      
      if (!existingId) {
        const { data } = await supabase
          .from('accounts')
          .select('id')
          .ilike('name', account.name.trim())
          .maybeSingle();
        existingId = data?.id;
      }
      
      const payload = {
        ...account,
        user_id: user.id,
      };
      
      if (existingId) {
        const { data, error } = await supabase
          .from('accounts')
          .update(payload)
          .eq('id', existingId)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: true };
      } else {
        const { data, error } = await supabase
          .from('accounts')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-accounts'] });
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<DbAccount> }) => {
      const { data, error } = await supabase
        .from('accounts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-accounts'] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-accounts'] });
    },
  });
}

// Contacts hooks
export function useDbContacts() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-contacts', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return data as DbContact[];
    },
    enabled: !!user?.id,
  });
}

export function useUpsertContact() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (contact: Partial<DbContact> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      let existingId: string | undefined;
      
      if (contact.salesforce_id) {
        const { data } = await supabase
          .from('contacts')
          .select('id')
          .eq('salesforce_id', contact.salesforce_id)
          .maybeSingle();
        existingId = data?.id;
      }
      
      if (!existingId && contact.email) {
        const { data } = await supabase
          .from('contacts')
          .select('id')
          .ilike('email', contact.email)
          .maybeSingle();
        existingId = data?.id;
      }
      
      const payload = {
        ...contact,
        user_id: user.id,
      };
      
      if (existingId) {
        const { data, error } = await supabase
          .from('contacts')
          .update(payload)
          .eq('id', existingId)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: true };
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-contacts'] });
    },
  });
}

// Opportunities hooks
export function useDbOpportunities() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-opportunities', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as DbOpportunity[];
    },
    enabled: !!user?.id,
  });
}

export function useUpsertOpportunity() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (opp: Partial<DbOpportunity> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      let existingId: string | undefined;
      
      if (opp.salesforce_id) {
        const { data } = await supabase
          .from('opportunities')
          .select('id')
          .eq('salesforce_id', opp.salesforce_id)
          .maybeSingle();
        existingId = data?.id;
      }
      
      const payload = {
        ...opp,
        user_id: user.id,
      };
      
      if (existingId) {
        const { data, error } = await supabase
          .from('opportunities')
          .update(payload)
          .eq('id', existingId)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: true };
      } else {
        const { data, error } = await supabase
          .from('opportunities')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
    },
  });
}

export function useUpdateOpportunity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<DbOpportunity> }) => {
      const { data, error } = await supabase
        .from('opportunities')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
    },
  });
}

export function useDeleteOpportunity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('opportunities').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
    },
  });
}

export function useAddOpportunity() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (opp: Partial<DbOpportunity> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('opportunities')
        .insert({ ...opp, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
    },
  });
}

export function useUpdateRenewal() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<DbRenewal> }) => {
      const { data, error } = await supabase
        .from('renewals')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-renewals'] });
    },
  });
}


// Renewals hooks
export function useDbRenewals() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-renewals', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('renewals')
        .select('*')
        .order('renewal_due');
      
      if (error) throw error;
      return data as DbRenewal[];
    },
    enabled: !!user?.id,
  });
}

export function useUpsertRenewal() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (renewal: Partial<DbRenewal> & { account_name: string; renewal_due: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      // Find existing by account name
      const { data: existing } = await supabase
        .from('renewals')
        .select('id')
        .ilike('account_name', renewal.account_name.trim())
        .maybeSingle();
      
      const payload = {
        ...renewal,
        user_id: user.id,
      };
      
      if (existing?.id) {
        const { data, error } = await supabase
          .from('renewals')
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: true };
      } else {
        const { data, error } = await supabase
          .from('renewals')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-renewals'] });
    },
  });
}

// Helper to extract domain from URL
function extractDomain(url: string): string | null {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
