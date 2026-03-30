import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { ExecutionOutput, OutputType } from '@/lib/executionTemplateTypes';

export function useExecutionOutputs(outputType?: OutputType) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['execution-outputs', user?.id, outputType],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from('execution_outputs' as any)
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (outputType && outputType !== 'custom') {
        q = q.eq('output_type', outputType);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as ExecutionOutput[];
    },
  });
}

export function useSaveOutput() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<ExecutionOutput> & { title: string; content: string; output_type: string }) => {
      const { data, error } = await supabase
        .from('execution_outputs' as any)
        .insert({ ...input, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ExecutionOutput;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution-outputs'] }),
  });
}

export function usePromoteOutputToTemplate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (output: ExecutionOutput) => {
      // Mark output as promoted
      await supabase
        .from('execution_outputs' as any)
        .update({ is_promoted_to_template: true } as any)
        .eq('id', output.id);
      // Create template
      const { data, error } = await supabase
        .from('execution_templates' as any)
        .insert({
          user_id: user!.id,
          title: output.title,
          template_type: 'email',
          output_type: output.output_type,
          source_output_id: output.id,
          body: output.content,
          subject_line: output.subject_line,
          tags: [],
          tone: null,
          persona: output.persona,
          stage: output.stage,
          competitor: output.competitor,
          template_origin: 'promoted_from_output',
          status: 'active',
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['execution-templates'] });
      qc.invalidateQueries({ queryKey: ['execution-outputs'] });
    },
  });
}
