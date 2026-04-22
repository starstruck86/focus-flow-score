CREATE UNIQUE INDEX IF NOT EXISTS task_runs_one_active_per_thread_task
  ON public.task_runs (thread_id, task_type)
  WHERE thread_id IS NOT NULL
    AND status IN ('pending', 'running');