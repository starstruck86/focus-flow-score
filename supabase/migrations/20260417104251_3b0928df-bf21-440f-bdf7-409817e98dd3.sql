ALTER TABLE public.task_runs
  ADD COLUMN IF NOT EXISTS progress_step text,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_task_runs_user_status
  ON public.task_runs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_runs_id_user
  ON public.task_runs (id, user_id);