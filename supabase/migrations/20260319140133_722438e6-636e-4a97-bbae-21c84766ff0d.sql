CREATE TABLE public.dave_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_seconds integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dave_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own dave_transcripts"
  ON public.dave_transcripts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own dave_transcripts"
  ON public.dave_transcripts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own dave_transcripts"
  ON public.dave_transcripts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);