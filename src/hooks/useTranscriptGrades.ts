import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface TranscriptGrade {
  id: string;
  user_id: string;
  transcript_id: string;
  overall_grade: string;
  overall_score: number;
  style_score: number;
  acumen_score: number;
  cadence_score: number;
  style_notes: string | null;
  acumen_notes: string | null;
  cadence_notes: string | null;
  strengths: string[];
  improvements: string[];
  actionable_feedback: string;
  feedback_focus: string;
  summary: string | null;
  methodology_alignment: string | null;
  created_at: string;
  updated_at: string;
}

export function useTranscriptGrade(transcriptId: string | undefined) {
  return useQuery({
    queryKey: ['transcript-grade', transcriptId],
    queryFn: async () => {
      if (!transcriptId) return null;
      const { data, error } = await supabase
        .from('transcript_grades' as any)
        .select('*')
        .eq('transcript_id', transcriptId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TranscriptGrade | null;
    },
    enabled: !!transcriptId,
  });
}

export function useAllTranscriptGrades() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['transcript-grades', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transcript_grades' as any)
        .select('*, call_transcripts!inner(title, call_date, call_type, account_id)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as (TranscriptGrade & {
        call_transcripts: { title: string; call_date: string; call_type: string | null; account_id: string | null };
      })[];
    },
    enabled: !!user,
  });
}

export function useGradeTranscript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (transcriptId: string) => {
      const { data, error } = await supabase.functions.invoke('grade-transcript', {
        body: { transcript_id: transcriptId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as TranscriptGrade;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['transcript-grade', data.transcript_id] });
      qc.invalidateQueries({ queryKey: ['transcript-grades'] });
      toast.success(`Transcript graded: ${data.overall_grade}`);
    },
    onError: (err: Error) => {
      toast.error('Grading failed', { description: err.message });
    },
  });
}
