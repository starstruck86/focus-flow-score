
-- Dojo Sessions
CREATE TABLE public.dojo_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  mode TEXT NOT NULL DEFAULT 'autopilot' CHECK (mode IN ('autopilot', 'custom')),
  session_type TEXT NOT NULL DEFAULT 'drill' CHECK (session_type IN ('drill', 'quiz', 'spar', 'review')),
  skill_focus TEXT NOT NULL DEFAULT 'objection_handling',
  difficulty TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  scenario_title TEXT,
  scenario_context TEXT,
  scenario_objection TEXT,
  best_score INTEGER,
  latest_score INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dojo_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dojo sessions" ON public.dojo_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own dojo sessions" ON public.dojo_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own dojo sessions" ON public.dojo_sessions FOR UPDATE USING (auth.uid() = user_id);

-- Dojo Session Turns
CREATE TABLE public.dojo_session_turns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.dojo_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  turn_index INTEGER NOT NULL DEFAULT 0,
  prompt_text TEXT NOT NULL,
  user_response TEXT,
  score INTEGER,
  feedback TEXT,
  top_mistake TEXT,
  improved_version TEXT,
  score_json JSONB,
  retry_of_turn_id UUID REFERENCES public.dojo_session_turns(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dojo_session_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dojo turns" ON public.dojo_session_turns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own dojo turns" ON public.dojo_session_turns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own dojo turns" ON public.dojo_session_turns FOR UPDATE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_dojo_sessions_user_id ON public.dojo_sessions(user_id);
CREATE INDEX idx_dojo_sessions_status ON public.dojo_sessions(user_id, status);
CREATE INDEX idx_dojo_session_turns_session ON public.dojo_session_turns(session_id);

-- Updated_at trigger
CREATE TRIGGER update_dojo_sessions_updated_at
  BEFORE UPDATE ON public.dojo_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
