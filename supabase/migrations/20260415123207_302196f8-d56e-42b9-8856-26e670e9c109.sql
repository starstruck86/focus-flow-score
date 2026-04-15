
CREATE TABLE public.smoke_test_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  total_ms INTEGER,
  provider_health JSONB DEFAULT '{}',
  infra_passed INTEGER DEFAULT 0,
  infra_failed INTEGER DEFAULT 0,
  e2e_passed INTEGER DEFAULT 0,
  e2e_failed INTEGER DEFAULT 0,
  failed_tests JSONB DEFAULT '[]',
  full_result JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.smoke_test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own smoke test results"
  ON public.smoke_test_results FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own smoke test results"
  ON public.smoke_test_results FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_smoke_test_results_user_created
  ON public.smoke_test_results (user_id, created_at DESC);
