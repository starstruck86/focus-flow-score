
-- integration_runs: track sync health for external integrations
CREATE TABLE public.integration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.integration_runs TO authenticated;
GRANT ALL ON public.integration_runs TO service_role;
ALTER TABLE public.integration_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own integration runs read" ON public.integration_runs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own integration runs insert" ON public.integration_runs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_integration_runs_user_source_ran
  ON public.integration_runs (user_id, source, ran_at DESC);

-- last_surface: resume-pill support on Today
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS last_surface_path text,
  ADD COLUMN IF NOT EXISTS last_surface_at timestamptz;

-- link strategy messages to accounts / opportunities
ALTER TABLE public.strategy_messages
  ADD COLUMN IF NOT EXISTS linked_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_strategy_messages_linked_account
  ON public.strategy_messages (linked_account_id) WHERE linked_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_strategy_messages_linked_opp
  ON public.strategy_messages (linked_opportunity_id) WHERE linked_opportunity_id IS NOT NULL;
