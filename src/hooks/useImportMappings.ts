// React Query hooks for import header mappings, value mappings, and account aliases
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Types
export interface HeaderMapping {
  id: string;
  user_id: string;
  csv_header: string;
  target_object: 'account' | 'opportunity' | 'renewal' | 'contact' | 'ignore';
  target_field: string | null;
  data_transform: 'text' | 'url' | 'date' | 'number' | 'picklist' | 'extract_domain' | 'extract_sfdc_id';
  created_at: string;
  updated_at: string;
}

export interface ValueMapping {
  id: string;
  user_id: string;
  field_name: string;
  csv_value: string;
  app_value: string;
  created_at: string;
  updated_at: string;
}

export interface AccountAlias {
  id: string;
  user_id: string;
  alias_type: 'name' | 'domain';
  alias_value: string;
  account_id: string;
  created_at: string;
}

// Header Mappings
export function useHeaderMappings() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['import-header-mappings', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('import_header_mappings')
        .select('*')
        .order('csv_header');
      
      if (error) throw error;
      return data as HeaderMapping[];
    },
    enabled: !!user?.id,
  });
}

export function useSaveHeaderMapping() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (mapping: Omit<HeaderMapping, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('import_header_mappings')
        .upsert({
          ...mapping,
          user_id: user.id,
        }, { onConflict: 'user_id,csv_header' })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-header-mappings'] });
    },
  });
}

export function useDeleteHeaderMapping() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('import_header_mappings')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-header-mappings'] });
    },
  });
}

// Value Mappings
export function useValueMappings() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['import-value-mappings', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('import_value_mappings')
        .select('*')
        .order('field_name');
      
      if (error) throw error;
      return data as ValueMapping[];
    },
    enabled: !!user?.id,
  });
}

export function useSaveValueMapping() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (mapping: Omit<ValueMapping, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('import_value_mappings')
        .upsert({
          ...mapping,
          user_id: user.id,
        }, { onConflict: 'user_id,field_name,csv_value' })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-value-mappings'] });
    },
  });
}

export function useDeleteValueMapping() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('import_value_mappings')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-value-mappings'] });
    },
  });
}

// Account Aliases
export function useAccountAliases() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['import-account-aliases', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('import_account_aliases')
        .select('*')
        .order('alias_value');
      
      if (error) throw error;
      return data as AccountAlias[];
    },
    enabled: !!user?.id,
  });
}

export function useSaveAccountAlias() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (alias: Omit<AccountAlias, 'id' | 'user_id' | 'created_at'>) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('import_account_aliases')
        .upsert({
          ...alias,
          user_id: user.id,
        }, { onConflict: 'user_id,alias_type,alias_value' })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-account-aliases'] });
    },
  });
}

export function useDeleteAccountAlias() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('import_account_aliases')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-account-aliases'] });
    },
  });
}
