import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CallTranscript {
  id: string;
  user_id: string;
  opportunity_id: string | null;
  renewal_id: string | null;
  account_id: string | null;
  title: string;
  content: string;
  summary: string | null;
  call_date: string;
  call_type: string | null;
  participants: string | null;
  tags: string[] | null;
  notes: string | null;
  file_url: string | null;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export function useCallTranscripts(filters?: {
  accountId?: string;
  opportunityId?: string;
  renewalId?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ['call-transcripts', filters],
    queryFn: async () => {
      let query = supabase
        .from('call_transcripts' as any)
        .select('*')
        .order('call_date', { ascending: false });

      if (filters?.accountId) {
        query = query.eq('account_id', filters.accountId);
      }
      if (filters?.opportunityId) {
        query = query.eq('opportunity_id', filters.opportunityId);
      }
      if (filters?.renewalId) {
        query = query.eq('renewal_id', filters.renewalId);
      }
      if (filters?.search) {
        query = query.textSearch('content', filters.search);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return (data || []) as unknown as CallTranscript[];
    },
  });
}

export function useTranscriptsForAccount(accountId: string | undefined) {
  return useQuery({
    queryKey: ['call-transcripts', 'account', accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('call_transcripts' as any)
        .select('*')
        .eq('account_id', accountId)
        .order('call_date', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as CallTranscript[];
    },
    enabled: !!accountId,
  });
}

export function useRecentTranscriptsForMeetingPrep(accountId: string | undefined) {
  return useQuery({
    queryKey: ['call-transcripts', 'prep', accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('call_transcripts' as any)
        .select('id, title, call_date, call_type, summary, participants, notes')
        .eq('account_id', accountId)
        .order('call_date', { ascending: false })
        .limit(3);
      if (error) throw error;
      return (data || []) as Partial<CallTranscript>[];
    },
    enabled: !!accountId,
  });
}

export function useSaveTranscript() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (transcript: {
      title: string;
      content: string;
      summary?: string;
      call_date: string;
      call_type?: string;
      participants?: string;
      tags?: string[];
      notes?: string;
      opportunity_id?: string;
      renewal_id?: string;
      account_id?: string;
      duration_minutes?: number;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('call_transcripts' as any)
        .insert({
          ...transcript,
          user_id: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as CallTranscript;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call-transcripts'] });
    },
  });
}

export function useDeleteTranscript() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('call_transcripts' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call-transcripts'] });
    },
  });
}
