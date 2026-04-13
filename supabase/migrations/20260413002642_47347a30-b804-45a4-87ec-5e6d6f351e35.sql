CREATE TABLE public.skill_builder_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  skill TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  level INTEGER NOT NULL DEFAULT 1,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ki_ids_used TEXT[] NOT NULL DEFAULT '{}',
  focus_patterns_used TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  avg_score NUMERIC,
  weakest_pattern TEXT,
  strongest_pattern TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.skill_builder_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own skill builder sessions"
  ON public.skill_builder_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own skill builder sessions"
  ON public.skill_builder_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own skill builder sessions"
  ON public.skill_builder_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own skill builder sessions"
  ON public.skill_builder_sessions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_skill_builder_sessions_updated_at
  BEFORE UPDATE ON public.skill_builder_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();