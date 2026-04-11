import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { CourseWithModules, LearningLesson, LearningProgress } from './types';

export function useCourses() {
  return useQuery({
    queryKey: ['learning-courses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learning_courses' as any)
        .select(`
          *,
          learning_modules (
            *,
            learning_lessons (id, title, order_index, generation_status, difficulty_level)
          )
        `)
        .eq('is_active', true)
        .order('created_at');

      if (error) throw error;

      // Sort modules and lessons by order_index
      return (data as any[] || []).map((course: any) => ({
        ...course,
        learning_modules: (course.learning_modules || [])
          .sort((a: any, b: any) => a.order_index - b.order_index)
          .map((mod: any) => ({
            ...mod,
            learning_lessons: (mod.learning_lessons || [])
              .sort((a: any, b: any) => a.order_index - b.order_index),
          })),
      })) as CourseWithModules[];
    },
  });
}

export function useLesson(lessonId: string | undefined) {
  return useQuery({
    queryKey: ['learning-lesson', lessonId],
    enabled: !!lessonId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learning_lessons' as any)
        .select('*')
        .eq('id', lessonId!)
        .single();

      if (error) throw error;
      return data as unknown as LearningLesson;
    },
  });
}

export function useUserProgress() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['learning-progress', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learning_progress' as any)
        .select('*')
        .eq('user_id', user!.id);

      if (error) throw error;
      return (data || []) as unknown as LearningProgress[];
    },
  });
}

export function useGenerateLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lessonId: string) => {
      const { data, error } = await supabase.functions.invoke('generate-lesson-content', {
        body: { lessonId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, lessonId) => {
      qc.invalidateQueries({ queryKey: ['learning-lesson', lessonId] });
    },
  });
}

export function useUpsertProgress() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { lessonId: string; status: string; mastery_score?: number }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('learning_progress' as any)
        .upsert({
          user_id: user.id,
          lesson_id: params.lessonId,
          status: params.status,
          mastery_score: params.mastery_score ?? null,
          last_attempt_at: new Date().toISOString(),
        } as any, { onConflict: 'user_id,lesson_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['learning-progress'] });
    },
  });
}

export function useSaveQuizAnswer() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: {
      lessonId: string;
      questionType: string;
      questionId: string;
      userAnswer: any;
      isCorrect?: boolean;
      aiFeedback?: string;
      score?: number;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('learning_quiz_answers' as any)
        .insert({
          user_id: user.id,
          lesson_id: params.lessonId,
          question_type: params.questionType,
          question_id: params.questionId,
          user_answer: params.userAnswer,
          is_correct: params.isCorrect ?? null,
          ai_feedback: params.aiFeedback ?? null,
          score: params.score ?? null,
        } as any);
      if (error) throw error;
    },
  });
}
