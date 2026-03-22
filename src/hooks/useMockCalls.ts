import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { streamingFetch } from '@/lib/streamingFetch';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface MockCallSession {
  id: string;
  user_id: string;
  status: string;
  call_type: string;
  industry: string | null;
  persona: string;
  difficulty: number;
  scenario: any;
  messages: { role: 'user' | 'assistant'; content: string }[];
  live_tracking: any;
  grade_data: any;
  overall_grade: string | null;
  overall_score: number | null;
  skill_mode: string | null;
  parent_session_id: string | null;
  retry_from_index: number | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

const MOCK_CALL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mock-call`;

export function useMockCallSessions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['mock-call-sessions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mock_call_sessions' as any)
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
        .from('mock_call_sessions' as any)
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
    mutationFn: async ({ sessionId, messages }: { sessionId: string; messages: any[] }) => {
      const { error } = await supabase
        .from('mock_call_sessions' as any)
        .update({ messages } as any)
        .eq('id', sessionId);
      if (error) throw error;
    },
  });
}

export function useGradeMockCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await trackedInvoke<any>('grade-mock-call', {
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
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { onError("Not authenticated"); return; }

    const resp = await fetch(MOCK_CALL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ messages, config, sessionId }),
      signal,
    });

    if (!resp.ok) {
      const d = await resp.json().catch(() => ({ error: "Request failed" }));
      onError(d.error || `Error ${resp.status}`);
      return;
    }

    if (!resp.body) { onError("No response body"); return; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") { onDone(); return; }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }

    // Flush
    if (buffer.trim()) {
      for (let raw of buffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch { /* ignore */ }
      }
    }

    onDone();
  } catch (e: any) {
    if (e.name === "AbortError") return;
    onError(e.message || "Connection failed");
  }
}
