import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface PlaybookItem {
  content: string;
  citations: string[];
  type: 'tactic' | 'question' | 'talk_track' | 'framework' | 'warning' | 'tip';
}

export interface PlaybookSection {
  title: string;
  items: PlaybookItem[];
}

export interface PlaybookContent {
  title: string;
  summary: string;
  sections: PlaybookSection[];
}

export interface StagePlaybook {
  id: string;
  stage_id: string;
  content: PlaybookContent;
  resource_ids: string[];
  keystone_resource_ids: string[];
  knowledge_item_count: number;
  generated_at: string;
}

const TABLE = 'stage_playbooks' as any;

export function useStagePlaybook(stageId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ['stage-playbook', user?.id, stageId];

  const { data: playbook, isLoading } = useQuery({
    queryKey,
    enabled: !!user && !!stageId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('user_id', user!.id)
        .eq('stage_id', stageId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const d = data as any;
      return {
        id: d.id,
        stage_id: d.stage_id,
        content: d.content as PlaybookContent,
        resource_ids: d.resource_ids,
        keystone_resource_ids: d.keystone_resource_ids,
        knowledge_item_count: d.knowledge_item_count,
        generated_at: d.generated_at,
      } as StagePlaybook;
    },
  });

  const generate = useMutation({
    mutationFn: async (params: { resourceIds: string[]; keystoneResourceIds: string[] }) => {
      const { data, error } = await supabase.functions.invoke('generate-stage-playbook', {
        body: {
          stage_id: stageId,
          resource_ids: params.resourceIds,
          keystone_resource_ids: params.keystoneResourceIds,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey });
      toast.success(`Playbook generated — ${data.knowledge_item_count} KIs compiled`);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to generate playbook');
    },
  });

  return { playbook, isLoading, generate };
}
