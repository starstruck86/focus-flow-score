
CREATE TABLE public.nav_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_path text,
  to_path text NOT NULL,
  via text,
  at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.nav_events TO authenticated;
GRANT ALL ON public.nav_events TO service_role;
ALTER TABLE public.nav_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own nav_events"
  ON public.nav_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX nav_events_user_at_idx ON public.nav_events (user_id, at DESC);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS shown_hints jsonb NOT NULL DEFAULT '[]'::jsonb;
