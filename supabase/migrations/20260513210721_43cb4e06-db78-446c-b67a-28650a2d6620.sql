CREATE TABLE public.circle_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  community_host TEXT,
  session_cookie TEXT NOT NULL,
  cookie_name TEXT NOT NULL DEFAULT '_circle_session',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.circle_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own circle creds"
  ON public.circle_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own circle creds"
  ON public.circle_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own circle creds"
  ON public.circle_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own circle creds"
  ON public.circle_credentials FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_circle_credentials_updated_at
  BEFORE UPDATE ON public.circle_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();