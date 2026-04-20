-- Stress run header
CREATE TABLE public.strategy_stress_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  notes TEXT,
  total_prompts INT NOT NULL DEFAULT 0,
  succeeded INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_stress_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own stress runs"
  ON public.strategy_stress_runs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_stress_runs_user_started
  ON public.strategy_stress_runs (user_id, started_at DESC);

-- Per-turn capture
CREATE TABLE public.strategy_stress_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.strategy_stress_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL,
  turn_index INT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT,
  output_chars INT,
  -- routing truth (read back from persisted assistant message)
  intended_provider TEXT,
  intended_model TEXT,
  actual_provider TEXT,
  actual_model TEXT,
  fallback_used BOOLEAN,
  latency_ms INT,
  status_code INT,
  -- guard / quality signals
  intent TEXT,
  violations JSONB DEFAULT '[]'::jsonb,
  appendix_present BOOLEAN,
  appendix_audience TEXT,
  appendix_situation TEXT,
  appendix_industry TEXT,
  citation_audit JSONB,
  -- raw assistant message link
  assistant_message_id UUID,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.strategy_stress_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own stress turns"
  ON public.strategy_stress_turns
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_stress_turns_run ON public.strategy_stress_turns (run_id, turn_index);
CREATE INDEX idx_stress_turns_user ON public.strategy_stress_turns (user_id, started_at DESC);