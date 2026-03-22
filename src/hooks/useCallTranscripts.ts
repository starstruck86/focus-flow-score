import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTranscripts,
  getTranscriptsForAccount,
  getRecentTranscriptsForPrep,
  insertTranscript,
  updateTranscript as updateTranscriptQuery,
  deleteTranscript as deleteTranscriptQuery,
  type TranscriptRow,
  type TranscriptFilters,
} from '@/data/call-transcripts';

export type CallTranscript = TranscriptRow;

export function useCallTranscripts(filters?: TranscriptFilters) {
  return useQuery({
    queryKey: ['call-transcripts', filters],
    queryFn: () => getTranscripts(filters),
  });
}

export function useTranscriptsForAccount(accountId: string | undefined) {
  return useQuery({
    queryKey: ['call-transcripts', 'account', accountId],
    queryFn: () => getTranscriptsForAccount(accountId!),
    enabled: !!accountId,
  });
}

export function useRecentTranscriptsForMeetingPrep(accountId: string | undefined) {
  return useQuery({
    queryKey: ['call-transcripts', 'prep', accountId],
    queryFn: () => getRecentTranscriptsForPrep(accountId!),
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
      return insertTranscript({ ...transcript, user_id: user.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call-transcripts'] });
    },
  });
}

export function useUpdateTranscript() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Omit<TranscriptRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>> }) => {
      return updateTranscriptQuery(id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call-transcripts'] });
    },
  });
}

export function useDeleteTranscript() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTranscriptQuery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call-transcripts'] });
    },
  });
}
