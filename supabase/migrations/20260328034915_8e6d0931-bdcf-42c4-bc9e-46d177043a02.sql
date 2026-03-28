
CREATE TABLE public.verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_at timestamp with time zone NOT NULL DEFAULT now(),
  total_resources integer NOT NULL DEFAULT 0,
  total_in_scope integer NOT NULL DEFAULT 0,
  total_broken integer NOT NULL DEFAULT 0,
  total_contradictions integer NOT NULL DEFAULT 0,
  by_fixability jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_failure_bucket jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_processing_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_subtype jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_score_band jsonb NOT NULL DEFAULT '{}'::jsonb,
  fix_recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  repeated_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.verification_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own verification_runs"
  ON public.verification_runs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
