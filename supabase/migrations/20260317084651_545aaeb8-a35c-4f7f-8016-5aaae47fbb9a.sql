
CREATE TABLE public.mock_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  call_type text NOT NULL DEFAULT 'Discovery',
  industry text,
  persona text NOT NULL DEFAULT 'CMO',
  difficulty integer NOT NULL DEFAULT 2,
  scenario jsonb NOT NULL DEFAULT '{}'::jsonb,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  live_tracking jsonb NOT NULL DEFAULT '{}'::jsonb,
  grade_data jsonb,
  overall_grade text,
  overall_score integer,
  skill_mode text,
  parent_session_id uuid REFERENCES public.mock_call_sessions(id),
  retry_from_index integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

ALTER TABLE public.mock_call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mock sessions" ON public.mock_call_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own mock sessions" ON public.mock_call_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own mock sessions" ON public.mock_call_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own mock sessions" ON public.mock_call_sessions FOR DELETE TO authenticated USING (auth.uid() = user_id);
