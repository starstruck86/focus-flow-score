
-- Add provenance/replay + config snapshot columns
ALTER TABLE public.strategy_benchmark_runs
  ADD COLUMN IF NOT EXISTS replayed_from_run_id uuid REFERENCES public.strategy_benchmark_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replay_reason text,
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sbr_replayed_from ON public.strategy_benchmark_runs(replayed_from_run_id);

-- Audit log table
CREATE TABLE IF NOT EXISTS public.strategy_benchmark_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.strategy_benchmark_runs(id) ON DELETE CASCADE,
  ask_index integer,
  event_type text NOT NULL,
  event_level text NOT NULL DEFAULT 'info',
  system text,
  provider text,
  model text,
  message text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_benchmark_audit_logs_event_level_check
    CHECK (event_level IN ('info','warn','error'))
);

CREATE INDEX IF NOT EXISTS idx_sbal_run_id ON public.strategy_benchmark_audit_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_sbal_created_at ON public.strategy_benchmark_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sbal_run_ask ON public.strategy_benchmark_audit_logs(run_id, ask_index);

ALTER TABLE public.strategy_benchmark_audit_logs ENABLE ROW LEVEL SECURITY;

-- Users may view audit logs only for their own runs
CREATE POLICY "Users can view audit logs for their own runs"
  ON public.strategy_benchmark_audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.strategy_benchmark_runs r
      WHERE r.id = strategy_benchmark_audit_logs.run_id
        AND r.user_id = auth.uid()
    )
  );

-- Inserts performed by service role only (no client INSERT policy needed)
