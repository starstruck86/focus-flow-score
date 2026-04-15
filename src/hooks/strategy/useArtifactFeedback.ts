import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface ArtifactFeedback {
  id: string;
  artifact_id: string;
  rating: number;
  feedback_text: string | null;
  created_at: string;
}

export function useArtifactFeedback() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const submitFeedback = useCallback(async (
    artifactId: string,
    rating: number,
    feedbackText?: string,
  ) => {
    if (!user) return;
    setSubmitting(true);
    try {
      const { error } = await (supabase as any)
        .from('strategy_artifact_feedback')
        .insert({
          artifact_id: artifactId,
          user_id: user.id,
          rating,
          feedback_text: feedbackText || null,
        });
      if (error) throw error;
      toast.success(rating > 0 ? 'Thanks for the feedback!' : 'Feedback recorded');
    } catch {
      toast.error('Failed to save feedback');
    } finally {
      setSubmitting(false);
    }
  }, [user]);

  return { submitFeedback, submitting };
}
