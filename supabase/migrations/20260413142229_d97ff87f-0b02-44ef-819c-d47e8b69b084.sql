
-- Create table for persistent closed-loop coaching sessions
CREATE TABLE public.closed_loop_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  skill TEXT NOT NULL,
  sub_skill TEXT,
  focus_pattern TEXT,
  taught_concept TEXT NOT NULL,
  taught_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  latest_verification JSONB,
  status TEXT NOT NULL DEFAULT 'teaching',
  next_step TEXT,
  routed_to_review BOOLEAN NOT NULL DEFAULT false,
  routed_to_skill_builder BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.closed_loop_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own closed loop sessions"
  ON public.closed_loop_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own closed loop sessions"
  ON public.closed_loop_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own closed loop sessions"
  ON public.closed_loop_sessions FOR UPDATE
  USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_closed_loop_sessions_user_status ON public.closed_loop_sessions (user_id, status);
CREATE INDEX idx_closed_loop_sessions_user_skill ON public.closed_loop_sessions (user_id, skill);

-- Timestamp trigger
CREATE TRIGGER update_closed_loop_sessions_updated_at
  BEFORE UPDATE ON public.closed_loop_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
