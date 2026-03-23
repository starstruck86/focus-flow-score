
CREATE TABLE public.strategy_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  insight_id text NOT NULL,
  insight_text text NOT NULL,
  insight_maturity text NOT NULL DEFAULT 'experimental',
  event_type text NOT NULL DEFAULT 'shown',
  deal_stage text,
  execution_state text,
  account_type text,
  outcome text,
  user_feedback text,
  score_at_recommendation numeric,
  context_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own strategy_outcomes"
  ON public.strategy_outcomes FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_strategy_outcomes_user ON public.strategy_outcomes(user_id);
CREATE INDEX idx_strategy_outcomes_insight ON public.strategy_outcomes(insight_id);
CREATE INDEX idx_strategy_outcomes_event ON public.strategy_outcomes(event_type);
