
ALTER TABLE public.learning_lessons 
  ADD COLUMN IF NOT EXISTS mastery_score integer,
  ADD COLUMN IF NOT EXISTS mastery_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mastery_passed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.user_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  lesson_id uuid REFERENCES public.learning_lessons(id) NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  mastery_score integer,
  attempts integer DEFAULT 0,
  best_score integer,
  passed_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

GRANT SELECT, INSERT, UPDATE ON public.user_lesson_progress TO authenticated;
GRANT ALL ON public.user_lesson_progress TO service_role;

ALTER TABLE public.user_lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own progress"
  ON public.user_lesson_progress
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_user_lesson_progress_updated_at
  BEFORE UPDATE ON public.user_lesson_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
