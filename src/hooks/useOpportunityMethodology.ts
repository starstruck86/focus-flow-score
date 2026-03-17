import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface OpportunityMethodology {
  id: string;
  user_id: string;
  opportunity_id: string;
  metrics_confirmed: boolean;
  metrics_notes: string;
  economic_buyer_confirmed: boolean;
  economic_buyer_notes: string;
  decision_criteria_confirmed: boolean;
  decision_criteria_notes: string;
  decision_process_confirmed: boolean;
  decision_process_notes: string;
  identify_pain_confirmed: boolean;
  identify_pain_notes: string;
  champion_confirmed: boolean;
  champion_notes: string;
  competition_confirmed: boolean;
  competition_notes: string;
  before_state_notes: string;
  after_state_notes: string;
  negative_consequences_notes: string;
  positive_business_outcomes_notes: string;
  required_capabilities_notes: string;
  metrics_value_notes: string;
  call_goals: CallGoal[];
}

export interface CallGoal {
  id: string;
  text: string;
  completed: boolean;
  callDate?: string;
}

export function useOpportunityMethodology(opportunityId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['opportunity-methodology', opportunityId],
    queryFn: async () => {
      if (!opportunityId || !user) return null;
      const { data, error } = await supabase
        .from('opportunity_methodology' as any)
        .select('*')
        .eq('opportunity_id', opportunityId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as OpportunityMethodology | null;
    },
    enabled: !!opportunityId && !!user,
  });

  const upsert = useMutation({
    mutationFn: async (updates: Partial<OpportunityMethodology>) => {
      if (!opportunityId || !user) throw new Error('Missing context');
      const { data, error } = await supabase
        .from('opportunity_methodology' as any)
        .upsert({
          user_id: user.id,
          opportunity_id: opportunityId,
          ...updates,
        } as any, { onConflict: 'user_id,opportunity_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opportunity-methodology', opportunityId] });
    },
  });

  return { data: query.data, isLoading: query.isLoading, upsert };
}
