import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { streamingFetch } from '@/lib/streamingFetch';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

export interface MockCallSession {
  id: string;
  user_id: string;
  status: string;
  call_type: string;
  industry: string | null;
  persona: string;
  difficulty: number;
  scenario: Json;
  messages: { role: 'user' | 'assistant'; content: string }[];
  live_tracking: Json;
  grade_data: Json | null;
  overall_grade: string | null;
  overall_score: number | null;
  skill_mode: string | null;
  parent_session_id: string | null;
  retry_from_index: number | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export function useMockCallSessions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['mock-call-sessions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mock_call_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as MockCallSession[];
    },
    enabled: !!user,
  });
}

export function useCreateMockSession() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (config: { call_type: string; industry: string; persona: string; difficulty: number; skill_mode?: string }) => {
      const { data, error } = await supabase
        .from('mock_call_sessions')
        .insert({ user_id: user!.id, ...config })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as MockCallSession;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mock-call-sessions'] }),
  });
}

export function useSaveMockMessages() {
  return useMutation({
    mutationFn: async ({ sessionId, messages }: { sessionId: string; messages: { role: string; content: string }[] }) => {
      const { error } = await supabase
        .from('mock_call_sessions')
        .update({ messages: messages as unknown as Json })
        .eq('id', sessionId);
      if (error) throw error;
    },
  });
}

export function useGradeMockCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await trackedInvoke<{ error?: string; overall_grade?: string }>('grade-mock-call', {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock-call-sessions'] });
      toast.success('Mock call graded!');
    },
    onError: (err: Error) => {
      toast.error('Grading failed', { description: err.message });
    },
  });
}

export async function streamMockCall({
  messages,
  config,
  sessionId,
  onDelta,
  onDone,
  onError,
  signal,
}: {
  messages: { role: 'user' | 'assistant'; content: string }[];
  config: { callType: string; industry: string; persona: string; difficulty: number; skillMode?: string };
  sessionId: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  signal?: AbortSignal;
}) {
  await streamingFetch(
    {
      functionName: 'mock-call',
      body: { messages, config, sessionId },
      signal,
    },
    { onDelta, onDone, onError: (msg) => onError(msg) },
  );
}
