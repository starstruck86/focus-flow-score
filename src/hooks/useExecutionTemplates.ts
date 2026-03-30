import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { ExecutionTemplate, OutputType } from '@/lib/executionTemplateTypes';

export function useExecutionTemplates(outputType?: OutputType) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['execution-templates', user?.id, outputType],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from('execution_templates' as any)
        .select('*')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .order('is_pinned', { ascending: false })
        .order('times_used', { ascending: false });
      if (outputType && outputType !== 'custom') {
        q = q.eq('output_type', outputType);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as ExecutionTemplate[];
    },
  });
}

export function useCreateTemplate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<ExecutionTemplate> & { title: string; body: string }) => {
      const { data, error } = await supabase
        .from('execution_templates' as any)
        .insert({ ...input, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ExecutionTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution-templates'] }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...rest }: Partial<ExecutionTemplate> & { id: string }) => {
      const { error } = await supabase
        .from('execution_templates' as any)
        .update(rest as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution-templates'] }),
  });
}

export function useRecordTemplateSelection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('increment_template_selection' as any, { template_id: id });
      // Fallback if RPC doesn't exist
      if (error) {
        await supabase
          .from('execution_templates' as any)
          .update({ times_selected: supabase.rpc as any } as any)
          .eq('id', id);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution-templates'] }),
  });
}
