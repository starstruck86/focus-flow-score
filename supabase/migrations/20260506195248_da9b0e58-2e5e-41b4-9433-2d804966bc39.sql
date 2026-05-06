
-- Phase 4A: Strategy Run Telemetry table for per-stage observability
CREATE TABLE public.strategy_run_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.task_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  task_type TEXT NOT NULL,
  stage TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  success BOOLEAN NOT NULL DEFAULT true,
  input_tokens INT,
  output_tokens INT,
  total_tokens INT,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance indexes
CREATE INDEX idx_srt_run ON public.strategy_run_telemetry(run_id);
CREATE INDEX idx_srt_task_type ON public.strategy_run_telemetry(task_type);
CREATE INDEX idx_srt_stage ON public.strategy_run_telemetry(stage);
CREATE INDEX idx_srt_created ON public.strategy_run_telemetry(created_at DESC);
CREATE INDEX idx_srt_user_task ON public.strategy_run_telemetry(user_id, task_type);
CREATE INDEX idx_srt_provider ON public.strategy_run_telemetry(provider);

-- RLS
ALTER TABLE public.strategy_run_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own telemetry"
  ON public.strategy_run_telemetry FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own telemetry"
  ON public.strategy_run_telemetry FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role needs full access for edge function writes
CREATE POLICY "Service role full access"
  ON public.strategy_run_telemetry FOR ALL
  USING (true)
  WITH CHECK (true);
