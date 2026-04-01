import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type FeedbackType = 'section_useful' | 'section_not_useful' | 'wrong_section' | 'too_generic';
export type TargetType = 'section' | 'ki_placement' | 'playbook_item';

interface FeedbackPayload {
  stageId: string;
  feedbackType: FeedbackType;
  targetType: TargetType;
  targetId?: string;
  framework?: string;
  sectionHeading?: string;
  kiTitle?: string;
  metadata?: Record<string, unknown>;
}

const TABLE = 'playbook_feedback' as any;

export function usePlaybookFeedback() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: FeedbackPayload) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from(TABLE).insert({
        user_id: user.id,
        stage_id: payload.stageId,
        feedback_type: payload.feedbackType,
        target_type: payload.targetType,
        target_id: payload.targetId,
        framework: payload.framework,
        section_heading: payload.sectionHeading,
        ki_title: payload.kiTitle,
        metadata: payload.metadata || {},
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feedback recorded');
      qc.invalidateQueries({ queryKey: ['playbook-feedback'] });
    },
    onError: () => {
      toast.error('Failed to save feedback');
    },
  });
}
