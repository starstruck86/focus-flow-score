import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { trackedInvoke } from '@/lib/trackedInvoke';

export interface Playbook {
  id: string;
  user_id: string;
  title: string;
  problem_type: string;
  when_to_use: string;
  why_it_matters: string;
  stage_fit: string[];
  persona_fit: string[];
  tactic_steps: string[];
  talk_tracks: string[];
  key_questions: string[];
  traps: string[];
  anti_patterns: string[];
  confidence_score: number;
  source_resource_ids: string[];
  created_at: string;
  updated_at: string;
}

export function usePlaybooks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['playbooks', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('playbooks' as any)
        .select('*')
        .order('confidence_score', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Playbook[];
    },
    enabled: !!user,
  });
}

export function useGeneratePlaybooks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await trackedInvoke<any>('generate-playbooks', {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['playbooks'] });
      toast.success(`Generated ${data?.count ?? 0} playbook(s)`);
    },
    onError: (e: any) => toast.error(e.message || 'Playbook generation failed'),
  });
}

export function useDeletePlaybook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('playbooks' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playbooks'] });
      toast.success('Playbook deleted');
    },
  });
}
