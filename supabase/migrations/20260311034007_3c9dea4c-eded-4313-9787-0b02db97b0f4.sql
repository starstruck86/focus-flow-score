
CREATE TABLE public.power_hour_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  focus TEXT NOT NULL DEFAULT 'new-logo',
  dials INTEGER NOT NULL DEFAULT 0,
  connects INTEGER NOT NULL DEFAULT 0,
  meetings_set INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  synced_to_journal BOOLEAN NOT NULL DEFAULT false,
  journal_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.power_hour_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own power_hour_sessions"
  ON public.power_hour_sessions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own power_hour_sessions"
  ON public.power_hour_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own power_hour_sessions"
  ON public.power_hour_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own power_hour_sessions"
  ON public.power_hour_sessions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
