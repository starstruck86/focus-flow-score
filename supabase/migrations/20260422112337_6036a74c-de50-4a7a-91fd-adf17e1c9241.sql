CREATE TABLE public.canary_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  raw_input text NOT NULL,
  parsed_json jsonb NOT NULL,
  evidence_summary jsonb NOT NULL,
  recommendation text NOT NULL CHECK (recommendation IN ('continue','fix','rollback')),
  decision text NOT NULL CHECK (decision IN ('continue','fix','rollback')),
  decision_notes text,
  flag_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.canary_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own canary reviews"
  ON public.canary_reviews FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own canary reviews"
  ON public.canary_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX canary_reviews_user_created_idx
  ON public.canary_reviews (user_id, created_at DESC);